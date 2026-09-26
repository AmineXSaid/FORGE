/**
 * The composer's "/" completion ranks like the official command menu (`o65`):
 * exact name, then prefix, then the rest. Found by the end-to-end run
 * (2026-09-24): "/compact" + Enter ran "/autocompact", because the CLI lists
 * commands alphabetically and the completion kept that order.
 */
import { describe, expect, it } from 'vitest';
import { getSlashCommands, rankSlashCommands, slashRank } from '../src/webview/src/providers/slashCommandProvider';

const cmd = (name: string, description = '') => ({ id: `slash-command-${name}`, label: `/${name}`, description });
const CLI = [cmd('autocompact', 'Configure the auto-compact window'), cmd('clear', 'Start a new session'), cmd('compact', 'Free up context by summarizing'), cmd('config', 'Set a setting')];
const runtime = { appContext: { commandRegistry: { getCommandsBySection: () => ({ 'Slash Commands': CLI }) } } } as any;

describe('slash completion ranking', () => {
  it('puts the exact name first', () => {
    expect(getSlashCommands('compact', runtime).map((c) => c.label)).toEqual(['/compact', '/autocompact']);
    expect(getSlashCommands('/compact', runtime)[0].label).toBe('/compact');
  });

  it('then names that start with the query, then the rest, then descriptions', () => {
    // "/clear" matches through its id ("slash-command-…"), as the official's
    // fuzzy search over `cmd.id` does; it ranks after every name match.
    expect(rankSlashCommands(CLI, 'co').map((c) => c.label)).toEqual(['/compact', '/config', '/autocompact', '/clear']);
    expect(rankSlashCommands(CLI, 'session').map((c) => c.label)).toEqual(['/clear']);
    expect(slashRank(cmd('x'), 'nothing')).toBe(-1);
  });

  it('keeps the CLI order without a query', () => {
    expect(getSlashCommands('', runtime)).toEqual(CLI);
  });
});
