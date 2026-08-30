import { mkdir, readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8791';
const DEFAULT_INTERVAL_MS = 15000;
const DEFAULT_INBOX_DIR = new URL('../data/family-core-inbox/', import.meta.url);
const DEFAULT_STATUS_FILE = new URL('../data/family-core-worker-status.json', import.meta.url);

const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 ? args[idx + 1] : null;
};
const hasArg = (name) => args.includes(name);

const BASE_URL = getArg('--base-url') || process.env.FAMILY_CORE_BASE_URL || DEFAULT_BASE_URL;
const INTERVAL_MS = Number.parseInt(getArg('--interval-ms') || process.env.FAMILY_CORE_INTERVAL_MS || DEFAULT_INTERVAL_MS, 10);
const INBOX_DIR = getArg('--inbox-dir') || process.env.FAMILY_CORE_INBOX_DIR || DEFAULT_INBOX_DIR.pathname;
const STATUS_FILE = getArg('--status-file') || process.env.FAMILY_CORE_STATUS_FILE || DEFAULT_STATUS_FILE.pathname;
const INBOX_INDEX_FILE = join(INBOX_DIR, 'README.md');
const INBOX_JSON_INDEX_FILE = join(INBOX_DIR, 'index.json');
const RUN_ONCE = hasArg('--once');

function safeName(value) {
    return String(value || 'job')
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'job';
}

function formatJobMarkdown(job) {
    const lines = [
        `# ${job.title}`,
        '',
        `- id: ${job.id}`,
        `- source: ${job.source || 'unknown'}`,
        `- created_at: ${job.createdAt}`,
        `- processed_at: ${new Date().toISOString()}`,
        '',
        '## Note',
        '',
        job.note || '_No note provided._'
    ];

    if (job.payload) {
        lines.push('', '## Payload', '', '```json', JSON.stringify(job.payload, null, 2), '```');
    }

    return `${lines.join('\n')}\n`;
}

function relativeInboxPath(filePath) {
    return filePath.startsWith(INBOX_DIR) ? filePath.slice(INBOX_DIR.length).replace(/^\/+/, '') : filePath;
}

async function updateInboxIndex(job, files) {
    await mkdir(INBOX_DIR, { recursive: true, mode: 0o700 });
    let existing = '# Family Core Mac inbox\n\n';
    try {
        existing = await readFile(INBOX_INDEX_FILE, 'utf-8');
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }

    if (!existing.startsWith('# Family Core Mac inbox')) {
        existing = `# Family Core Mac inbox\n\n${existing}`;
    }

    const line = [
        `- ${new Date().toISOString()}`,
        `id=${job.id}`,
        `title=${job.title}`,
        `[md](${relativeInboxPath(files.mdPath)})`,
        `[json](${relativeInboxPath(files.jsonPath)})`
    ].join(' | ');

    if (existing.includes(`id=${job.id}`)) return;

    const content = `${existing.trimEnd()}\n${line}\n`;
    const tempFile = `${INBOX_INDEX_FILE}.tmp`;
    await writeFile(tempFile, content, { mode: 0o600 });
    await rename(tempFile, INBOX_INDEX_FILE);
}

async function updateInboxJsonIndex(job, files) {
    await mkdir(INBOX_DIR, { recursive: true, mode: 0o700 });
    let items = [];
    try {
        const raw = await readFile(INBOX_JSON_INDEX_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        items = Array.isArray(parsed.items) ? parsed.items : [];
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }

    const item = {
        id: job.id,
        title: job.title,
        source: job.source || 'unknown',
        createdAt: job.createdAt,
        processedAt: new Date().toISOString(),
        mdPath: files.mdPath,
        jsonPath: files.jsonPath,
        mdFile: relativeInboxPath(files.mdPath),
        jsonFile: relativeInboxPath(files.jsonPath)
    };

    items = [item, ...items.filter(existing => existing.id !== job.id)].slice(0, 200);
    const tempFile = `${INBOX_JSON_INDEX_FILE}.tmp`;
    await writeFile(tempFile, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, { mode: 0o600 });
    await rename(tempFile, INBOX_JSON_INDEX_FILE);
}

async function api(path, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'content-type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${path}`, options);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
    }
    return res.json();
}

async function writeInboxFiles(job) {
    await mkdir(INBOX_DIR, { recursive: true, mode: 0o700 });
    const base = `${new Date(job.createdAt).toISOString().replace(/[:.]/g, '-')}-${safeName(job.id)}-${safeName(job.title)}`;
    const jsonPath = join(INBOX_DIR, `${base}.json`);
    const mdPath = join(INBOX_DIR, `${base}.md`);

    const record = {
        ...job,
        processedAt: new Date().toISOString(),
        localInbox: true
    };

    await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await writeFile(mdPath, formatJobMarkdown(job), { mode: 0o600, flag: 'wx' });
    return { jsonPath, mdPath };
}

async function writeWorkerStatus(status) {
    const record = {
        worker: 'family-core-worker',
        baseUrl: BASE_URL,
        inboxDir: INBOX_DIR,
        intervalMs: INTERVAL_MS,
        ...status,
        updatedAt: new Date().toISOString()
    };
    await mkdir(new URL('.', `file://${STATUS_FILE}`).pathname, { recursive: true, mode: 0o700 });
    const tempFile = `${STATUS_FILE}.tmp`;
    await writeFile(tempFile, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(tempFile, STATUS_FILE);
    return record;
}

export async function processQueuedJobs() {
    await writeWorkerStatus({ state: 'running', lastPollAt: new Date().toISOString(), processed: 0, failed: 0 });
    const data = await api('/family-core/jobs?status=queued&limit=10');
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    const results = [];

    for (const job of jobs) {
        try {
            await api(`/family-core/jobs/${job.id}/status`, 'POST', {
                status: 'processing',
                note: job.note || ''
            });
            const files = await writeInboxFiles(job);
            await updateInboxIndex(job, files);
            await updateInboxJsonIndex(job, files);
            await api(`/family-core/jobs/${job.id}/status`, 'POST', {
                status: 'done',
                note: `Saved locally on Mac: ${files.mdPath}`
            });
            results.push({ id: job.id, ok: true, ...files });
        } catch (err) {
            await api(`/family-core/jobs/${job.id}/status`, 'POST', {
                status: 'failed',
                note: `Worker failed: ${err.message}`
            }).catch(() => {});
            results.push({ id: job.id, ok: false, error: err.message });
        }
    }

    const processed = results.filter(result => result.ok).length;
    const failed = results.filter(result => !result.ok).length;
    await writeWorkerStatus({
        state: failed ? 'degraded' : 'running',
        lastPollAt: new Date().toISOString(),
        lastProcessedAt: results.length ? new Date().toISOString() : null,
        processed,
        failed,
        lastResults: results.slice(-5)
    });

    return results;
}

async function loop() {
    console.log(`[family-core-worker] base=${BASE_URL} inbox=${INBOX_DIR} interval_ms=${INTERVAL_MS}`);
    while (true) {
        try {
            const results = await processQueuedJobs();
            if (results.length) console.log(`[family-core-worker] processed ${JSON.stringify(results)}`);
        } catch (err) {
            console.error(`[family-core-worker] ${err.message}`);
        }
        if (RUN_ONCE) break;
        await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    loop().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
