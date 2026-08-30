import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf-8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.json'), 'utf-8'));
const SERVICE_WORKER = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf-8');

function count(pattern) {
    return (HTML.match(pattern) || []).length;
}

describe('Mobile Family Core UI', () => {
    it('keeps a single mobile viewport declaration', () => {
        expect(count(/<meta name="viewport"/g)).toBe(1);
    });

    it('shows the current app version and Family Core handoff controls', () => {
        expect(HTML).toContain('id="app-version"');
        expect(HTML).toContain('v0.6.0');
        expect(HTML).toContain('id="family-job-title"');
        expect(HTML).toContain('id="family-job-note"');
        expect(HTML).toContain('id="family-submit-btn"');
        expect(HTML).toContain('id="worker-status-pill"');
        expect(HTML).toContain('id="family-inbox-list"');
        expect(HTML).toContain('Send to Mac');
    });

    it('preserves phone drafts until a job is sent', () => {
        expect(HTML).toContain("const FAMILY_DRAFT_KEY = 'family-core-draft'");
        expect(HTML).toContain('function writeFamilyDraft()');
        expect(HTML).toContain('function restoreFamilyDraft()');
        expect(HTML).toContain('function bindFamilyDraftAutosave()');
        expect(HTML).toContain('localStorage.removeItem(FAMILY_DRAFT_KEY)');
    });

    it('uses one polling timer and animated queue transitions', () => {
        expect(HTML).toContain('let POLL_TIMER = null');
        expect(HTML).toContain('if (POLL_TIMER) return');
        expect(HTML).toContain('POLL_TIMER = setInterval');
        expect(HTML).toContain('@keyframes item-in');
        expect(HTML).toContain('animation: item-in');
    });

    it('shows the Mac worker status from /status', () => {
        expect(HTML).toContain('function updateWorkerUI(worker)');
        expect(HTML).toContain('data.familyCoreWorker');
        expect(HTML).toContain('Worker:');
    });

    it('shows saved Mac inbox items without serving file contents', () => {
        expect(HTML).toContain("api('/family-core/inbox?limit=10')");
        expect(HTML).toContain('function renderFamilyCoreInbox(items)');
        expect(HTML).toContain('familyCoreInboxCount');
        expect(HTML).toContain('Mac Inbox');
    });

    it('can import a mobile share into the Family Core draft', () => {
        expect(HTML).toContain('function getFamilySharePayload()');
        expect(HTML).toContain('function importFamilySharePayload()');
        expect(HTML).toContain('new URLSearchParams(window.location.search)');
        expect(HTML).toContain("source: 'share'");
        expect(HTML).toContain("window.history.replaceState({}, document.title, '/')");
    });

    it('declares the PWA share target and caches the share route shell', () => {
        expect(MANIFEST.share_target).toEqual({
            action: '/share',
            method: 'GET',
            params: {
                title: 'title',
                text: 'text',
                url: 'url'
            }
        });
        expect(MANIFEST.scope).toBe('/');
        expect(SERVICE_WORKER).toContain("const CACHE_NAME = 'ag-bridge-v2'");
        expect(SERVICE_WORKER).toContain("'/share'");
    });
});
