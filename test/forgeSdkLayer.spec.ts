/**
 * The Forge SDK layer's one rule: it is built on the Claude SDK / CLI and on
 * Node, never on the editor. Nothing under src/forge-sdk may import `vscode`
 * or reach up into src/services, so any host (the extension, a terminal
 * launcher, a future standalone CLI) can use it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', 'src', 'forge-sdk');

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const file = join(dir, name);
        return statSync(file).isDirectory() ? files(file) : file.endsWith('.ts') ? [file] : [];
    });
}

describe('the Forge SDK layer', () => {
    it('has modules to check', () => {
        expect(files(ROOT).length).toBeGreaterThan(5);
    });

    it.each(files(ROOT).map((f) => [relative(ROOT, f), f]))('%s imports neither vscode nor src/services', (_name, file) => {
        const source = readFileSync(file, 'utf8');
        const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
        for (const spec of imports) {
            expect(spec, spec).not.toBe('vscode');
            expect(spec, spec).not.toMatch(/(^|\/)services(\/|$)/);
        }
    });

    it('the extension takes the guards from the layer, not from its own copies', () => {
        const sdk = readFileSync(join(__dirname, '..', 'src', 'services', 'claude', 'ClaudeSdkService.ts'), 'utf8');
        expect(sdk).toContain("from '../../forge-sdk/guards/guardHooks'");
        expect(sdk).not.toMatch(/repeatGuard\.check\(|loopGuard\.record\(|stopGate\.onStop\(/);
    });
});
