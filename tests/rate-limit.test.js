import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf-8');

describe('rate limiting coverage', () => {
    it('rate-limits the share route before serving local files', () => {
        expect(SERVER).toContain("import rateLimit from 'express-rate-limit'");
        expect(SERVER).toContain('const shareRouteLimiter = rateLimit');
        expect(SERVER).toContain("app.get('/share', shareRouteLimiter");
    });
});
