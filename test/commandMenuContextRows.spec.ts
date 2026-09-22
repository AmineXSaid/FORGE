/**
 * Step 26: the "Resume conversation" row, and the Context section around it.
 *
 * This step has **no request and no handler** — the row is a registry entry that
 * flips the same state the header's history button toggles. So there is no B2
 * six-places work, and what is worth testing is the registry data: the ids,
 * labels, descriptions, `filterOnly` flags and the order, all against the
 * strings in the official bundle.
 *
 * The rows are built inside `ButtonArea.vue`'s `menuCommands` computed, which a
 * spec cannot import on its own. `CONTEXT_ROWS` below is the expected registry,
 * quoted from `index.js`; `contextRowsFromSource` reads the real array out of
 * the component and compares them, so a change to the component fails here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUTTON_AREA = join(__dirname, '..', 'src', 'webview', 'src', 'components', 'ButtonArea.vue');

/**
 * The Context rows, in the order the official registers them.
 *
 * Two effects contribute. The composer's runs first (a child's effect runs
 * before its parent's) and registers:
 *   {id:"attach-file",label:"Attach file…",description:"Upload a file to include in conversation"} -> "Context"
 *   {id:"mention-file",label:"Mention file from this project…",description:"Reference a project file with @mention"} -> "Context"
 *   {id:"rewind",label:"Rewind",description:"Restore code and conversation to an earlier point"} -> "Context"
 * then the chat page's:
 *   {id:"clear-conversation",label:"Clear conversation",description:"Start a new conversation"} -> "Context"
 *   {id:"new-conversation",label:"New conversation",description:"Open a new conversation in a new tab",filterOnly:!0} -> "Context"
 *   {id:"resume-conversation",label:"Resume conversation",description:"Continue a previous conversation",filterOnly:!0} -> "Context"
 */
const CONTEXT_ROWS = [
  { id: 'attach-file', label: 'Attach file…', description: 'Upload a file to include in conversation', filterOnly: false },
  { id: 'mention-file', label: 'Mention file from this project…', description: 'Reference a project file with @mention', filterOnly: false },
  { id: 'rewind', label: 'Rewind', description: 'Restore code and conversation to an earlier point', filterOnly: false },
  { id: 'clear-conversation', label: 'Clear conversation', description: 'Start a new conversation', filterOnly: false },
  { id: 'new-conversation', label: 'New conversation', description: 'Open a new conversation in a new tab', filterOnly: true },
  { id: 'resume-conversation', label: 'Resume conversation', description: 'Continue a previous conversation', filterOnly: true },
];

/** Every `{ id: '…', … section: 'Context' … }` literal in the component, in order. */
function contextRowsFromSource(): Array<{ id: string; label: string; description: string; filterOnly: boolean }> {
  const source = readFileSync(BUTTON_AREA, 'utf8').replace(/\r\n/g, '\n');
  const rows: Array<{ id: string; label: string; description: string; filterOnly: boolean }> = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{ id:') || !trimmed.includes("section: 'Context'")) continue;
    const id = /\bid: '([^']*)'/.exec(trimmed)?.[1] ?? '';
    const label = /\blabel: '([^']*)'/.exec(trimmed)?.[1] ?? '';
    const description = /\bdescription: '([^']*)'/.exec(trimmed)?.[1] ?? '';
    rows.push({ id, label, description, filterOnly: /\bfilterOnly: true/.test(trimmed) });
  }
  return rows;
}

describe('the "/" menu Context section', () => {
  const rows = contextRowsFromSource();

  it('has every official row, with the official copy and order', () => {
    expect(rows).toEqual(CONTEXT_ROWS);
  });

  it('registers "Resume conversation" as filterOnly, so it is hidden until you filter', () => {
    const resume = rows.find((r) => r.id === 'resume-conversation');
    expect(resume).toBeDefined();
    expect(resume!.filterOnly).toBe(true);
    expect(resume!.label).toBe('Resume conversation');
    expect(resume!.description).toBe('Continue a previous conversation');
  });

  it('registers "Rewind" as a visible row, not filterOnly', () => {
    const rewind = rows.find((r) => r.id === 'rewind');
    expect(rewind).toBeDefined();
    expect(rewind!.filterOnly).toBe(false);
    expect(rewind!.description).toBe('Restore code and conversation to an earlier point');
  });

  it('leaves the neighbours` copy exactly as the official has it', () => {
    // Checked because the step-26 brief asked whether Forge's existing
    // `clear-conversation` / `new-conversation` copy had drifted. It has not —
    // both match the bundle verbatim, so there was nothing to report or change.
    const clear = rows.find((r) => r.id === 'clear-conversation')!;
    const created = rows.find((r) => r.id === 'new-conversation')!;
    expect([clear.label, clear.description, clear.filterOnly]).toEqual([
      'Clear conversation',
      'Start a new conversation',
      false,
    ]);
    expect([created.label, created.description, created.filterOnly]).toEqual([
      'New conversation',
      'Open a new conversation in a new tab',
      true,
    ]);
  });

  it('wires both new rows to an action rather than leaving them inert', () => {
    const source = readFileSync(BUTTON_AREA, 'utf8').replace(/\r\n/g, '\n');
    expect(source).toContain("case 'rewind': return emit('openRewind')");
    expect(source).toContain("case 'resume-conversation': return emit('openSessions')");
  });
});
