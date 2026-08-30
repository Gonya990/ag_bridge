import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const STATUS_SCRIPT = fs.readFileSync(path.join(ROOT, 'scripts/family-core-status.mjs'), 'utf-8');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/family_core_mobile_handoff.md'), 'utf-8');

describe('Family Core section status check', () => {
    it('exposes a single npm command for the whole-section status check', () => {
        expect(PACKAGE_JSON.scripts['status:family-core']).toBe('node scripts/family-core-status.mjs');
        expect(DOC).toContain('npm run status:family-core');
    });

    it('checks the bridge, phone share route, published site, and Windows visibility', () => {
        expect(STATUS_SCRIPT).toContain('/status');
        expect(STATUS_SCRIPT).toContain('/family-core/inbox?limit=5');
        expect(STATUS_SCRIPT).toContain('/share?title=Status%20check');
        expect(STATUS_SCRIPT).toContain('family-knowledge-library.igor-gonchar-6186.chatgpt.site');
        expect(STATUS_SCRIPT).toContain('Igor-Gaming');
        expect(STATUS_SCRIPT).toContain('192.168.1.217');
        expect(STATUS_SCRIPT).toContain('192.168.1.218');
        expect(STATUS_SCRIPT).toContain("execFileAsync('arp'");
        expect(STATUS_SCRIPT).toContain("execFileAsync('nc'");
        expect(STATUS_SCRIPT).toContain('WINDOWS_PORTS');
        expect(STATUS_SCRIPT).toContain('openPorts');
    });

    it('does not read or print pairing codes or saved file contents', () => {
        expect(STATUS_SCRIPT).not.toContain('pairing-code');
        expect(STATUS_SCRIPT).not.toContain('PAIRING_CODE');
        expect(STATUS_SCRIPT).not.toContain('ag-token');
        expect(STATUS_SCRIPT).not.toContain('x-ag-token');
    });
});
