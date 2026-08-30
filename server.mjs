import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { networkInterfaces } from 'os';
import crypto from 'crypto';
import { mkdir, readFile, writeFile, rename, appendFile, chmod } from 'fs/promises';
import { readFileSync, readdirSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Single source of truth for the app version (from package.json).
const APP_VERSION = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8')).version;
const DATA_DIR = join(__dirname, 'data');
const LOGS_DIR = join(__dirname, '.logs');
const LOG_FILE = join(LOGS_DIR, `ag-bridge-${new Date().toISOString().split('T')[0]}.log`);
const STATE_FILE = join(DATA_DIR, 'state.json');
const FAMILY_CORE_WORKER_STATUS_FILE = join(DATA_DIR, 'family-core-worker-status.json');
const FAMILY_CORE_INBOX_DIR = join(DATA_DIR, 'family-core-inbox');
const FAMILY_CORE_INBOX_INDEX_FILE = join(FAMILY_CORE_INBOX_DIR, 'index.json');
const APPROVALS_FILE = join(DATA_DIR, 'approvals.json');
const POLICY_FILE = join(__dirname, 'policy.json');
let POLICY = { version: 2, profiles: { relaxed: { allow: [".*"] }, balanced: { allow: [] } }, globalDeny: [] };

// --- Config ---
const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 ? args[idx + 1] : null;
};
const hasArg = (name) => args.includes(name);

const PORT = parseInt(getArg('--port') || process.env.PORT || '8787');
const HOST = getArg('--host') || '0.0.0.0';
const PAIRING_CODE_FILE = join(LOGS_DIR, `pairing-code-${PORT}.txt`);

export const app = express();
export const server = createServer(app);
// Don't bind 'server' here so we can handle upgrade manually for auth
export const wss = new WebSocketServer({ noServer: true });

// --- Poke Logic ---
let pokeInFlight = false;
let lastPokeAt = 0;
let retryTimer = null;
let retryAttempts = 0;

async function runPokeScript() {
    return new Promise((resolve) => {
        const child = spawn('node', ['scripts/poke.mjs'], { cwd: process.cwd(), shell: true });
        let stdout = '';
        child.stdout.on('data', d => stdout += d);
        child.on('close', () => {
            try {
                const res = JSON.parse(stdout);
                log('POKE', 'Script result', res);
                resolve(res);
            } catch {
                log('POKE', 'Parse error', { stdout });
                resolve({ ok: false, error: 'parse_error', stdout });
            }
        });
        child.on('error', (err) => {
            log('POKE', 'Spawn error', err.message);
            resolve({ ok: false, error: 'spawn_error', details: err.message });
        });
    });
}

function stopRetry() {
    if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
    }
    retryAttempts = 0;
}

function startRetry() {
    if (retryTimer) return;
    retryAttempts = 0;
    log('POKE', 'Agent busy. Starting retry loop...');
    retryTimer = setInterval(async () => {
        retryAttempts++;
        if (retryAttempts > 24) { // 2 minutes
            log('POKE', 'Retry limit reached. Giving up.');
            stopRetry();
            return;
        }
        await tryPoke(true);
    }, 5000);
}

async function tryPoke(isRetry = false) {
    if (pokeInFlight) return;

    // Throttle 2s
    if (Date.now() - lastPokeAt < 2000) return;

    pokeInFlight = true;
    lastPokeAt = Date.now();

    if (!isRetry) log('POKE', 'Attempting to wake agent...');
    const res = await runPokeScript();
    pokeInFlight = false;

    if (res.ok) {
        log('POKE', 'Success', { method: res.method });
        stopRetry();
    } else if (res.reason && res.reason.includes('busy')) {
        // Agent is busy
        if (!isRetry) log('POKE', 'Agent busy. Scheduling retries.');
        startRetry();
    } else {
        log('POKE', 'Failed/Error', res);
        // Stop retrying on hard errors (like no CDP connection)
        stopRetry();
    }
}

function schedulePoke() {
    if (pokeInFlight) return;

    // Dedupe: If we are already retrying, we don't need to kickstart it.
    // However, if we aren't retrying, and a poke is not in flight, we should try.
    // The throttle in tryPoke handles the "too fast" case.
    if (retryTimer) {
        log('POKE', 'Skipping schedulePoke: Retry loop already active.');
        return;
    }

    tryPoke(false);
}

// --- State ---
// Persistent State
let STATE = {
    version: 1,
    strictMode: true,
    approvals: [],
    messages: [],
    familyCoreJobs: [],
    agent: { state: 'idle', lastSeen: null, task: '', note: '' },
    checkpoints: [],
    tokens: [] // Changed from optional to persisted for UX stability
};

// Ephemeral State
let PAIRING_CODE = generateCode();
let TOKENS = new Set(); // Loaded from STATE.tokens

// --- Helpers ---
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken() {
    return crypto.randomBytes(16).toString('hex');
}

function getLocalIPs() {
    const nets = networkInterfaces();
    const results = new Set();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip internal (non-127.0.0.1) and non-IPv4
            if (net.family === 'IPv4' && !net.internal) {
                // Filter out Tailscale IPs (100.x.x.x) from the "Local" list
                if (!net.address.startsWith('100.')) {
                    results.add(net.address);
                }
            }
        }
    }
    return Array.from(results);
}

function getTailscaleInfo() {
    try {
        const stdout = execSync('tailscale status --json', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
        const status = JSON.parse(stdout);
        if (status.BackendState === 'Running') {
            const dnsName = status.Self.DNSName;
            const name = dnsName ? dnsName.replace(/\.$/, '') : null;
            const ips = status.TailscaleIPs || [];
            return { name, ips };
        }
    } catch (e) {
        return null;
    }
    return null;
}

function broadcast(event, payload) {
    const msg = JSON.stringify({
        event,
        payload,
        ts: new Date().toISOString()
    });
    for (const client of wss.clients) {
        if (client.readyState === 1) { // OPEN
            client.send(msg);
        }
    }
}

// --- Logging ---
async function log(component, message, data = null) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${component}] ${message} ${data ? JSON.stringify(data) : ''}`;
    console.log(line);
    try {
        await appendFile(LOG_FILE, line + '\n');
    } catch (e) { /* ignore log errors */ }
}

async function writePairingCodeFile() {
    try {
        await mkdir(LOGS_DIR, { recursive: true });
        const content = [
            `AG Bridge v${APP_VERSION}`,
            `host=${HOST}`,
            `port=${PORT}`,
            `pairing_code=${PAIRING_CODE}`,
            `updated_at=${new Date().toISOString()}`,
            ''
        ].join('\n');
        await writeFile(PAIRING_CODE_FILE, content, { mode: 0o600 });
        await chmod(PAIRING_CODE_FILE, 0o600);
        console.log(` Pairing code file: ${PAIRING_CODE_FILE}`);
    } catch (err) {
        console.warn(`[AUTH] Failed to write pairing code file: ${err.message}`);
    }
}

// --- Persistence ---
let saveTimeout = null;
async function saveState() {
    if (saveTimeout) clearTimeout(saveTimeout);

    saveTimeout = setTimeout(async () => {
        try {
            const data = {
                version: STATE.version,
                strictMode: STATE.strictMode,
                // approvals: STATE.approvals, // Scoped to approvals.json now
                messages: STATE.messages,
                familyCoreJobs: STATE.familyCoreJobs,
                agent: STATE.agent,
                checkpoints: STATE.checkpoints,
                tokens: Array.from(TOKENS)
            };
            const tempFile = `${STATE_FILE}.tmp`;
            await writeFile(tempFile, JSON.stringify(data, null, 2));
            await rename(tempFile, STATE_FILE);
            log('PERSIST', 'State saved (config/msgs).');
        } catch (err) {
            log('PERSIST', 'Failed to save state:', err.message);
        }
    }, 250);
}

async function saveApprovals() {
    try {
        const tempFile = `${APPROVALS_FILE}.tmp`;
        await writeFile(tempFile, JSON.stringify(STATE.approvals, null, 2));
        await rename(tempFile, APPROVALS_FILE);
        log('PERSIST', `Approvals saved (${STATE.approvals.length}).`);
    } catch (err) {
        log('PERSIST', 'Failed to save approvals:', err.message);
    }
}

async function loadPolicy() {
    try {
        const raw = await readFile(POLICY_FILE, 'utf-8');
        POLICY = JSON.parse(raw);
        log('POLICY', 'Loaded policy.json');
    } catch (err) {
        log('POLICY', 'policy.json not found or invalid. Using defaults.');
    }
}

async function loadState() {
    try {
        await mkdir(DATA_DIR, { recursive: true });
        const raw = await readFile(STATE_FILE, 'utf-8');
        const data = JSON.parse(raw);

        if (data.version) STATE.version = data.version;
        if (typeof data.strictMode === 'boolean') STATE.strictMode = data.strictMode;
        // if (Array.isArray(data.approvals)) STATE.approvals = data.approvals; // Legacy load
        if (Array.isArray(data.messages)) STATE.messages = data.messages;
        if (Array.isArray(data.familyCoreJobs)) STATE.familyCoreJobs = data.familyCoreJobs;
        if (data.agent) STATE.agent = data.agent;
        if (Array.isArray(data.checkpoints)) STATE.checkpoints = data.checkpoints;
        if (Array.isArray(data.tokens)) {
            STATE.tokens = data.tokens;
            TOKENS = new Set(data.tokens);
        }

        // Load Approvals (Separate File)
        try {
            const rawApprovals = await readFile(APPROVALS_FILE, 'utf-8');
            const approvalsData = JSON.parse(rawApprovals);
            if (Array.isArray(approvalsData)) {
                STATE.approvals = approvalsData;
            }
        } catch (e) {
            if (e.code === 'ENOENT') {
                // Migration: Check if state.json had approvals
                if (Array.isArray(data.approvals) && data.approvals.length > 0) {
                    log('PERSIST', 'Migrating approvals from state.json to approvals.json');
                    STATE.approvals = data.approvals;
                    await saveApprovals();
                }
            } else {
                log('PERSIST', 'Failed to load approvals.json', e.message);
            }
        }

        console.log(`[PERSIST] State loaded. ${STATE.approvals.length} approvals, ${TOKENS.size} tokens.`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            log('PERSIST', 'No state file found. Starting fresh.');
            await saveState();
        } else {
            log('PERSIST', 'Failed to load state:', err.message);
            // Logic to rename bad file could go here, but simple logging is fine for v0.2
            const badFile = `${STATE_FILE}.bad.${Date.now()}`;
            try {
                await rename(STATE_FILE, badFile);
                log('PERSIST', `Corrupt state file renamed to ${badFile}`);
            } catch (e) { /* ignore */ }
        }
    }
}

function checkPolicy(cmd) {
    if (!cmd) return { allowed: false, error: 'missing_command' };

    // 1. Global Deny (Always wins)
    for (const pattern of POLICY.globalDeny || []) {
        if (new RegExp(pattern).test(cmd)) {
            return { allowed: false, error: 'global_denied' };
        }
    }

    // 2. Determine Profile (Map v0.5 boolean to v0.6 profiles)
    // strictMode=true -> 'balanced', strictMode=false -> 'relaxed'
    // Future: STATE.securityProfile could hold 'paranoid' etc.
    const profileName = STATE.strictMode ? 'balanced' : 'relaxed';
    const profile = POLICY.profiles?.[profileName];

    if (!profile) {
        // Fallback safety: if profile invalid, BLOCK ALL unless relaxed was intended?
        // Better to be safe.
        return { allowed: false, error: 'invalid_policy_profile' };
    }

    // 3. Profile Deny
    for (const pattern of profile.deny || []) {
        if (new RegExp(pattern).test(cmd)) {
            return { allowed: false, error: 'profile_denied' };
        }
    }

    // 4. Profile Allow
    for (const pattern of profile.allow || []) {
        if (new RegExp(pattern).test(cmd)) {
            return { allowed: true };
        }
    }

    return { allowed: false, error: 'command_not_allowlisted' };
}

// --- Middleware ---
app.use(express.json());
app.use(express.static('public'));

app.get('/share', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
});

function readFamilyCoreWorkerStatus() {
    try {
        const data = JSON.parse(readFileSync(FAMILY_CORE_WORKER_STATUS_FILE, 'utf-8'));
        const updatedAtMs = Date.parse(data.updatedAt || data.lastPollAt || '');
        const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : null;
        return {
            state: ageMs !== null && ageMs <= 60000 ? data.state || 'running' : 'stale',
            updatedAt: data.updatedAt || null,
            lastPollAt: data.lastPollAt || null,
            lastProcessedAt: data.lastProcessedAt || null,
            processed: data.processed || 0,
            failed: data.failed || 0,
            ageMs
        };
    } catch {
        return {
            state: 'offline',
            updatedAt: null,
            lastPollAt: null,
            lastProcessedAt: null,
            processed: 0,
            failed: 0,
            ageMs: null
        };
    }
}

function readFamilyCoreInboxItems(limit = 20) {
    const byId = new Map();
    const addItem = (item) => {
        if (!item?.id || byId.has(item.id)) return;
        byId.set(item.id, {
            id: item.id,
            title: item.title,
            source: item.source,
            createdAt: item.createdAt,
            processedAt: item.processedAt,
            mdPath: item.mdPath,
            jsonPath: item.jsonPath,
            mdFile: item.mdFile,
            jsonFile: item.jsonFile
        });
    };

    try {
        const data = JSON.parse(readFileSync(FAMILY_CORE_INBOX_INDEX_FILE, 'utf-8'));
        const items = Array.isArray(data.items) ? data.items : [];
        items.forEach(addItem);
    } catch { /* missing index is fine */ }

    try {
        for (const file of readdirSync(FAMILY_CORE_INBOX_DIR)) {
            if (!file.endsWith('.json') || file === 'index.json') continue;
            const jsonPath = join(FAMILY_CORE_INBOX_DIR, file);
            const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
            const mdFile = file.replace(/\.json$/, '.md');
            addItem({
                id: data.id,
                title: data.title,
                source: data.source,
                createdAt: data.createdAt,
                processedAt: data.processedAt || data.updatedAt || data.createdAt,
                mdPath: join(FAMILY_CORE_INBOX_DIR, mdFile),
                jsonPath,
                mdFile,
                jsonFile: file
            });
        }
    } catch { /* inbox directory may not exist yet */ }

    return [...byId.values()]
        .sort((a, b) => new Date(b.processedAt || b.createdAt) - new Date(a.processedAt || a.createdAt))
        .slice(0, limit);
}

function getClientIp(req) {
    const ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
    return ip.replace(/^::ffff:/, '');
}

function isLocalRequest(req) {
    const ip = getClientIp(req);
    return ip === '127.0.0.1' || ip === '::1';
}

function extractToken(req) {
    const headerToken = req.headers['x-ag-token'];
    if (typeof headerToken === 'string' && headerToken.trim()) {
        return headerToken.trim();
    }
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        const bearer = auth.slice(7).trim();
        if (bearer) return bearer;
    }
    return null;
}

const requireAuth = (req, res, next) => {
    // Allow localhost (MCP server, relay on same host) to bypass auth
    if (isLocalRequest(req)) {
        return next();
    }

    const token = extractToken(req);
    if (!token || !TOKENS.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

const checkAuth = requireAuth; // Alias for consistency with new endpoints

// --- HTTP Endpoints ---

// Public
app.get('/health', (req, res) => {
    res.json({ ok: true, name: "ag_bridge", version: APP_VERSION, ts: new Date().toISOString() });
});

app.post('/pair/claim', (req, res) => {
    const { code } = req.body;
    if (!code || code !== PAIRING_CODE) {
        return res.status(403).json({ error: 'invalid_code' });
    }
    const token = generateToken();
    TOKENS.add(token);
    saveState(); // Save new token
    console.log(`[AUTH] New device paired. Token created.`);
    res.json({ token });
});

// Protected
app.get('/config', requireAuth, (req, res) => {
    res.json({ ok: true, strictMode: STATE.strictMode, ts: new Date().toISOString() });
});

app.post('/config/strict-mode', requireAuth, (req, res) => {
    const { strictMode } = req.body;
    if (typeof strictMode !== 'boolean') {
        return res.status(400).json({ error: 'invalid_input' });
    }
    STATE.strictMode = strictMode;
    saveState();
    console.log(`[CONFIG] Strict Mode set to ${strictMode}`);
    broadcast('config_changed', { strictMode });
    res.json({ ok: true, strictMode });
});

// Migrated to usage of single /status endpoint below
// app.get('/status', requireAuth, ...);

app.get('/approvals', requireAuth, (req, res) => {
    const sorted = [...STATE.approvals].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ approvals: sorted });
});

app.post('/approvals/:id/approve', requireAuth, (req, res) => {
    const { id } = req.params;
    const approval = STATE.approvals.find(a => a.id === id);
    if (!approval) return res.status(404).json({ error: 'not_found' });

    if (approval.status !== 'pending') {
        return res.status(409).json({ error: 'already_decided', approval });
    }

    approval.status = 'approved';
    approval.decidedAt = new Date().toISOString();
    saveApprovals();

    console.log(`[APPROVAL] ${id} APPROVED`);
    broadcast('approval_decided', { id, status: 'approved' });
    res.json({ ok: true, approval });
});

app.post('/approvals/:id/deny', requireAuth, (req, res) => {
    const { id } = req.params;
    const approval = STATE.approvals.find(a => a.id === id);
    if (!approval) return res.status(404).json({ error: 'not_found' });

    if (approval.status !== 'pending') {
        return res.status(409).json({ error: 'already_decided', approval });
    }

    approval.status = 'denied';
    approval.decidedAt = new Date().toISOString();
    saveApprovals();

    console.log(`[APPROVAL] ${id} DENIED`);
    broadcast('approval_decided', { id, status: 'denied' });
    res.json({ ok: true, approval });
});

app.post('/debug/create-approval', requireAuth, (req, res) => {
    const { kind, details } = req.body;
    const newApproval = {
        id: `appr_${crypto.randomBytes(4).toString('hex')}`,
        createdAt: new Date().toISOString(),
        kind: kind || 'command',
        details: details || { cmd: 'echo "Hello World"', risk: 'low' },
        status: 'pending',
        decidedAt: null
    };

    STATE.approvals.push(newApproval);
    saveApprovals();
    console.log(`[DEBUG] Created test approval ${newApproval.id}`);
    broadcast('approval_requested', newApproval);
    res.json(newApproval);
});

// --- New v0.3 Endpoints ---

// POST /messages/send
app.post('/messages/send', checkAuth, (req, res) => {
    const { to, channel, text, from } = req.body;
    if (!to || !text) return res.status(400).json({ ok: false, error: 'missing_fields' });

    const msg = {
        id: 'msg_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        createdAt: new Date().toISOString(),
        from: from || 'user', // 'user' (phone) or 'agent'
        to, // 'agent' or 'user'
        channel: channel || 'general',
        text,
        status: 'new'
    };

    STATE.messages.push(msg);
    // Cap history at 200
    if (STATE.messages.length > 200) STATE.messages.shift();
    saveState();

    broadcast('message_new', msg);

    // Trigger Poke if msg is for agent
    if (to === 'agent') {
        schedulePoke();
    }

    res.json({ ok: true, message: msg });
});

// GET /messages/inbox
app.get('/messages/inbox', checkAuth, (req, res) => {
    const { to, status, limit } = req.query;
    let items = STATE.messages;

    if (to) items = items.filter(m => m.to === to);
    if (status) items = items.filter(m => m.status === status);

    // Sort newest first
    items = [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (limit) items = items.slice(0, parseInt(limit));

    res.json({ ok: true, messages: items });
});

// POST /messages/:id/ack
app.post('/messages/:id/ack', checkAuth, (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'read' or 'done'

    const msg = STATE.messages.find(m => m.id === id);
    if (!msg) return res.status(404).json({ ok: false, error: 'not_found' });

    msg.status = status || 'read';
    saveState();

    broadcast('message_ack', { id, status: msg.status });
    res.json({ ok: true });
});

// POST /family-core/jobs
app.post('/family-core/jobs', checkAuth, (req, res) => {
    const { title, source, note, payload } = req.body || {};
    const cleanTitle = typeof title === 'string' ? title.trim() : '';

    if (!cleanTitle) {
        return res.status(400).json({ ok: false, error: 'missing_title' });
    }

    const job = {
        id: 'fcj_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: typeof source === 'string' && source.trim() ? source.trim() : 'phone',
        title: cleanTitle,
        note: typeof note === 'string' ? note.trim() : '',
        payload: payload && typeof payload === 'object' ? payload : null,
        status: 'queued'
    };

    STATE.familyCoreJobs.push(job);
    if (STATE.familyCoreJobs.length > 100) STATE.familyCoreJobs.shift();
    saveState();

    broadcast('family_core_job_new', job);
    res.json({ ok: true, job });
});

// GET /family-core/jobs
app.get('/family-core/jobs', checkAuth, (req, res) => {
    const { status, limit } = req.query;
    let items = STATE.familyCoreJobs || [];

    if (status) items = items.filter(job => job.status === status);
    items = [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const parsedLimit = Number.parseInt(limit, 10);
    if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
        items = items.slice(0, parsedLimit);
    }

    res.json({ ok: true, jobs: items });
});

// GET /family-core/inbox
app.get('/family-core/inbox', checkAuth, (req, res) => {
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
    res.json({ ok: true, items: readFamilyCoreInboxItems(limit) });
});

// POST /family-core/jobs/:id/status
app.post('/family-core/jobs/:id/status', checkAuth, (req, res) => {
    const { id } = req.params;
    const { status, note, fromStatus } = req.body || {};
    const allowed = new Set(['queued', 'processing', 'done', 'failed']);

    if (!allowed.has(status)) {
        return res.status(400).json({ ok: false, error: 'invalid_status' });
    }

    const job = (STATE.familyCoreJobs || []).find(item => item.id === id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });

    if (typeof fromStatus === 'string' && job.status !== fromStatus) {
        return res.status(409).json({
            ok: false,
            error: 'status_mismatch',
            expected: fromStatus,
            currentStatus: job.status,
            job
        });
    }

    job.status = status;
    job.updatedAt = new Date().toISOString();
    if (typeof note === 'string') job.note = note.trim();
    saveState();

    broadcast('family_core_job_status', { id, status: job.status, updatedAt: job.updatedAt });
    res.json({ ok: true, job });
});

// POST /agent/heartbeat
app.post('/agent/heartbeat', checkAuth, (req, res) => {
    const { state, task, note } = req.body;

    STATE.agent = {
        ...STATE.agent,
        lastSeen: new Date().toISOString(),
        state: state || STATE.agent.state,
        task: task !== undefined ? task : STATE.agent.task,
        note: note !== undefined ? note : STATE.agent.note
    };
    saveState();

    broadcast('agent_status', STATE.agent);
    res.json({ ok: true, agent: STATE.agent });
});

// GET /agent/status
app.get('/agent/status', checkAuth, (req, res) => {
    res.json({ ok: true, agent: STATE.agent });
});

// GET /status (Observability)
app.get('/status', requireAuth, (req, res) => {
    const pending = STATE.approvals.filter(a => a.status === 'pending').length;
    const queuedFamilyCoreJobs = (STATE.familyCoreJobs || []).filter(job => job.status === 'queued').length;
    const familyCoreWorker = readFamilyCoreWorkerStatus();
    const familyCoreInboxCount = readFamilyCoreInboxItems(100).length;
    res.json({
        ok: true,
        version: APP_VERSION,
        ts: new Date().toISOString(),
        pendingApprovals: pending,
        queuedFamilyCoreJobs,
        familyCoreWorker,
        familyCoreInboxCount,
        totalApprovals: STATE.approvals.length,
        strictMode: STATE.strictMode,
        cdp: {
            enabled: true, // v0.x assumption
            poke_in_flight: pokeInFlight,
            retry_active: !!retryTimer
        },
        agent: {
            state: STATE.agent.state,
            last_seen: STATE.agent.lastSeen
        },
        server: {
            uptime: process.uptime(),
            clients: wss.clients.size
        }
    });
});

// POST /checkpoint
app.post('/checkpoint', checkAuth, (req, res) => {
    const cp = {
        id: 'cp_' + Date.now(),
        ts: new Date().toISOString(),
        ...req.body
    };

    STATE.checkpoints.push(cp);
    saveState();

    broadcast('checkpoint_new', cp);
    res.json({ ok: true, checkpoint: cp });
});

// --- Legacy v0.2 Routes ---
app.post('/approvals/request', checkAuth, (req, res) => {
    const { kind, details, risk, clientTag } = req.body;

    // Policy Check for commands
    if (kind === 'command') {
        const cmd = details?.cmd;
        const check = checkPolicy(cmd);
        if (!check.allowed) {
            console.warn(`[POLICY] Blocked command: "${cmd}" Reason: ${check.error}`);
            return res.status(403).json({ error: check.error });
        }
    }

    const newApproval = {
        id: `appr_${crypto.randomBytes(4).toString('hex')}`,
        createdAt: new Date().toISOString(),
        kind: kind || 'unknown',
        details: details || {},
        status: 'pending',
        decidedAt: null,
        meta: {
            risk: risk || 'unknown',
            clientTag: clientTag || null
        }
    };

    STATE.approvals.push(newApproval);
    saveApprovals(); // Changed from saveState()
    console.log(`[REQUEST] Approval requested: ${newApproval.id} (${kind})`);
    broadcast('approval_requested', newApproval);
    res.json({ ok: true, approval: newApproval });
});

app.get('/approvals/:id', checkAuth, (req, res) => {
    const { id } = req.params;
    const approval = STATE.approvals.find(a => a.id === id);
    if (!approval) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, approval });
});

app.get('/approvals/stream/summary', checkAuth, (req, res) => {
    const pending = STATE.approvals.filter(a => a.status === 'pending').length;
    const approved = STATE.approvals.filter(a => a.status === 'approved').length;
    const denied = STATE.approvals.filter(a => a.status === 'denied').length;
    res.json({
        ok: true,
        ts: new Date().toISOString(),
        pending,
        approved,
        denied,
        total: STATE.approvals.length
    });
});

// --- WebSocket Handling ---
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');
    const pathname = url.pathname;

    if (pathname !== '/events') {
        socket.destroy();
        return;
    }

    const wsToken = token?.trim() || null;
    const remote = request.socket?.remoteAddress?.replace(/^::ffff:/, '') || '';
    const isLocal = remote === '127.0.0.1' || remote === '::1';
    if (!isLocal && (!wsToken || !TOKENS.has(wsToken))) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ event: 'hello', payload: { ts: new Date().toISOString() } }));
});

// --- Start ---
// Load state then start
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    Promise.all([loadState(), loadPolicy()]).then(() => {
        server.listen(PORT, HOST, () => {
            const ips = getLocalIPs();
            const ts = getTailscaleInfo();

            console.log('='.repeat(50));
            console.log(` AG Bridge v${APP_VERSION} running on port ${PORT}`);
            console.log('='.repeat(50));
            console.log(` PAIRING CODE: [ ${PAIRING_CODE} ]`);
            writePairingCodeFile();
            console.log('-'.repeat(50));

            console.log(' Local (same Wi-Fi):');
            if (ips.length > 0) {
                ips.forEach(ip => {
                    console.log(` http://${ip}:${PORT}`);
                });
            } else {
                console.log(' (No local LAN IP found)');
            }

            if (ts) {
                console.log('\n Remote (Tailscale Active):');
                if (ts.name) {
                    console.log(` http://${ts.name}:${PORT}`);
                }
                ts.ips.forEach(ip => {
                    console.log(` http://${ip}:${PORT}`);
                });
            } else {
                console.log('\n Remote (Tailscale Inactive):');
                console.log(' Install Tailscale for access anywhere: https://tailscale.com');
            }

            console.log('='.repeat(50));
        });
    });
}
