/**
 * Guards for one CLI launch: register it with the hook server, write the
 * settings layer, and hand back what to add to the command line and the
 * environment. `off` adds nothing: no token, no file, no flag.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createGuardHooks, type GuardHookDeps } from '../guards/guardHooks';
import type { GuardLevel } from '../guards/levels';
import { cliGuardSettings, HOOK_TOKEN_ENV } from './cliGuardSettings';
import type { GuardHookServer } from './guardHookServer';

export interface CliGuardLaunch {
  /** The settings file to pass as `--settings <file>`; undefined when guards are off. */
  settingsFile?: string;
  /** Variables to add to the CLI's environment. */
  env: Record<string, string>;
  /** Stop answering this launch's hooks. */
  dispose(): void;
}

export interface CliGuardOptions extends Omit<GuardHookDeps, 'level' | 'stepCap'> {
  server: GuardHookServer;
  /** The level this launch runs at, fixed like the endpoint it was started with. */
  level: GuardLevel;
  /** A private directory for the settings file. */
  dir: string;
}

export function prepareCliGuards(options: CliGuardOptions): CliGuardLaunch {
  if (options.level === 'off') return { env: {}, dispose: () => {} };
  const { server, level, dir, ...deps } = options;
  // The CLI cannot take `maxTurns` outside --print, so the hooks count steps.
  const hooks = createGuardHooks({ ...deps, level: () => level, stepCap: true });
  const token = server.register((input) => hooks.handle(input));

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // One file per server: it holds only the URL, never the token.
  const settingsFile = path.join(dir, `guard-hooks-${new URL(server.url).port}.json`);
  fs.writeFileSync(settingsFile, JSON.stringify(cliGuardSettings(server.url), null, 2), { mode: 0o600 });

  return {
    settingsFile,
    env: { [HOOK_TOKEN_ENV]: token },
    dispose: () => server.revoke(token),
  };
}
