import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8791';
const DEFAULT_LAN_URL = 'http://192.168.1.198:8791';
const DEFAULT_SITE_URL = 'https://family-knowledge-library.igor-gonchar-6186.chatgpt.site';
const WINDOWS_HOST = 'Igor-Gaming';
const WINDOWS_LAN_CANDIDATES = ['192.168.1.217', '192.168.1.218'];
const WINDOWS_PORTS = [
    { name: 'rdp', port: 3389 },
    { name: 'smb', port: 445 },
    { name: 'winrm', port: 5985 },
    { name: 'ssh', port: 22 },
    { name: 'http', port: 80 },
    { name: 'https', port: 443 },
    { name: 'vnc', port: 5900 }
];

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);
const getArg = (name, fallback = null) => {
    const idx = args.indexOf(name);
    return idx === -1 ? fallback : args[idx + 1];
};

const bridgeUrl = getArg('--bridge-url', process.env.FAMILY_CORE_BRIDGE_URL || DEFAULT_BRIDGE_URL);
const lanUrl = getArg('--lan-url', process.env.FAMILY_CORE_LAN_URL || DEFAULT_LAN_URL);
const siteUrl = getArg('--site-url', process.env.FAMILY_CORE_SITE_URL || DEFAULT_SITE_URL);
const jsonOnly = hasArg('--json');

async function fetchJson(url) {
    const res = await fetch(url);
    const text = await res.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    return { ok: res.ok, status: res.status, body };
}

async function fetchText(url) {
    const res = await fetch(url);
    return { ok: res.ok, status: res.status, body: await res.text() };
}

async function headStatus(url) {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual' });
    return { status: res.status, ok: res.ok };
}

async function ping(host) {
    try {
        await execFileAsync('ping', ['-c', '1', '-W', '1000', host], { timeout: 2500 });
        return true;
    } catch {
        return false;
    }
}

async function arpStatus(host) {
    try {
        const { stdout } = await execFileAsync('arp', ['-n', host], { timeout: 2500 });
        const line = stdout.split('\n').find((row) => row.includes(host)) || '';
        if (!line) return { found: false, state: 'missing' };
        if (line.includes('(incomplete)')) return { found: true, state: 'incomplete' };
        const mac = line.match(/ at ([0-9a-f:]{11,17}) /i)?.[1] || null;
        return { found: true, state: mac ? 'resolved' : 'unknown', mac };
    } catch {
        return { found: false, state: 'missing' };
    }
}

async function portOpen(host, port) {
    try {
        await execFileAsync('nc', ['-z', '-G', '1', host, String(port)], { timeout: 2500 });
        return true;
    } catch {
        return false;
    }
}

async function readLanCandidate(host) {
    const [reachable, arp, ports] = await Promise.all([
        ping(host),
        arpStatus(host),
        Promise.all(WINDOWS_PORTS.map(async (item) => ({
            ...item,
            open: await portOpen(host, item.port)
        })))
    ]);
    return {
        host,
        reachable,
        arp,
        openPorts: ports.filter((item) => item.open)
    };
}

async function readWindowsTailnet() {
    try {
        const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: 5000 });
        const status = JSON.parse(stdout);
        const peer = Object.values(status.Peer || {}).find((item) => item.HostName === WINDOWS_HOST);
        if (!peer) return { found: false, online: false };
        return {
            found: true,
            online: Boolean(peer.Online),
            tailscaleIps: peer.TailscaleIPs || [],
            lastSeen: peer.LastSeen || null,
            curAddr: peer.CurAddr || ''
        };
    } catch (err) {
        return { found: false, online: false, error: err.message };
    }
}

async function buildReport() {
    const report = {
        ok: false,
        checkedAt: new Date().toISOString(),
        bridge: {
            url: bridgeUrl,
            ok: false
        },
        phone: {
            lanUrl,
            shareEntrypoint: `${lanUrl}/share`,
            ok: false
        },
        site: {
            url: siteUrl,
            private: false
        },
        windows: {
            host: WINDOWS_HOST,
            lanCandidates: WINDOWS_LAN_CANDIDATES.map((host) => ({ host, reachable: false })),
            reachable: false
        }
    };

    try {
        const status = await fetchJson(`${bridgeUrl}/status`);
        report.bridge.statusCode = status.status;
        if (status.ok && status.body?.ok) {
            report.bridge.ok = true;
            report.bridge.version = status.body.version;
            report.bridge.queuedFamilyCoreJobs = status.body.queuedFamilyCoreJobs;
            report.bridge.familyCoreInboxCount = status.body.familyCoreInboxCount;
            report.bridge.workerState = status.body.familyCoreWorker?.state || 'unknown';
            report.bridge.workerAgeMs = status.body.familyCoreWorker?.ageMs ?? null;
        }
    } catch (err) {
        report.bridge.error = err.message;
    }

    try {
        const inbox = await fetchJson(`${bridgeUrl}/family-core/inbox?limit=5`);
        report.bridge.inboxApiOk = inbox.ok && Array.isArray(inbox.body?.items);
        report.bridge.inboxReturned = Array.isArray(inbox.body?.items) ? inbox.body.items.length : 0;
    } catch (err) {
        report.bridge.inboxError = err.message;
    }

    try {
        const share = await fetchText(`${lanUrl}/share?title=Status%20check&text=Ready%20for%20Mac`);
        report.phone.shareStatusCode = share.status;
        report.phone.ok = share.ok
            && share.body.includes('Family Core')
            && share.body.includes('importFamilySharePayload')
            && share.body.includes('Mac Inbox');
    } catch (err) {
        report.phone.error = err.message;
    }

    try {
        const site = await headStatus(siteUrl);
        report.site.statusCode = site.status;
        report.site.private = site.status === 401;
        report.site.ok = report.site.private;
    } catch (err) {
        report.site.error = err.message;
    }

    report.windows.tailnet = await readWindowsTailnet();
    report.windows.lanCandidates = await Promise.all(WINDOWS_LAN_CANDIDATES.map(readLanCandidate));
    report.windows.reachable = Boolean(report.windows.tailnet.online)
        || report.windows.lanCandidates.some((candidate) => candidate.reachable || candidate.openPorts.length);

    report.ok = Boolean(
        report.bridge.ok
        && report.bridge.inboxApiOk
        && report.phone.ok
        && report.site.ok
    );

    return report;
}

function printHuman(report) {
    console.log(`Family Core section check: ${report.ok ? 'OK' : 'ATTENTION'}`);
    console.log(`- Bridge: ${report.bridge.ok ? 'running' : 'not ready'} v${report.bridge.version || 'unknown'}, worker=${report.bridge.workerState || 'unknown'}, inbox=${report.bridge.familyCoreInboxCount ?? 'unknown'}`);
    console.log(`- Phone share: ${report.phone.ok ? 'ready' : 'not ready'} (${report.phone.shareEntrypoint})`);
    console.log(`- Published site: ${report.site.private ? 'private/owner-only' : 'attention'} (${report.site.url})`);
    console.log(`- Windows PC: ${report.windows.reachable ? 'reachable' : 'offline / physical check needed'}`);
    for (const candidate of report.windows.lanCandidates) {
        const ports = candidate.openPorts.map((item) => `${item.name}:${item.port}`).join(', ') || 'none';
        console.log(`  - ${candidate.host}: ping=${candidate.reachable ? 'yes' : 'no'}, arp=${candidate.arp?.state || 'unknown'}, open_ports=${ports}`);
    }
}

const report = await buildReport();
if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
} else {
    printHuman(report);
}

process.exitCode = report.ok ? 0 : 1;
