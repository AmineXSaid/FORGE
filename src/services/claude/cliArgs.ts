/**
 * CLI flag passthrough for the Forge backend.
 *
 * Forge runs the real `claude` binary through @anthropic-ai/claude-agent-sdk, so
 * the CLI is the backend. The SDK exposes `extraArgs` as its escape hatch: any
 * key/value here is appended to the spawned command line. This module turns the
 * `forge.cliArgs` setting into that map.
 *
 * It is deliberately gated, but only where a flag can break something. CLI flags
 * drift between versions and a bad flag can either kill the process or, worse,
 * silently corrupt the stream protocol the SDK talks over. So flags are sorted into:
 *
 *   PROTOCOL  the SDK's wire contract depends on them. Hard-rejected -- passing
 *             one would break the transport, not just the request.
 *   SDK       the SDK derives these from one of its typed Options (the complete
 *             list for the installed SDK is in SDK_DERIVED_FLAGS). Always
 *             applied. Warned about only when that Option is set on this launch,
 *             because then the flag is on the command line twice and the CLI's
 *             own precedence decides which wins.
 *   FORGE     flags in Forge's own base map (debug, settings, ...). Allowed;
 *             a configured value replaces Forge's, and that is warned about.
 *   FREE      everything else. Passed straight through.
 */

/**
 * Flags whose values the SDK's stream transport depends on. Never passed through.
 * `permission-prompt-tool` is the SDK's `canUseTool` channel (`--permission-prompt-tool
 * stdio`, Agent SDK 0.3.274 sdk.mjs): a second value would take permission prompts
 * away from Forge's dialog.
 */
const PROTOCOL_FLAGS = new Set([
  'print',
  'p',
  'output-format',
  'input-format',
  'include-partial-messages',
  'permission-prompt-tool',
]);

type SdkOptions = Readonly<Record<string, unknown>>;

interface SdkDerivedFlag {
  /** The `Options` field(s) the SDK builds this flag from (sdk.d.ts `Options`). */
  option: string;
  /** Whether the SDK emits the flag for these options (mirrors its argument builder). */
  emitted: (options: SdkOptions) => boolean;
}

const isSet = (value: unknown) =>
  value !== undefined && value !== null && value !== false && !(Array.isArray(value) && value.length === 0);
const when = (...keys: string[]) => (options: SdkOptions) => keys.some((key) => isSet(options[key]));

/**
 * Every flag Agent SDK 0.3.274 derives from its typed Options, from the argument
 * builder in sdk.mjs (`ProcessTransport.initialize`), keyed to the public
 * `Options` field in sdk.d.ts. `test/cliArgs.spec.ts` re-reads the installed
 * sdk.mjs, so an SDK upgrade that adds a flag fails the spec until it is listed here.
 */
export const SDK_DERIVED_FLAGS: ReadonlyMap<string, SdkDerivedFlag> = new Map<string, SdkDerivedFlag>([
  ['verbose', { option: '(always, with stream-json)', emitted: () => true }],
  ['thinking', { option: 'thinking / maxThinkingTokens', emitted: when('thinking', 'maxThinkingTokens') }],
  ['max-thinking-tokens', { option: 'thinking / maxThinkingTokens', emitted: when('thinking', 'maxThinkingTokens') }],
  ['thinking-display', { option: 'thinking.display', emitted: (o) => isSet((o.thinking as { display?: unknown } | undefined)?.display) }],
  ['effort', { option: 'effort', emitted: when('effort') }],
  ['max-turns', { option: 'maxTurns', emitted: when('maxTurns') }],
  ['max-budget-usd', { option: 'maxBudgetUsd', emitted: when('maxBudgetUsd') }],
  ['task-budget', { option: 'taskBudget', emitted: when('taskBudget') }],
  ['model', { option: 'model', emitted: when('model') }],
  ['agent', { option: 'agent', emitted: when('agent') }],
  ['betas', { option: 'betas', emitted: when('betas') }],
  ['json-schema', { option: 'outputFormat', emitted: when('outputFormat') }],
  ['debug', { option: 'debug', emitted: when('debug') }],
  ['debug-file', { option: 'debugFile', emitted: when('debugFile') }],
  ['permission-prompts', { option: 'permissionPrompts', emitted: when('permissionPrompts') }],
  ['continue', { option: 'continue', emitted: when('continue') }],
  ['resume', { option: 'resume', emitted: when('resume') }],
  ['channels', { option: '(internal channels; not in the public Options)', emitted: when('channels') }],
  ['allowedTools', { option: 'allowedTools / skills', emitted: when('allowedTools', 'skills') }],
  ['disallowedTools', { option: 'disallowedTools', emitted: when('disallowedTools') }],
  ['tools', { option: 'tools', emitted: (o) => o.tools !== undefined }],
  ['mcp-config', { option: 'mcpServers', emitted: (o) => isSet(o.mcpServers) && Object.keys(o.mcpServers as object).length > 0 }],
  ['setting-sources', { option: 'settingSources', emitted: (o) => o.settingSources !== undefined }],
  ['strict-mcp-config', { option: 'strictMcpConfig', emitted: when('strictMcpConfig') }],
  ['permission-mode', { option: 'permissionMode', emitted: when('permissionMode') }],
  ['allow-dangerously-skip-permissions', { option: 'allowDangerouslySkipPermissions', emitted: when('allowDangerouslySkipPermissions') }],
  ['fallback-model', { option: 'fallbackModel', emitted: when('fallbackModel') }],
  ['include-hook-events', { option: 'includeHookEvents', emitted: when('includeHookEvents') }],
  ['session-mirror', { option: 'sessionStore', emitted: when('sessionStore') }],
  ['add-dir', { option: 'additionalDirectories', emitted: when('additionalDirectories') }],
  ['await-initialize', { option: "pluginDelivery: 'initialize'", emitted: (o) => o.pluginDelivery === 'initialize' }],
  ['plugin-dir', { option: 'plugins', emitted: when('plugins') }],
  ['plugin-dir-no-mcp', { option: 'plugins[].skipMcpDiscovery', emitted: when('plugins') }],
  ['fork-session', { option: 'forkSession', emitted: when('forkSession') }],
  ['resume-session-at', { option: 'resumeSessionAt', emitted: when('resumeSessionAt') }],
  ['resume-drops-turn', { option: 'resumeDropsTurn', emitted: (o) => o.resumeDropsTurn !== undefined }],
  ['session-id', { option: 'sessionId', emitted: when('sessionId') }],
  ['no-session-persistence', { option: 'persistSession: false', emitted: (o) => o.persistSession === false }],
  ['managed-settings', { option: 'managedSettings', emitted: when('managedSettings') }],
  ['settings', { option: 'settings', emitted: when('settings') }],
]);

/**
 * CLI flags that overlap what the SDK sends in its `initialize` control request
 * rather than on the command line (sdk.mjs: `systemPrompt`, `appendSystemPrompt`).
 */
export const SDK_INITIALIZE_FLAGS: ReadonlyMap<string, SdkDerivedFlag> = new Map<string, SdkDerivedFlag>([
  ['system-prompt', { option: 'systemPrompt (sent in initialize)', emitted: when('systemPrompt') }],
  ['append-system-prompt', { option: 'systemPrompt (sent in initialize)', emitted: when('systemPrompt') }],
]);

export interface CliArgDecision {
  flag: string;
  value: string | null;
  reason: string;
}

export interface CliArgsBuild {
  /** The merged map to hand to the SDK. */
  extraArgs: Record<string, string | null>;
  /** Flags refused outright, with why. */
  rejected: CliArgDecision[];
  /** Flags accepted but duplicating an SDK option set on this launch, or replacing a Forge default. */
  warned: CliArgDecision[];
  /** Flags accepted cleanly. */
  accepted: CliArgDecision[];
}

/** Accept `--add-dir`, `-p`, or a bare `add-dir`; normalise to the bare name. */
function normalizeFlag(raw: string): string {
  return raw.trim().replace(/^-+/, '');
}

/**
 * Coerce a configured value into what `extraArgs` accepts: a string, or null for
 * a valueless boolean flag. `true` means "present with no value"; `false` means
 * "leave it off entirely" so a flag can be disabled without deleting the key.
 */
function normalizeValue(raw: unknown): string | null | undefined {
  if (raw === null || raw === true || raw === '') return null;
  if (raw === false || raw === undefined) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'bigint') return String(raw);
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(',');
  return undefined;
}

/**
 * The flags Forge always puts on the command line, i.e. the `base` every launch
 * passes to `buildExtraArgs`. The official's own is
 * `{debug:null,"debug-to-stderr":null,"enable-auth-status":null,"no-chrome":null,
 * "replay-user-messages":null}`; Forge drops the two account/browser ones (out
 * of scope and step 28) and adds `--settings` for profile hot-reload.
 *
 * `replay-user-messages` makes the CLI echo every user message it processes as
 * `SDKUserMessageReplay` (sdk.d.ts:5923) with the uuid it stored, which is what
 * `rewind_code` and `fork_conversation` key off (step 24).
 *
 * Exported so a spec can assert what actually ships, rather than a copy of it.
 *
 * @param settingsPath the `--settings` file (`~/.claude/forge.json`)
 */
export function forgeBaseCliArgs(settingsPath: string): Record<string, string | null> {
  return {
    'debug': null,
    'debug-to-stderr': null,
    'replay-user-messages': null,
    'settings': settingsPath,
  };
}

/**
 * Merge user-configured CLI flags over Forge's built-in ones.
 *
 * @param base       flags Forge always sets (debug, settings, ...)
 * @param configured raw value of the `forge.cliArgs` setting
 * @param sdkOptions the typed SDK Options of this launch, so a flag is only
 *                   reported as a duplicate when the SDK really emits it too
 */
export function buildExtraArgs(
  base: Record<string, string | null>,
  configured: unknown,
  sdkOptions: SdkOptions = {},
): CliArgsBuild {
  const out: Record<string, string | null> = { ...base };
  const rejected: CliArgDecision[] = [];
  const warned: CliArgDecision[] = [];
  const accepted: CliArgDecision[] = [];

  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return { extraArgs: out, rejected, warned, accepted };
  }

  for (const [rawFlag, rawValue] of Object.entries(configured as Record<string, unknown>)) {
    const flag = normalizeFlag(rawFlag);
    if (!flag) continue;

    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(flag)) {
      rejected.push({ flag, value: null, reason: 'not a valid flag name' });
      continue;
    }

    if (PROTOCOL_FLAGS.has(flag)) {
      rejected.push({
        flag,
        value: null,
        reason: 'reserved: the SDK stream protocol depends on this flag',
      });
      continue;
    }

    const value = normalizeValue(rawValue);
    if (value === undefined) {
      // Explicitly disabled (false), or an unusable type. Drop any built-in too,
      // so `{"debug": false}` is how you turn Forge's own debug flag off.
      if (rawValue === false) {
        delete out[flag];
        accepted.push({ flag, value: null, reason: 'disabled' });
      } else {
        rejected.push({ flag, value: null, reason: `unsupported value type: ${typeof rawValue}` });
      }
      continue;
    }

    const forgeDefault = Object.prototype.hasOwnProperty.call(base, flag);
    const previous = base[flag];
    out[flag] = value;

    const derived = SDK_DERIVED_FLAGS.get(flag) ?? SDK_INITIALIZE_FLAGS.get(flag);
    if (derived?.emitted(sdkOptions)) {
      warned.push({ flag, value, reason: `the SDK also emits it from ${derived.option} on this launch; the CLI decides which wins` });
    } else if (forgeDefault) {
      warned.push({ flag, value, reason: `replaces Forge's own --${flag}${previous === null ? '' : ` ${previous}`}` });
    } else if (derived) {
      accepted.push({ flag, value, reason: `passthrough (SDK option ${derived.option} is not set)` });
    } else {
      accepted.push({ flag, value, reason: 'passthrough' });
    }
  }

  return { extraArgs: out, rejected, warned, accepted };
}

/** One-line summary for the output channel. */
export function describeBuild(build: CliArgsBuild): string[] {
  const lines: string[] = [];
  const render = (d: CliArgDecision) => `--${d.flag}${d.value === null ? '' : ` ${d.value}`}`;
  for (const d of build.accepted) lines.push(`  + ${render(d)}  (${d.reason})`);
  for (const d of build.warned) lines.push(`  ! ${render(d)}  -- ${d.reason}`);
  for (const d of build.rejected) lines.push(`  x --${d.flag}  REJECTED: ${d.reason}`);
  return lines;
}

/**
 * Whether the configured flags let a session run in `bypassPermissions` -- the
 * Forge counterpart of the official `getAllowDangerouslySkipPermissions()`
 * (a `claudeCode.*` setting Forge does not have). Forge only launches with
 * bypass allowed when `forge.cliArgs` enables `--allow-dangerously-skip-permissions`
 * (or `--dangerously-skip-permissions`, which implies it), so that is what is
 * read -- through the same gate the launch uses, so `false` turns it off.
 */
export function allowsDangerouslySkipPermissions(configured: unknown): boolean {
  const { extraArgs } = buildExtraArgs({}, configured);
  return (
    Object.prototype.hasOwnProperty.call(extraArgs, 'allow-dangerously-skip-permissions') ||
    Object.prototype.hasOwnProperty.call(extraArgs, 'dangerously-skip-permissions')
  );
}
