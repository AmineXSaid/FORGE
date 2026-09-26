/**
 * Strict rules for every model behind the company gateway, whatever the
 * profile is called.
 *
 * Asked for on 2026-09-25: "any model coming from this endpoint
 * https://gpt.technica-engineering.net/v1 must follow strict rules (the name of
 * the endpoint can be changed from user to user)". The rules ship with Forge
 * and are matched on the host of the profile's baseUrl.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { composeSystemPromptAppend, endpointRulesFor, ENDPOINT_RULES_DIR, rulesHost } from '../src/services/endpoints/endpointRules';

const ROOT = path.join(__dirname, '..');
const resolve = (relative: string) => path.join(ROOT, relative);

describe('the host a profile is matched on', () => {
    it('is the baseUrl host, whatever the path', () => {
        expect(rulesHost('https://gpt.technica-engineering.net/v1')).toBe('gpt.technica-engineering.net');
        expect(rulesHost('https://gpt.technica-engineering.net/api/v1')).toBe('gpt.technica-engineering.net');
        expect(rulesHost('https://GPT.Technica-Engineering.net:8443/api/v1/')).toBe('gpt.technica-engineering.net');
    });

    it('is nothing for a URL that has no plain DNS host, so no path can be built from it', () => {
        expect(rulesHost(undefined)).toBeUndefined();
        expect(rulesHost('not a url')).toBeUndefined();
        expect(rulesHost('http://[::1]:8080/v1')).toBeUndefined();
    });
});

describe('the rules Forge ships for the company gateway', () => {
    it('apply to any profile on that host, whatever the user named it', () => {
        for (const baseUrl of ['https://gpt.technica-engineering.net/api/v1', 'https://gpt.technica-engineering.net/v1']) {
            const rules = endpointRulesFor(baseUrl, resolve);
            expect(rules?.host).toBe('gpt.technica-engineering.net');
            expect(rules?.text).toMatch(/Answer what was asked, directly/);
            expect(rules?.text).toMatch(/Do not start subagents/);
            expect(rules?.text).toMatch(/Read a file once, and run a search once/);
        }
    });

    it('do not apply to another gateway', () => {
        expect(endpointRulesFor('https://llm.internal.example/v1', resolve)).toBeUndefined();
        expect(endpointRulesFor('http://127.0.0.1:11434/v1', resolve)).toBeUndefined();
    });

    it('treat an empty rules file as none', () => {
        expect(endpointRulesFor('https://gpt.technica-engineering.net/v1', resolve, () => '  \n')).toBeUndefined();
    });

    it('ship in the VSIX: nothing in .vscodeignore drops the folder', () => {
        expect(fs.existsSync(path.join(ROOT, ENDPOINT_RULES_DIR, 'gpt.technica-engineering.net.md'))).toBe(true);
        const ignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
        expect(ignore.filter((l) => l && !l.startsWith('#') && (l.startsWith('resources/endpoint-rules') || l === 'resources/**' || l === '**/*.md'))).toEqual([]);
    });
});

describe('the system prompt append', () => {
    it('is Forge’s, then an agent’s, then the gateway’s rules, skipping what is absent', () => {
        expect(composeSystemPromptAppend('forge', undefined, 'rules')).toBe('forge\n\nrules');
        expect(composeSystemPromptAppend('forge', 'agent', 'rules')).toBe('forge\n\nagent\n\nrules');
        expect(composeSystemPromptAppend('forge', undefined, undefined)).toBe('forge');
    });
});
