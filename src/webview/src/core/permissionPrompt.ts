/**
 * The official permission prompt's pure parts (`EU0` and `L45` in `index.js`),
 * kept apart from the component so the specs can check them.
 *
 * Names in brackets are the bundle's.
 */
import type { PermissionMode, PermissionUpdate, PermissionUpdateDestination } from '@anthropic-ai/claude-agent-sdk';

// ---------------------------------------------------------- the escape (S5) ---

const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** [`XF`] apply `fn` to every string in a JSON value. */
function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(out, key, { value: mapStrings(item, fn), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

/**
 * [`S5`] Bidirectional-control characters spelled out as `\uXXXX`. The official
 * webview applies it to a permission request's tool name, inputs and
 * suggestions before anything is shown or sent back, and the host compares the
 * answer against suggestions escaped the same way.
 */
export function escapeBidiControls<T>(value: T): T {
  return mapStrings(value, (text) =>
    text.replace(BIDI_CONTROLS, (ch) => `\\u${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
  ) as T;
}

// ----------------------------------------------------- the destination link ---

/** [`by`] The destinations option 2 cycles through, in order. */
export const PROMPT_DESTINATIONS = ['localSettings', 'userSettings', 'projectSettings', 'session'] as const;
export type PromptDestination = (typeof PROMPT_DESTINATIONS)[number];

/** [`uK1`] The next (or previous) destination; an unknown one restarts at the first. */
export function cycleDestination(current: string, step: number): PromptDestination {
  const index = (PROMPT_DESTINATIONS as readonly string[]).indexOf(current);
  if (index === -1) return PROMPT_DESTINATIONS[0];
  const n = PROMPT_DESTINATIONS.length;
  return PROMPT_DESTINATIONS[(index + step + n) % n];
}

/** [`Iy`] The link text. */
export const DESTINATION_LABELS: Readonly<Record<PermissionUpdateDestination, string>> = {
  localSettings: 'this project (just you)',
  userSettings: 'all projects',
  projectSettings: 'this project (shared)',
  session: 'this session',
  cliArg: 'startup options',
};

/** [`ao`] The link's `title`. */
export const DESTINATION_TITLES: Readonly<Record<PermissionUpdateDestination, string>> = {
  localSettings: 'Saves to .claude/settings.local.json (gitignored)',
  userSettings: 'Saves to ~/.claude/settings.json',
  projectSettings: 'Saves to .claude/settings.json (shared with team)',
  session: 'Only for this session (not saved)',
  cliArg: 'From options set when the session started',
};

/** [`_U0`] Where the last chosen destination is remembered. */
export const DESTINATION_STORAGE_KEY = 'claude-vscode-permission-destination';

/** [`ro`] The remembered destination, if it is one option 2 can use. */
export function readRememberedDestination(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): PromptDestination | null {
  if (storage) {
    const value = storage.getItem(DESTINATION_STORAGE_KEY);
    if (value && (PROMPT_DESTINATIONS as readonly string[]).includes(value)) return value as PromptDestination;
  }
  return null;
}

/** [`io`] Remember a chosen destination. */
export function rememberDestination(value: string, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  if (storage) storage.setItem(DESTINATION_STORAGE_KEY, value);
}

/** [`RU0`] Destination priority for the default: the broadest the CLI suggested. */
const DESTINATION_PRIORITY: readonly PermissionUpdateDestination[] = ['userSettings', 'projectSettings', 'localSettings', 'session', 'cliArg'];

/** [`O45`] The suggestions' own destination with the highest priority. */
export function suggestedDestination(suggestions: readonly PermissionUpdate[] | undefined): PermissionUpdateDestination | undefined {
  if (!suggestions?.length) return undefined;
  return suggestions
    .map((s) => s.destination)
    .sort((a, b) => DESTINATION_PRIORITY.indexOf(a) - DESTINATION_PRIORITY.indexOf(b))[0];
}

/** The default destination (`O` in `EU0`): remembered, else suggested, else "session". */
export function initialDestination(
  suggestions: readonly PermissionUpdate[] | undefined,
  storage?: Pick<Storage, 'getItem'>
): PermissionUpdateDestination {
  return readRememberedDestination(storage) ?? suggestedDestination(suggestions) ?? 'session';
}

// ------------------------------------------------------- what option 2 says ---

export interface Grant {
  /** What the button shows. */
  label: string;
  /** The whole rule or path, for the tooltip. */
  full: string;
}

/** [`M45`] `npm run:*` reads as `npm run`. */
function prefixOf(ruleContent: string): string | null {
  return ruleContent.match(/^(.+):\*$/)?.[1] ?? null;
}

/** [`w45`] The last path segment. */
function lastSegment(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

/** [`N45`] Rules shown as a phrase instead (`WF` is the "Artifact" tool). */
const RULE_PHRASES: Readonly<Record<string, string>> = {
  'Artifact(action:reply)': 'replies to comments on artifacts',
};

/** [`gK1`] What the suggestions grant: rules, directories, and a mode change. */
export function describeSuggestions(suggestions: readonly PermissionUpdate[]): {
  ruleDescriptions: Grant[];
  directoryDescriptions: Grant[];
  modeChange: { mode: PermissionMode; destination: PermissionUpdateDestination } | null;
} {
  const ruleDescriptions: Grant[] = [];
  const directoryDescriptions: Grant[] = [];
  let modeChange: { mode: PermissionMode; destination: PermissionUpdateDestination } | null = null;
  for (const suggestion of suggestions) {
    if (suggestion.type === 'addRules') {
      for (const rule of suggestion.rules) {
        const key = `${rule.toolName}(${rule.ruleContent ?? ''})`;
        const phrase = RULE_PHRASES[key];
        if (phrase !== undefined) ruleDescriptions.push({ label: phrase, full: key });
        else if (rule.ruleContent) {
          const prefix = prefixOf(rule.ruleContent);
          if (prefix) ruleDescriptions.push({ label: prefix, full: rule.ruleContent });
          else {
            const chars = [...rule.ruleContent];
            const label = chars.length > 20 ? chars.slice(0, 17).join('') + '…' : rule.ruleContent;
            ruleDescriptions.push({ label, full: rule.ruleContent });
          }
        } else ruleDescriptions.push({ label: rule.toolName, full: rule.toolName });
      }
    } else if (suggestion.type === 'addDirectories') {
      for (const directory of suggestion.directories) {
        directoryDescriptions.push({ label: `${lastSegment(directory)}/`, full: directory });
      }
    } else if (suggestion.type === 'setMode') {
      modeChange = { mode: suggestion.mode, destination: suggestion.destination };
    }
  }
  return { ruleDescriptions, directoryDescriptions, modeChange };
}

/** [`OU0`] Do the suggestions grant a rule or a directory (so the destination matters)? */
export function grantsRulesOrDirectories(suggestions: readonly PermissionUpdate[] | undefined): boolean {
  if (!suggestions || suggestions.length === 0) return false;
  const { ruleDescriptions, directoryDescriptions } = describeSuggestions(suggestions);
  return ruleDescriptions.length > 0 || directoryDescriptions.length > 0;
}

/** [`R45`, `mK1`] Line breaks shown as ⏎ so a grant stays on one line. */
export function oneLine(text: string): string {
  return text.replace(/\r\n|[\r\n\v\f\u0085\u2028\u2029]/g, '⏎');
}

/** [`LU0`] One bullet of the "N more" tooltip. */
export function bullet(text: string): string {
  return `• ${oneLine(text)}`;
}

/**
 * The parts of option 2's label ([`L45`]), for the component to render:
 * plain text, a grant (`ky`: its label, with the full text as a tooltip when
 * they differ), a count with a tooltip, or the destination link.
 */
export type LabelPart =
  | { kind: 'text'; text: string }
  | { kind: 'grant'; grant: Grant }
  | { kind: 'count'; text: string; title: string }
  | { kind: 'destination' };

export function optionTwoLabel(suggestions: readonly PermissionUpdate[] | undefined): LabelPart[] {
  const text = (value: string): LabelPart => ({ kind: 'text', text: value });
  const plain = [text("Yes, and don't ask again")];
  if (!suggestions || suggestions.length === 0) return plain;
  const { ruleDescriptions: rules, directoryDescriptions: dirs, modeChange } = describeSuggestions(suggestions);
  if (rules.length === 0 && dirs.length === 0 && modeChange) {
    if (modeChange.mode === 'acceptEdits') return [text('Yes, allow all edits this session')];
    if (modeChange.mode === 'default') return [text('Yes, return to normal mode')];
    return plain;
  }
  const link: LabelPart = { kind: 'destination' };
  if (rules.length > 0) {
    const [first, second] = rules;
    if (rules.length === 1) return [text('Yes, allow '), { kind: 'grant', grant: first }, text(' for '), link];
    if (rules.length === 2) {
      return [text('Yes, allow '), { kind: 'grant', grant: first }, text(' and'), text(' '), { kind: 'grant', grant: second }, text(' for '), link];
    }
    return [
      text('Yes, allow '),
      { kind: 'grant', grant: first },
      text(' and'),
      text(' '),
      { kind: 'count', text: `${rules.length - 1} more`, title: rules.slice(1).map((r) => bullet(r.full)).join('\n') },
      text(' '),
      text('for '),
      link,
    ];
  }
  if (dirs.length > 0) {
    if (dirs.length === 1) return [text('Yes, allow access to '), { kind: 'grant', grant: dirs[0] }, text(' for'), text(' '), link];
    return [
      text('Yes, allow access to'),
      text(' '),
      { kind: 'count', text: `${dirs.length} directories`, title: dirs.map((d) => bullet(d.full)).join('\n') },
      text(' '),
      text('for '),
      link,
    ];
  }
  return plain;
}

/** [`NU0`] The screen-reader hint on option 2 when its destination can change. */
export const DESTINATION_KEYS_HINT = 'Left or Right arrow changes where this is saved';

/**
 * What option 2 answers with (`i1` in `EU0`): the suggestions, each saved to the
 * chosen destination -- except a mode change, which keeps its own. The plan
 * prompt answers with [`MU0`] instead, whatever was suggested.
 */
export const RETURN_TO_DEFAULT_MODE: Readonly<PermissionUpdate> = Object.freeze({
  type: 'setMode',
  mode: 'default',
  destination: 'session',
});

export function optionTwoUpdates(
  suggestions: readonly PermissionUpdate[],
  destination: PermissionUpdateDestination,
  isPlanRequest = false
): PermissionUpdate[] {
  return (isPlanRequest ? [RETURN_TO_DEFAULT_MODE] : suggestions).map((update) => ({
    ...update,
    destination: update.type === 'setMode' ? update.destination : destination,
  })) as PermissionUpdate[];
}

/** The session-scoped mode change among option 2's updates, which the webview mirrors at once. */
export function sessionModeChange(updates: readonly PermissionUpdate[]): PermissionMode | undefined {
  const change = updates.find((u) => u.type === 'setMode' && u.destination === 'session');
  return change && change.type === 'setMode' ? change.mode : undefined;
}
