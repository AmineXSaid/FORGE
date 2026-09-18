/**
 * The "Permission rules" dialog's pure parts (`kU0` and its pieces in
 * `index.js`), kept apart from the component so the specs can check them.
 *
 * Names in brackets are the bundle's.
 */
import type {
  PermissionBehavior,
  PermissionUpdateDestination,
  SDKControlPermissionRulesState,
  SDKPermissionRuleEntry,
} from '@anthropic-ai/claude-agent-sdk';
import type { EditableRuleDestination } from '../../../shared/messages';
import { escapeBidiControls, readRememberedDestination } from './permissionPrompt';

/** [`b45`, `fy`] Where a rule or directory came from, in words. */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  userSettings: 'user settings',
  projectSettings: 'shared project settings',
  localSettings: 'project local settings',
  flagSettings: 'settings given at startup',
  policySettings: 'enterprise managed settings',
  cliArg: 'startup options',
  command: "a command's configuration",
  session: 'current session',
  toolsNarrowing: 'a limited tool set',
  mcpServerPolicy: 'MCP server policy',
  hostCredential: 'cloud-session credential guard',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** [`rF0`, `KC`] The sources a rule can be added to or removed from here. */
export const EDITABLE_SOURCES: readonly EditableRuleDestination[] = ['userSettings', 'projectSettings', 'localSettings'];

export function isEditableSource(source: unknown): source is EditableRuleDestination {
  return (EDITABLE_SOURCES as readonly unknown[]).includes(source);
}

/** [`cK1`] Section order. */
export const BEHAVIORS: readonly PermissionBehavior[] = ['allow', 'ask', 'deny'];

/** [`bU0`] Section titles. */
export const BEHAVIOR_LABELS: Readonly<Record<PermissionBehavior, string>> = { allow: 'Allow', ask: 'Ask', deny: 'Deny' };

/** [`v45`] The "Save for" choices when adding a rule. */
export const ADD_RULE_DESTINATIONS: readonly EditableRuleDestination[] = ['localSettings', 'userSettings', 'projectSettings'];

/** The add form's first destination (`S45`): the remembered one if a file can hold it, else local. */
export function initialAddDestination(storage?: Pick<Storage, 'getItem'>): EditableRuleDestination {
  const remembered = readRememberedDestination(storage);
  return remembered !== null && isEditableSource(remembered) ? remembered : 'localSettings';
}

/** [`I45`] Rules grouped by behavior, in listing order. */
export function groupByBehavior(state: SDKControlPermissionRulesState): Record<PermissionBehavior, SDKPermissionRuleEntry[]> {
  const groups: Record<PermissionBehavior, SDKPermissionRuleEntry[]> = { allow: [], ask: [], deny: [] };
  for (const rule of state.rules) groups[rule.behavior]?.push(rule);
  return groups;
}

// ------------------------------------------------------------ escaping ---

/** [`E45`] Invisible, control and look-alike-space characters. */
const INVISIBLES =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u2028\u2029\p{Default_Ignorable_Code_Point}\u2800\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu;

/**
 * [`lK1`] Rule text as it may be shown: an existing `\u` escape has its
 * backslash spelled out first (so it cannot pass for one of these), then bidi
 * controls and every invisible character are written as `\uXXXX` / `\u{X}`.
 */
export function escapeText(text: string): string {
  return escapeBidiControls(text.replace(/\\(?=u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\}))/g, '\\u005C')).replace(
    INVISIBLES,
    (ch) => {
      const code = ch.codePointAt(0)!;
      const hex = code.toString(16).toUpperCase();
      return code > 65535 ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`;
    }
  );
}

/** [`NQ`, `dK1`] As `escapeText`, with leading and trailing spaces spelled out too. */
export function escapeRuleText(text: string): string {
  return escapeText(text).replace(/^ +| +$/g, (spaces) => '\\u0020'.repeat(spaces.length));
}

// ----------------------------------------------------------------- copy ---

/** [`k45`] Why an editable dialog cannot remove this rule; null when it can (or it is not in effect). */
export function readOnlyReason(entry: SDKPermissionRuleEntry): string | null {
  if (entry.notInEffect) return null;
  if (entry.editability === 'persistent') return null;
  switch (entry.source) {
    case 'cliArg':
      return 'Not saved in a settings file.';
    case 'session':
      return 'Approved for this session only; not saved in a settings file.';
    case 'policySettings':
      return 'Managed by enterprise settings.';
    case 'flagSettings':
      return 'From a settings file given at startup.';
    case 'command':
      return "Granted by a command; change it in the command.";
    default:
      return 'Read-only.';
  }
}

/** [`h45`] The source column. */
export function ruleSourceText(entry: SDKPermissionRuleEntry): string {
  const from = `From ${escapeRuleText(sourceLabel(entry.source))}`;
  if (entry.notInEffect) return `${from} (not in effect)`;
  if (entry.source === 'cliArg') return `${from} (this session only)`;
  return from;
}

/** Can the remove button show for this row (`q` in `y45`)? */
export function canRemove(entry: SDKPermissionRuleEntry, canEdit: boolean): boolean {
  return canEdit && !entry.notInEffect && entry.editability === 'persistent';
}

/** The notice after a remove the session has not re-read yet. */
export function removedPendingNotice(source: PermissionUpdateDestination | string): string {
  return `Removed from ${sourceLabel(source)}. If the rule is still shown, Claude Code is still re-reading its settings; reopen this dialog to check.`;
}

/** The notice after an add the session has not re-read yet. */
export function savedPendingNotice(destination: EditableRuleDestination, behavior: PermissionBehavior): string {
  return `Saved to ${sourceLabel(destination)}. Not listed yet: this session is still re-reading its settings (reopen this dialog to check)${
    behavior === 'allow'
      ? ', or it ignores this rule (in auto permission mode, allow rules for risky commands are not applied).'
      : '.'
  }`;
}
