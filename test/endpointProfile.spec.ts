/**
 * Phase 1: the endpoint configuration surface.
 *
 * Two sources now describe a profile -- `forge.endpoints` in settings.json and
 * the YAML directory -- and the whole point of the refactor is that they go
 * through one validator. So the tests that matter are the ones proving the two
 * cannot drift: same required fields, same defaults, same rejections, and a
 * defined winner when both define the same name.
 *
 * The schema test is the other half. `package.json` is what gives settings.json
 * its IntelliSense and validation, and it is hand-written JSON sitting a long
 * way from `DEFAULT_CAPS`. A capability added to the type and forgotten in the
 * schema would be silently rejected by VS Code as an unknown key -- the user
 * sets it, sees a squiggle, and the feature never turns on. That is exactly the
 * kind of failure nobody debugs quickly, so it gets a drift guard.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  ProfileError,
  loadProfile,
  parseProfile,
  parseProfileMap,
} from '../src/services/endpoints/profile';
import { EndpointService } from '../src/services/endpoints/endpointService';
import pkg from '../package.json';

/** The smallest document `parseProfile` accepts. */
const MINIMAL = { name: 'gw', wire: 'openai', baseUrl: 'https://gw.example/v1', model: 'llama-3.3-70b' };

describe('parseProfile: one validator for both sources', () => {
  it('accepts a minimal profile and fills in the defaults', () => {
    const p = parseProfile(MINIMAL, 'test');
    expect(p.auth).toEqual({ kind: 'none' });
    expect(p.timeoutMs).toBe(120_000);
    expect(p.retries).toBe(2);
    expect(p.capabilities.contextWindow).toBe(32000);
  });

  it.each(['name', 'wire', 'baseUrl', 'model'])('rejects a profile with no %s', (field) => {
    const doc: Record<string, unknown> = { ...MINIMAL };
    delete doc[field];
    expect(() => parseProfile(doc, 'test')).toThrow(ProfileError);
    expect(() => parseProfile(doc, 'test')).toThrow(new RegExp(field));
  });

  it('names the source in the error, so a typo is traceable', () => {
    expect(() => parseProfile({}, 'settings: forge.endpoints.oops')).toThrow(ProfileError);
    try {
      parseProfile({}, 'settings: forge.endpoints.oops');
    } catch (e) {
      expect((e as ProfileError).file).toBe('settings: forge.endpoints.oops');
    }
  });

  it('rejects an unknown wire', () => {
    expect(() => parseProfile({ ...MINIMAL, wire: 'grpc' }, 'test')).toThrow(/wire must be/);
  });

  it('rejects wire: raw without a transform, which could only ever fail', () => {
    expect(() => parseProfile({ ...MINIMAL, wire: 'raw' }, 'test')).toThrow(/requires a transform/);
    expect(parseProfile({ ...MINIMAL, wire: 'raw', transform: './t.js' }, 'test').wire).toBe('raw');
  });

  it('rejects an image block with no model', () => {
    expect(() => parseProfile({ ...MINIMAL, image: {} }, 'test')).toThrow(/image.model is required/);
    expect(() => parseProfile({ ...MINIMAL, image: 'yes' }, 'test')).toThrow(/must be a block/);
  });

  describe('the capability fields that gate Anthropic-logic UI', () => {
    it('defaults effort off, because an ignored knob is worse than a hidden one', () => {
      const caps = parseProfile(MINIMAL, 'test').capabilities;
      expect(caps.effort).toBe(false);
      expect(caps.fastMode).toBe(false);
      expect(caps.reasoningField).toBe('none');
      expect(caps.effortLevels).toEqual(['low', 'medium', 'high']);
    });

    it('omits xhigh by default, so Ultracode is not offered until declared', () => {
      expect(parseProfile(MINIMAL, 'test').capabilities.effortLevels).not.toContain('xhigh');
      const withX = parseProfile(
        { ...MINIMAL, capabilities: { effort: true, effortLevels: ['low', 'high', 'xhigh'] } },
        'test',
      );
      expect(withX.capabilities.effortLevels).toContain('xhigh');
    });

    it('merges a partial capability block over the defaults rather than replacing it', () => {
      const caps = parseProfile({ ...MINIMAL, capabilities: { effort: true } }, 'test').capabilities;
      expect(caps.effort).toBe(true);
      // Untouched neighbours survive.
      expect(caps.tools).toBe(true);
      expect(caps.contextWindow).toBe(32000);
    });

    it('rejects a malformed effortLevels instead of producing a slider with no positions', () => {
      expect(() => parseProfile({ ...MINIMAL, capabilities: { effortLevels: 'high' } }, 'test'))
        .toThrow(/effortLevels must be an array of strings/);
      expect(() => parseProfile({ ...MINIMAL, capabilities: { effortLevels: [1, 2] } }, 'test'))
        .toThrow(/effortLevels must be an array of strings/);
    });
  });
});

describe('parseProfileMap: the forge.endpoints settings map', () => {
  it('takes the profile name from the map key', () => {
    const { profiles, errors } = parseProfileMap({
      'company-llama': { wire: 'openai', baseUrl: 'https://x/v1', model: 'm' },
    });
    expect(errors).toEqual([]);
    expect(profiles[0].name).toBe('company-llama');
    expect(profiles[0].origin).toBe('settings');
  });

  it('lets the key win over an explicit name, because the key is what selects it', () => {
    const { profiles } = parseProfileMap({
      real: { name: 'stale', wire: 'openai', baseUrl: 'https://x/v1', model: 'm' },
    });
    expect(profiles[0].name).toBe('real');
  });

  it('isolates a bad entry so one typo does not hide every other profile', () => {
    const { profiles, errors } = parseProfileMap({
      good: { wire: 'openai', baseUrl: 'https://x/v1', model: 'm' },
      bad: { wire: 'openai', baseUrl: 'https://x/v1' },
    });
    expect(profiles.map((p) => p.name)).toEqual(['good']);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe('settings: forge.endpoints.bad');
    expect(errors[0].message).toMatch(/model/);
  });

  it('treats an absent map as no profiles, not as an error', () => {
    expect(parseProfileMap(undefined)).toEqual({ profiles: [], errors: [] });
  });
});

describe('package.json schema: the contract settings.json is validated against', () => {
  const props = (pkg as any).contributes.configuration.properties;
  const profileSchema = props['forge.endpoints'].additionalProperties;

  it('declares all three endpoint settings, which were previously invisible', () => {
    expect(props['forge.endpoints']).toBeDefined();
    expect(props['forge.endpointProfile']).toBeDefined();
    expect(props['forge.endpointProfilesDir']).toBeDefined();
  });

  it('requires exactly the fields parseProfile requires, minus the map key', () => {
    // `name` comes from the key in settings, so the schema must not demand it.
    expect(profileSchema.required.sort()).toEqual(['baseUrl', 'model', 'wire']);
  });

  it('offers the same three wires the validator accepts', () => {
    expect(profileSchema.properties.wire.enum).toEqual(['openai', 'anthropic', 'raw']);
  });

  it('declares every capability the defaults carry', () => {
    // Drift guard: a capability in DEFAULT_CAPS but not here is rejected by
    // VS Code as an unknown key, so the user can never turn the feature on.
    const declared = Object.keys(profileSchema.properties.capabilities.properties).sort();
    const actual = Object.keys(parseProfile(MINIMAL, 'test').capabilities).sort();
    expect(declared).toEqual(actual);
  });

  it('agrees with the defaults on every capability default value', () => {
    const declared = profileSchema.properties.capabilities.properties;
    const actual = parseProfile(MINIMAL, 'test').capabilities as Record<string, unknown>;
    for (const [key, schema] of Object.entries<any>(declared)) {
      if (schema.default === undefined) continue;
      expect({ [key]: schema.default }).toEqual({ [key]: actual[key] });
    }
  });

  it('keeps the effort ladder in the schema aligned with the CLI rungs', () => {
    expect(profileSchema.properties.capabilities.properties.effortLevels.items.enum)
      .toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('documents the reasoning fields the bridge knows how to read', () => {
    expect(profileSchema.properties.capabilities.properties.reasoningField.enum)
      .toEqual(['reasoning_content', 'reasoning', 'none']);
  });
});

describe('EndpointService.listProfiles: two sources, one winner', () => {
  let dir: string;
  let warnings: string[];
  let service: EndpointService;
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  /** Point the service at a temp YAML dir and a given forge.endpoints map. */
  function configure(endpoints: Record<string, unknown>): void {
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, fallback?: unknown) =>
        key === 'endpoints' ? endpoints
          : key === 'endpointProfilesDir' ? dir
            : fallback,
      update: () => Promise.resolve(),
    });
  }

  function writeYaml(name: string, body: string): void {
    fs.writeFileSync(path.join(dir, `${name}.yaml`), body, 'utf8');
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-endpoints-'));
    warnings = [];
    // `undefined` context: DI passes static args before injected services
    // (`SyncDescriptor(EndpointService, [context])`), and these tests never
    // touch SecretStorage, so the lookup falls back to the environment.
    service = new EndpointService(undefined, {
      info: () => { },
      warn: (m: string) => warnings.push(m),
      error: () => { },
    } as any);
  });

  afterEach(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns profiles from both sources', () => {
    writeYaml('from-file', 'name: from-file\nwire: anthropic\nbaseUrl: https://f/v1\nmodel: mf\n');
    configure({ 'from-settings': { wire: 'openai', baseUrl: 'https://s/v1', model: 'ms' } });

    const { profiles } = service.listProfiles();
    expect(profiles.map((p) => p.name).sort()).toEqual(['from-file', 'from-settings']);
  });

  it('lets settings win a name collision, and says so rather than shadowing silently', () => {
    writeYaml('dup', 'name: dup\nwire: anthropic\nbaseUrl: https://file/v1\nmodel: file-model\n');
    configure({ dup: { wire: 'openai', baseUrl: 'https://settings/v1', model: 'settings-model' } });

    const { profiles } = service.listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].model).toBe('settings-model');
    expect(profiles[0].origin).toBe('settings');
    expect(warnings.join('\n')).toMatch(/defined both in forge.endpoints and in/);
  });

  it('surfaces parse errors from both sources together', () => {
    writeYaml('broken', 'name: broken\nwire: openai\nbaseUrl: https://f/v1\n');
    configure({ alsoBroken: { wire: 'nope', baseUrl: 'https://s/v1', model: 'm' } });

    const { profiles, errors } = service.listProfiles();
    expect(profiles).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => /model/.test(e.message))).toBe(true);
    expect(errors.some((e) => /wire must be/.test(e.message))).toBe(true);
  });

  it('reports no profiles rather than throwing when neither source exists', () => {
    fs.rmSync(dir, { recursive: true, force: true });
    configure({});
    expect(service.listProfiles()).toEqual({ profiles: [], errors: [] });
  });
});

describe('loadProfile: the YAML wrapper keeps its own metadata', () => {
  it('records the file it came from and marks the origin', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-endpoints-'));
    const file = path.join(dir, 'p.yaml');
    fs.writeFileSync(file, 'name: p\nwire: openai\nbaseUrl: https://x/v1\nmodel: m\n', 'utf8');
    try {
      const p = loadProfile(file);
      expect(p.sourceFile).toBe(file);
      expect(p.origin).toBe('file');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a YAML syntax error against the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-endpoints-'));
    const file = path.join(dir, 'bad.yaml');
    fs.writeFileSync(file, 'name: [unclosed\n', 'utf8');
    try {
      expect(() => loadProfile(file)).toThrow(/Could not parse YAML/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
