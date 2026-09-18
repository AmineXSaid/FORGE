/**
 * Permission rules: the official host's `add_permission_rules`,
 * `list_permission_rules` and `remove_permission_rule`, and the filter it puts
 * on the `updatedPermissions` a permission prompt sends back.
 *
 * Ported from `extension.js` (2.1.270), names in brackets:
 *
 * - the request checks: `behavior` is `allow | deny | ask` [`nu$`], a rule
 *   destination is one of the three settings files [`Wo$`, `Zb`], `rules` is
 *   1-100 strings of at most 10 000 characters. A bad shape is answered
 *   in-band with `error: "invalid request"`, never thrown;
 * - the write [`permissionRulesConfigManager.edit`, class `pe`]: the host does
 *   not touch the settings file itself. It runs the CLI's hidden
 *   `claude edit-permission-rules --json` (CLI 2.1.274: "Apply one
 *   permission-rule edit read as JSON from stdin (used by the VS Code
 *   extension)") in the session's cwd with the edit on stdin, and reads
 *   `{warnings, stored}` from the last line of stdout [`$j0`]. The CLI checks
 *   the rule, writes the destination file and says why when it refuses;
 * - the re-read [`listPermissionRulesUntil`]: `query.listPermissionRules()`
 *   up to 14 more times, 300 ms apart, until the running session shows the
 *   change;
 * - the prompt filter [`QI0`, `jf$`, `ew0`, `Rf$`]: an `updatedPermissions`
 *   entry is kept only if the prompt offered it (possibly re-targeted to
 *   another destination) or it is the plan prompt's "back to default".
 *
 * `Query.listPermissionRules()` is in the SDK runtime (`sdk.mjs`:
 * `async listPermissionRules(){return(await this.request({subtype:"list_permission_rules"})).response}`)
 * but not in the published `Query` typings; its payload is typed
 * (`SDKControlListPermissionRulesResponse`, `sdk.d.ts` L4365). It is reached
 * through a narrow type, as `claudeSettings.ts` does for `getSettings()`.
 *
 * Kept free of `vscode` so the specs can import it.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type {
    PermissionBehavior,
    PermissionResult,
    PermissionUpdate,
    PermissionUpdateDestination,
    SDKControlPermissionRulesState,
} from '@anthropic-ai/claude-agent-sdk';

// ----------------------------------------------------------------- checks ---

/** The official `nu$`. */
export function isPermissionBehavior(value: unknown): value is PermissionBehavior {
    return value === 'allow' || value === 'deny' || value === 'ask';
}

/** The official `Wo$`: the settings files a rule can be added to or removed from. */
export const EDITABLE_RULE_DESTINATIONS = ['userSettings', 'projectSettings', 'localSettings'] as const;
export type EditableRuleDestination = (typeof EDITABLE_RULE_DESTINATIONS)[number];

/** The official `Zb`. */
export function isEditableRuleDestination(value: unknown): value is EditableRuleDestination {
    return (EDITABLE_RULE_DESTINATIONS as readonly unknown[]).includes(value);
}

export const MAX_RULES_PER_ADD = 100;
export const MAX_RULE_LENGTH = 1e4;

/** `addPermissionRules`' shape check, literally. */
export function isValidAddRequest(rules: unknown, behavior: unknown, destination: unknown): boolean {
    return !(
        !Array.isArray(rules) ||
        rules.length < 1 ||
        rules.length > MAX_RULES_PER_ADD ||
        rules.some((rule) => typeof rule !== 'string' || rule.length > MAX_RULE_LENGTH) ||
        !isPermissionBehavior(behavior) ||
        !isEditableRuleDestination(destination)
    );
}

/** `removePermissionRule`'s shape check, literally. */
export function isValidRemoveRequest(rule: unknown, behavior: unknown, source: unknown): boolean {
    return !(
        typeof rule !== 'string' ||
        rule.length === 0 ||
        rule.length > MAX_RULE_LENGTH ||
        !isPermissionBehavior(behavior) ||
        !isEditableRuleDestination(source)
    );
}

/** The official `BH`: JSON with object keys sorted, so equal objects compare equal. */
export function stableStringify(value: unknown): string {
    return JSON.stringify(value, (_key, v) =>
        typeof v === 'object' && v !== null && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
            : v
    );
}

// ------------------------------------------------------------------ write ---

export type PermissionRuleEdit =
    | { op: 'add'; rules: string[]; behavior: PermissionBehavior; destination: EditableRuleDestination }
    | { op: 'remove'; rule: string; behavior: PermissionBehavior; source: EditableRuleDestination };

export interface PermissionRuleEditResult {
    warnings: string[];
    stored: string[];
}

/** The official `$j0`: the last stdout line is `{ok, warnings, stored}`; anything else reads as none. */
export function parseEditOutput(stdout: string): PermissionRuleEditResult {
    const last = stdout.trim().split('\n').at(-1) ?? '';
    const strings = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    try {
        const parsed = JSON.parse(last);
        if (typeof parsed === 'object' && parsed !== null) {
            const { warnings, stored } = parsed as { warnings?: unknown; stored?: unknown };
            return { warnings: strings(warnings), stored: strings(stored) };
        }
    } catch {
        // Not JSON: fall through.
    }
    return { warnings: [], stored: [] };
}

/** What the official `getClaudeBinary()` returns, as far as running a subcommand needs. */
export interface ClaudeBinary {
    pathToClaudeCodeExecutable: string;
    executableArgs: string[];
    nodePath?: string;
    env: Record<string, string>;
}

/** The official `I8`: the command line for a CLI subcommand. */
export function claudeCommand(binary: ClaudeBinary, args: string[] = []): { command: string; args: string[] } {
    const { pathToClaudeCodeExecutable: executable, executableArgs, nodePath } = binary;
    if (executableArgs.length > 0) return { command: executable, args: [...executableArgs, ...args] };
    if (nodePath) return { command: nodePath, args: [executable, ...args] };
    return { command: executable, args };
}

/** The slice of `child_process.execFile` the edit uses, so a spec can stand in for it. */
export type ExecFileLike = (
    command: string,
    args: string[],
    options: {
        cwd: string;
        env: Record<string, string | undefined>;
        encoding: 'utf-8';
        timeout: number;
        windowsHide: boolean;
        maxBuffer: number;
    },
    callback: (error: (Error & { code?: unknown; killed?: boolean; syscall?: string }) | null, stdout: unknown, stderr: unknown) => void
) => { stdin?: { on(event: 'error', listener: () => void): unknown; end(data: string): void } | null };

/**
 * The official `pe.edit`: run `claude edit-permission-rules --json` in `cwd`
 * with the edit on stdin. A non-zero exit throws the CLI's own message
 * (stderr without colour codes or a leading "Error:").
 */
export async function runPermissionRuleEdit(
    binary: ClaudeBinary,
    edit: PermissionRuleEdit,
    cwd: string,
    execFile: ExecFileLike = nodeExecFile as unknown as ExecFileLike,
    dirExists: (dir: string) => boolean = existsSync
): Promise<PermissionRuleEditResult> {
    if (!binary.pathToClaudeCodeExecutable) throw new Error('Claude Code is not installed with this extension.');
    const { command, args } = claudeCommand(binary, ['edit-permission-rules', '--json']);
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string; spawnError?: Error & { code?: unknown } }>(
        (resolve) => {
            const child = execFile(
                command,
                args,
                {
                    cwd,
                    env: { ...process.env, ...binary.env },
                    encoding: 'utf-8',
                    timeout: 30000,
                    windowsHide: true,
                    maxBuffer: 1048576,
                },
                (error, stdout, stderr) => {
                    const failure = error;
                    resolve({
                        code:
                            failure && !failure.killed && typeof failure.code === 'number'
                                ? failure.code
                                : failure
                                  ? null
                                  : 0,
                        stdout: typeof stdout === 'string' ? stdout : '',
                        stderr: typeof stderr === 'string' ? stderr : '',
                        ...(failure?.syscall && { spawnError: failure }),
                    });
                }
            );
            child.stdin?.on('error', () => {});
            child.stdin?.end(JSON.stringify(edit));
        }
    );
    if (result.spawnError) {
        if (result.spawnError.code === 'ENOENT' && !dirExists(cwd)) {
            throw new Error(
                `Working directory not found: ${cwd}. If this session's folder was deleted, re-open the project and try again.`
            );
        }
        throw result.spawnError;
    }
    if (result.code !== 0) {
        const message = result.stderr
            .replace(/\u001B\[[0-9;]*m/g, '')
            .trim()
            .replace(/^Error:\s*/, '');
        throw new Error(
            message ||
                `Claude Code could not save the permission rule (${
                    result.code === null ? 'stopped or timed out' : `exit code ${result.code}`
                }).`
        );
    }
    return parseEditOutput(result.stdout);
}

// ------------------------------------------------------------------- read ---

/** A `Query` as far as `list_permission_rules` goes. */
interface QueryWithPermissionRules {
    listPermissionRules?: () => Promise<unknown>;
}

/** `query.listPermissionRules().state`; throws when the CLI cannot answer, as the SDK does. */
export async function readPermissionRules(query: unknown): Promise<SDKControlPermissionRulesState> {
    const list = (query as QueryWithPermissionRules | null)?.listPermissionRules;
    if (typeof list !== 'function') {
        throw new Error('This Claude Code session cannot list permission rules.');
    }
    const response = (await list.call(query)) as { state?: SDKControlPermissionRulesState } | undefined;
    if (!response || typeof response.state !== 'object' || response.state === null) {
        throw new Error('Claude Code sent no permission rules.');
    }
    return response.state;
}

export const RULES_REREAD_ATTEMPTS = 14;
export const RULES_REREAD_INTERVAL_MS = 300;

/**
 * The official `listPermissionRulesUntil`: re-read until `done` says the
 * session shows the change, up to 14 more reads 300 ms apart. A failed read
 * falls back to the state from before the write, reported as unchanged.
 */
export async function listPermissionRulesUntil(
    query: unknown,
    before: SDKControlPermissionRulesState,
    done: (state: SDKControlPermissionRulesState) => boolean,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onError: (error: unknown) => void = () => {}
): Promise<{ state: SDKControlPermissionRulesState; changed: boolean }> {
    try {
        let state = await readPermissionRules(query);
        for (let attempt = 0; attempt < RULES_REREAD_ATTEMPTS && !done(state); attempt++) {
            await sleep(RULES_REREAD_INTERVAL_MS);
            state = await readPermissionRules(query);
        }
        return { state, changed: done(state) };
    } catch (error) {
        onError(error);
        return { state: before, changed: false };
    }
}

/**
 * `addPermissionRules`' "is it there yet": every rule the CLI says it stored
 * is listed under that behavior and destination; if it stored none, any change
 * to the rules at all.
 */
export function addShowsUp(
    behavior: PermissionBehavior,
    destination: EditableRuleDestination,
    stored: string[],
    before: SDKControlPermissionRulesState
): (state: SDKControlPermissionRulesState) => boolean {
    return (state) =>
        stored.length > 0
            ? stored.every((rule) =>
                  state.rules.some((entry) => entry.behavior === behavior && entry.source === destination && entry.rule === rule)
              )
            : stableStringify(state.rules) !== stableStringify(before.rules);
}

/** `removePermissionRule`'s: the exact rule is no longer listed under that behavior and source. */
export function removeShowsUp(
    rule: string,
    behavior: PermissionBehavior,
    source: EditableRuleDestination
): (state: SDKControlPermissionRulesState) => boolean {
    return (state) => !state.rules.some((entry) => entry.behavior === behavior && entry.source === source && entry.rule === rule);
}

// ----------------------------------------------------- the prompt's answer ---

const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** The official `ue`: apply `fn` to every string in a JSON value (keys too, when asked). */
function mapStrings(value: unknown, fn: (text: string) => string, keys = false): unknown {
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn, keys));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            Object.defineProperty(out, keys ? fn(key) : key, {
                value: mapStrings(item, fn, keys),
                enumerable: true,
                writable: true,
                configurable: true,
            });
        }
        return out;
    }
    return value;
}

/**
 * The official `Rf$` (and the webview's `S5`): bidirectional-control characters
 * spelled out as `\uXXXX`, so a rule cannot read differently from what it is.
 */
export function escapeBidiControls<T>(value: T): T {
    return mapStrings(value, (text) =>
        text.replace(BIDI_CONTROLS, (ch) => `\\u${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
    ) as T;
}

/** The official `jf$`: the plan prompt's option 2 always sends this, offered or not. */
export const RETURN_TO_DEFAULT_MODE: Readonly<PermissionUpdate> = Object.freeze({
    type: 'setMode',
    mode: 'default',
    destination: 'session',
});

/** The official `ew0`: where the prompt may re-target an offered update. */
const REDIRECTABLE_DESTINATIONS: Readonly<Record<PermissionUpdateDestination, true>> = {
    userSettings: true,
    projectSettings: true,
    localSettings: true,
    session: true,
    cliArg: true,
};

/**
 * The official `QI0`: was this update offered by the prompt? A `setMode` must
 * match an offered one exactly; any other update may carry a different (known)
 * destination than the one offered, and must match otherwise.
 */
export function isOfferedUpdate(update: unknown, offered: readonly PermissionUpdate[]): boolean {
    if (typeof update !== 'object' || update === null) return false;
    const key = stableStringify(update);
    if (key === stableStringify(RETURN_TO_DEFAULT_MODE)) return true;
    const destination = 'destination' in update ? (update as { destination?: unknown }).destination : undefined;
    return offered.some((suggestion) =>
        suggestion.type === 'setMode'
            ? key === stableStringify(suggestion)
            : typeof destination === 'string' &&
              Object.hasOwn(REDIRECTABLE_DESTINATIONS, destination) &&
              key === stableStringify({ ...suggestion, destination })
    );
}

/**
 * The tail of the official `requestToolPermission`: an allow answer keeps only
 * the updates the prompt offered, and never a switch to `bypassPermissions`
 * unless `allowDangerouslySkipPermissions` is on. Returns the result to hand to
 * the SDK and how many updates were dropped (`-1` for a malformed list).
 */
export function filterAnsweredPermissions(
    result: PermissionResult,
    suggestions: readonly PermissionUpdate[],
    allowDangerouslySkipPermissions: boolean
): { result: PermissionResult; dropped: number } {
    if (result.behavior !== 'allow' || result.updatedPermissions === undefined) return { result, dropped: 0 };
    const answered: unknown[] = Array.isArray(result.updatedPermissions) ? result.updatedPermissions : [];
    const offered = escapeBidiControls(suggestions as PermissionUpdate[]);
    const kept = answered.filter(
        (update) =>
            isOfferedUpdate(update, offered) &&
            (allowDangerouslySkipPermissions ||
                !((update as PermissionUpdate).type === 'setMode' &&
                    (update as Extract<PermissionUpdate, { type: 'setMode' }>).mode === 'bypassPermissions'))
    ) as PermissionUpdate[];
    if (!Array.isArray(result.updatedPermissions)) {
        return { result: { ...result, updatedPermissions: kept }, dropped: -1 };
    }
    if (kept.length === answered.length) return { result, dropped: 0 };
    return { result: { ...result, updatedPermissions: kept }, dropped: answered.length - kept.length };
}
