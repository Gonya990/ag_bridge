import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import { mkdtemp, rm, readdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path, { join } from 'path';
import { app, server } from '../server.mjs';

const ROOT = path.resolve(__dirname, '..');
const GITIGNORE = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf-8');

let baseUrl;
let inboxDir;
let statusFile;

describe('Family Core worker', () => {
    beforeAll(async () => {
        inboxDir = await mkdtemp(join(tmpdir(), 'family-core-worker-'));
        statusFile = join(inboxDir, '..', 'family-core-worker-status.json');
        await new Promise((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                baseUrl = `http://127.0.0.1:${address.port}`;
                resolve();
            });
        });
        process.env.FAMILY_CORE_BASE_URL = baseUrl;
        process.env.FAMILY_CORE_INBOX_DIR = inboxDir;
        process.env.FAMILY_CORE_STATUS_FILE = statusFile;
    });

    afterAll(async () => {
        delete process.env.FAMILY_CORE_BASE_URL;
        delete process.env.FAMILY_CORE_INBOX_DIR;
        delete process.env.FAMILY_CORE_STATUS_FILE;
        await new Promise(resolve => server.close(resolve));
        await rm(inboxDir, { recursive: true, force: true });
    });

    it('saves queued phone jobs to the local Mac inbox and marks them done', async () => {
        const createRes = await fetch(`${baseUrl}/family-core/jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Save library source',
                source: 'phone',
                note: 'Keep this on the Mac first',
                payload: { sourceUrl: 'https://example.test/source' }
            })
        });
        const created = await createRes.json();
        expect(created.ok).toBe(true);

        const worker = await import('../scripts/family-core-worker.mjs');
        const results = await worker.processQueuedJobs();

        const processed = results.find(result => result.id === created.job.id);
        expect(processed.ok).toBe(true);

        const files = await readdir(inboxDir);
        expect(files.some(file => file.endsWith('.json'))).toBe(true);
        expect(files.some(file => file.endsWith('.md'))).toBe(true);
        expect(files).toContain('README.md');

        const markdownFile = files.find(file => file.endsWith('.md') && file !== 'README.md');
        const markdown = await readFile(join(inboxDir, markdownFile), 'utf-8');
        expect(markdown).toContain('# Save library source');
        expect(markdown).toContain('Keep this on the Mac first');

        const index = await readFile(join(inboxDir, 'README.md'), 'utf-8');
        expect(index).toContain('# Family Core Mac inbox');
        expect(index).toContain(`id=${created.job.id}`);
        expect(index).toContain('title=Save library source');

        const jsonIndex = JSON.parse(await readFile(join(inboxDir, 'index.json'), 'utf-8'));
        expect(jsonIndex.items[0].id).toBe(created.job.id);
        expect(jsonIndex.items[0].title).toBe('Save library source');
        expect(jsonIndex.items[0].mdFile).toContain('.md');
        expect(jsonIndex.items[0].jsonFile).toContain('.json');

        const jobsRes = await fetch(`${baseUrl}/family-core/jobs?status=done&limit=20`);
        const jobs = await jobsRes.json();
        const updated = jobs.jobs.find(job => job.id === created.job.id);
        expect(updated.status).toBe('done');
        expect(updated.note).toContain('Saved locally on Mac');

        const status = JSON.parse(await readFile(statusFile, 'utf-8'));
        expect(status.worker).toBe('family-core-worker');
        expect(status.state).toBe('running');
        expect(status.processed).toBeGreaterThanOrEqual(1);
    });

    it('keeps the local Mac inbox out of Git', () => {
        expect(GITIGNORE).toContain('data/family-core-inbox/');
        expect(GITIGNORE).toContain('data/family-core-worker-status.json');
    });
});
