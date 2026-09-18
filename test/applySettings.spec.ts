/**
 * `apply_settings`: the official `tu$` whitelist, and the B6 precedence problem
 * it runs into in Forge.
 *
 * The whitelist is the security boundary — the webview is untrusted, and this
 * request writes a file the CLI reads on every launch. So the rejections are the
 * point: an unlisted key, a key aimed at the wrong layer, and a value of the
 * wrong type all have to fail before anything touches disk.
 *
 * The precedence tests cover the thing that is Forge-specific. Forge launches
 * the CLI with `--settings ~/.claude/forge.json`, which is the flag layer and
 * outranks user settings ("Flag settings sit above user/project/local",
 * `sdk.d.ts` L2729). If profile sync copied `effortLevel` into that file, a
 * profile would silently beat the user's own choice, forever.
 */
import { describe, expect, it } from 'vitest';
import {
  EXCLUSIVE_SCOPE_MESSAGE,
  FLAG_SETTINGS_RESERVED_KEYS,
  MALFORMED_APPLY_SETTINGS,
  WEBVIEW_WRITABLE_SETTINGS,
  mergeSettings,
  notWritableMessage,
  resolveSettingsLayer,
  stripFlagReservedKeys,
  unexpectedValueMessage,
  validateSettingsWrite,
} from '../src/services/claude/settingsWhitelist';

describe('tu$: which keys the webview may write', () => {
  it('holds only the in-scope keys', () => {
    // ultracode joined with step 13, after the user brought it into scope.
    expect(Object.keys(WEBVIEW_WRITABLE_SETTINGS)).toEqual(['effortLevel', 'ultracode']);
  });

  it('puts ultracode on the flag layer only, as the official does', () => {
    expect(WEBVIEW_WRITABLE_SETTINGS.ultracode.layer).toBe('flags');
    expect(validateSettingsWrite({ ultracode: true }, true)).toBe('flags');
    expect(validateSettingsWrite({ ultracode: false }, true)).toBe('flags');
  });

  it('lets ultracode be switched off with null, which its own check allows', () => {
    expect(validateSettingsWrite({ ultracode: null }, true)).toBe('flags');
  });

  it('rejects a non-boolean ultracode', () => {
    for (const value of ['true', 1, {}, []]) {
      expect(() => validateSettingsWrite({ ultracode: value }, true)).toThrow(unexpectedValueMessage('ultracode'));
    }
  });

  it('refuses ultracode aimed at a settings file', () => {
    expect(() => validateSettingsWrite({ ultracode: true })).toThrow(unexpectedValueMessage('ultracode'));
    expect(() => validateSettingsWrite({ ultracode: true }, false, 'localSettings')).toThrow(
      unexpectedValueMessage('ultracode')
    );
  });

  it('puts effortLevel in user settings, as the official does', () => {
    expect(WEBVIEW_WRITABLE_SETTINGS.effortLevel.layer).toBe('userSettings');
  });

  it('accepts every effort level the CLI takes', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh']) {
      expect(validateSettingsWrite({ effortLevel: level })).toBe('userSettings');
    }
  });

  it('refuses effortLevel: null, because the official value check refuses it', () => {
    // tu$.effortLevel.value is `typeof $ === "string"`; the official has no
    // null bypass, so effort cannot be cleared from the webview.
    expect(() => validateSettingsWrite({ effortLevel: null })).toThrow(unexpectedValueMessage('effortLevel'));
  });

  it('rejects the out-of-scope keys the official does list', () => {
    for (const key of ['switchModelsOnFlag', 'remoteControlAtStartup']) {
      expect(() => validateSettingsWrite({ [key]: true })).toThrow(notWritableMessage(key));
    }
  });

  it('rejects outputStyle until step 29 adds it', () => {
    expect(() => validateSettingsWrite({ outputStyle: 'explanatory' })).toThrow(notWritableMessage('outputStyle'));
  });

  it('rejects any other settings key, including dangerous ones', () => {
    for (const key of ['apiKeyHelper', 'permissions', 'env', 'hooks', 'awsAuthRefresh', 'model']) {
      expect(() => validateSettingsWrite({ [key]: 'x' })).toThrow(notWritableMessage(key));
    }
  });

  it('does not read the whitelist through the prototype chain', () => {
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(() => validateSettingsWrite({ [key]: 'x' })).toThrow();
    }
  });

  it('rejects a bad value type for a key that is on the list', () => {
    for (const value of [42, true, {}, ['high']]) {
      expect(() => validateSettingsWrite({ effortLevel: value })).toThrow(unexpectedValueMessage('effortLevel'));
    }
  });

  it('rejects the whole patch if any one key is bad, before anything is written', () => {
    expect(() => validateSettingsWrite({ effortLevel: 'high', remoteControlAtStartup: true })).toThrow(
      notWritableMessage('remoteControlAtStartup')
    );
    // Both keys are on the list, but not on the same layer: one patch cannot hold them.
    expect(() => validateSettingsWrite({ effortLevel: 'xhigh', ultracode: true })).toThrow(
      unexpectedValueMessage('ultracode')
    );
  });
});

describe('the official request-shape check', () => {
  it('refuses settings that are not a plain object', () => {
    for (const settings of [null, undefined, 'effortLevel', 42, [], [['effortLevel', 'high']]]) {
      expect(() => validateSettingsWrite(settings)).toThrow(MALFORMED_APPLY_SETTINGS);
    }
  });

  it('refuses a flagsOnly that is not a boolean', () => {
    for (const flagsOnly of ['yes', 1, 0, null, {}]) {
      expect(() => validateSettingsWrite({ ultracode: true }, flagsOnly)).toThrow(MALFORMED_APPLY_SETTINGS);
    }
  });

  it('refuses a scope other than userSettings or localSettings', () => {
    for (const scope of ['flags', 'projectSettings', 'policySettings', '', 42]) {
      expect(() => validateSettingsWrite({ effortLevel: 'high' }, undefined, scope)).toThrow(MALFORMED_APPLY_SETTINGS);
    }
  });

  it('accepts an explicit userSettings scope', () => {
    expect(validateSettingsWrite({ effortLevel: 'high' }, undefined, 'userSettings')).toBe('userSettings');
  });
});

describe('the target layer has to match the key', () => {
  it('resolves the target the way the official does', () => {
    expect(resolveSettingsLayer(undefined, undefined)).toBe('userSettings');
    expect(resolveSettingsLayer(false, undefined)).toBe('userSettings');
    expect(resolveSettingsLayer(true, undefined)).toBe('flags');
    expect(resolveSettingsLayer(undefined, 'localSettings')).toBe('localSettings');
    expect(resolveSettingsLayer(undefined, 'somethingElse')).toBe('userSettings');
  });

  it('refuses to smuggle a userSettings key into the flag layer', () => {
    expect(() => validateSettingsWrite({ effortLevel: 'high' }, true)).toThrow(unexpectedValueMessage('effortLevel'));
  });

  it('refuses to write a userSettings key to local settings', () => {
    expect(() => validateSettingsWrite({ effortLevel: 'high' }, false, 'localSettings')).toThrow(
      unexpectedValueMessage('effortLevel')
    );
  });

  it('treats flagsOnly with a localSettings scope as contradictory', () => {
    expect(() => validateSettingsWrite({}, true, 'localSettings')).toThrow(EXCLUSIVE_SCOPE_MESSAGE);
  });

  it('checks the keys before the flagsOnly/localSettings clash, in the official order', () => {
    // The official only reaches the clash in writeUserSettingsAndPush, after the loop.
    expect(() => validateSettingsWrite({ effortLevel: 'high' }, true, 'localSettings')).toThrow(
      unexpectedValueMessage('effortLevel')
    );
    expect(() => validateSettingsWrite({ ultracode: true }, true, 'localSettings')).toThrow(EXCLUSIVE_SCOPE_MESSAGE);
  });

  it('accepts an empty patch', () => {
    expect(validateSettingsWrite({})).toBe('userSettings');
  });
});

describe('the settings file merge', () => {
  it('keeps every key it was not asked to change', () => {
    const current = { env: { A: '1' }, permissions: { allow: ['Bash'] }, effortLevel: 'low' };
    expect(mergeSettings(current, { effortLevel: 'high' })).toEqual({
      env: { A: '1' },
      permissions: { allow: ['Bash'] },
      effortLevel: 'high',
    });
  });

  it('adds a key that was not there', () => {
    expect(mergeSettings({ env: {} }, { effortLevel: 'high' })).toEqual({ env: {}, effortLevel: 'high' });
  });

  it('deletes on null rather than writing null', () => {
    const merged = mergeSettings({ effortLevel: 'high', env: {} }, { effortLevel: null });
    expect(merged).toEqual({ env: {} });
    expect('effortLevel' in merged).toBe(false);
  });

  it('does not mutate the file contents it was given', () => {
    const current = { effortLevel: 'low' };
    mergeSettings(current, { effortLevel: 'high' });
    expect(current).toEqual({ effortLevel: 'low' });
  });
});

describe('B6: forge.json must not outrank the user (CLAUDE.md B6)', () => {
  it('reserves exactly the keys apply_settings owns', () => {
    expect([...FLAG_SETTINGS_RESERVED_KEYS]).toEqual(Object.keys(WEBVIEW_WRITABLE_SETTINGS));
  });

  it("strips a profile's effortLevel, so the user's own choice survives the next launch", () => {
    const profile = { effortLevel: 'low', model: 'opus', env: { A: '1' } };
    const synced = stripFlagReservedKeys(profile);
    expect('effortLevel' in synced).toBe(false);
    // Without this, forge.json (flag layer) would pin 'low' over the user's
    // 'high' in ~/.claude/settings.json on every launch.
    expect(synced).toEqual({ model: 'opus', env: { A: '1' } });
  });

  it('leaves everything else a profile overlays alone', () => {
    const profile = {
      model: 'opus',
      env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      permissions: { allow: ['Bash'] },
      mcpServers: { x: {} },
    };
    expect(stripFlagReservedKeys(profile)).toEqual(profile);
  });

  it('strips ultracode too: it is session-scoped, and the UI must be able to turn it off', () => {
    expect(stripFlagReservedKeys({ ultracode: true, model: 'opus' })).toEqual({ model: 'opus' });
  });

  it('is a no-op for a profile that never mentioned the reserved keys', () => {
    expect(stripFlagReservedKeys({})).toEqual({});
    expect(stripFlagReservedKeys({ model: 'opus' })).toEqual({ model: 'opus' });
  });

  it('does not mutate the profile it was handed', () => {
    const profile = { effortLevel: 'low', model: 'opus' };
    stripFlagReservedKeys(profile);
    expect(profile.effortLevel).toBe('low');
  });
});
