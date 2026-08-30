import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.mjs';

describe('Family Core job queue', () => {
    let jobId;

    it('serves the mobile share entrypoint', async () => {
        const res = await request(app).get('/share?title=Shared%20task&text=From%20phone');

        expect(res.status).toBe(200);
        expect(res.text).toContain('Family Core');
        expect(res.text).toContain('function importFamilySharePayload()');
    });

    it('creates a local Mac processing job', async () => {
        const res = await request(app)
            .post('/family-core/jobs')
            .send({
                title: 'Process mobile library item',
                note: 'Sent from phone',
                source: 'phone',
                payload: { itemId: 'demo-item' }
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.job.title).toBe('Process mobile library item');
        expect(res.body.job.status).toBe('queued');
        expect(res.body.job.payload.itemId).toBe('demo-item');
        jobId = res.body.job.id;
    });

    it('lists queued Family Core jobs newest first', async () => {
        const res = await request(app).get('/family-core/jobs?status=queued&limit=10');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.jobs.some(job => job.id === jobId)).toBe(true);
    });

    it('updates Family Core job status', async () => {
        let res = await request(app)
            .post(`/family-core/jobs/${jobId}/status`)
            .send({ status: 'processing' });

        expect(res.status).toBe(200);
        expect(res.body.job.status).toBe('processing');

        res = await request(app)
            .post(`/family-core/jobs/${jobId}/status`)
            .send({ status: 'done', note: 'Processed on Mac' });

        expect(res.status).toBe(200);
        expect(res.body.job.status).toBe('done');
        expect(res.body.job.note).toBe('Processed on Mac');
    });

    it('rejects stale Family Core job status transitions', async () => {
        const createRes = await request(app)
            .post('/family-core/jobs')
            .send({
                title: 'Atomic claim candidate',
                source: 'phone'
            });
        const claimId = createRes.body.job.id;

        const res = await request(app)
            .post(`/family-core/jobs/${claimId}/status`)
            .send({ status: 'processing', fromStatus: 'done' });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('status_mismatch');
        expect(res.body.currentStatus).toBe('queued');
    });

    it('rejects invalid Family Core job status values', async () => {
        const res = await request(app)
            .post(`/family-core/jobs/${jobId}/status`)
            .send({ status: 'published' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_status');
    });

    it('returns the local Mac inbox summary', async () => {
        const res = await request(app).get('/family-core/inbox?limit=5');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('does not include saved inbox file contents in the summary API', async () => {
        const res = await request(app).get('/family-core/inbox?limit=5');

        expect(res.status).toBe(200);
        for (const item of res.body.items) {
            expect(item).not.toHaveProperty('payload');
            expect(item).not.toHaveProperty('note');
            expect(item).not.toHaveProperty('content');
        }
    });
});
