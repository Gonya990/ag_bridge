import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf-8');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/family_core_mobile_handoff.md'), 'utf-8');
const GITIGNORE = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf-8');

describe('Launchd pairing code handoff', () => {
    it('writes the active pairing code to a local-only ignored file', () => {
        expect(SERVER).toContain('PAIRING_CODE_FILE');
        expect(SERVER).toContain('pairing-code-${PORT}.txt');
        expect(SERVER).toContain('pairing_code=${PAIRING_CODE}');
        expect(SERVER).toContain('0o600');
    });

    it('documents how to find the launchd pairing code', () => {
        expect(DOC).toContain('.logs/pairing-code-8791.txt');
        expect(DOC).toContain('chmod 600');
    });

    it('keeps runtime logs and pairing files out of Git', () => {
        expect(GITIGNORE).toContain('.logs/');
        expect(GITIGNORE).toContain('*.log');
    });
});
