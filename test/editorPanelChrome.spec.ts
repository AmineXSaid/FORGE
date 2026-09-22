/**
 * Where a Forge page opens, and what VS Code draws on its tab.
 *
 * Reported from a real install: "Forge Welcome page opens like a coding file
 * window, not like Claude Code in VS Code." Two causes, both in the panel the
 * host creates:
 *
 *   - it opened on `ViewColumn.Active`, so the page landed in whatever editor
 *     group the user was reading code in, instead of in a group of its own;
 *   - it set no `iconPath`, so the tab carried VS Code's generic webview glyph
 *     rather than the Forge mark.
 *
 * The official host does neither. `on$` / `findUnusedColumn` pick the column
 * and `iconPath = {light, dark}` sets the mark, which is what this ports.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { chooseEditorColumn } from '../src/services/webViewService';

const { window } = vscode as any;

/** A tab group holding the given tab inputs. */
function group(viewColumn: number, ...tabs: unknown[]) {
  return { viewColumn, tabs: tabs.map((input) => ({ input })) };
}

/** A tab showing a Forge page, as VS Code reports it. */
function forgeTab() {
  // VS Code prefixes the extension's view type, which is why the production
  // code matches on `includes` rather than equality.
  return new (vscode as any).TabInputWebview('mainThreadWebview-forge.pageView');
}

/** A tab showing a source file. */
function fileTab() {
  return { uri: { fsPath: '/repo/src/index.ts' } };
}

beforeEach(() => {
  window.tabGroups.all = [];
  window.tabGroups.activeTabGroup = group(1);
});

describe('a page joins the group Forge already owns', () => {
  it('reuses the active group when every tab in it is a Forge page', () => {
    const owned = group(2, forgeTab(), forgeTab());
    window.tabGroups.activeTabGroup = owned;
    window.tabGroups.all = [group(1, fileTab()), owned];

    expect(chooseEditorColumn()).toEqual({ column: 2, startedInNewColumn: false });
  });

  it('finds a Forge-only group elsewhere when the active one is code', () => {
    const owned = group(3, forgeTab());
    window.tabGroups.activeTabGroup = group(1, fileTab());
    window.tabGroups.all = [group(1, fileTab()), owned];

    expect(chooseEditorColumn()).toEqual({ column: 3, startedInNewColumn: false });
  });

  it('does not treat a mixed group as Forge-owned', () => {
    // This is the whole defect: a group holding a file and a Forge page is the
    // user's code group, and dropping another page into it is what made Forge
    // look like a file.
    const mixed = group(1, forgeTab(), fileTab());
    window.tabGroups.activeTabGroup = mixed;
    window.tabGroups.all = [mixed];

    expect(chooseEditorColumn()).toEqual({ column: 2, startedInNewColumn: true });
  });

  it('does not treat an empty group as Forge-owned', () => {
    window.tabGroups.activeTabGroup = group(1);
    window.tabGroups.all = [group(1)];

    expect(chooseEditorColumn().startedInNewColumn).toBe(true);
  });
});

describe('otherwise it takes a column of its own', () => {
  it('opens in the first unused column and says it started a new one', () => {
    window.tabGroups.activeTabGroup = group(1, fileTab());
    window.tabGroups.all = [group(1, fileTab())];

    // `startedInNewColumn` is what makes the caller lock the group, so opening
    // a file from the chat does not land on top of the chat.
    expect(chooseEditorColumn()).toEqual({ column: 2, startedInNewColumn: true });
  });

  it('skips past every occupied column', () => {
    window.tabGroups.activeTabGroup = group(1, fileTab());
    window.tabGroups.all = [group(1, fileTab()), group(2, fileTab()), group(3, fileTab())];

    expect(chooseEditorColumn()).toEqual({ column: 4, startedInNewColumn: true });
  });

  it('falls back to Beside when all nine columns are taken, and does not lock', () => {
    window.tabGroups.activeTabGroup = group(1, fileTab());
    window.tabGroups.all = Array.from({ length: 9 }, (_, i) => group(i + 1, fileTab()));

    const chosen = chooseEditorColumn();
    expect(chosen.column).toBe(vscode.ViewColumn.Beside);
    // Locking a group that was not created here would lock one of the user's.
    expect(chosen.startedInNewColumn).toBe(false);
  });

  it('never returns Active, which is what the defect was', () => {
    window.tabGroups.activeTabGroup = group(1, fileTab());
    window.tabGroups.all = [group(1, fileTab())];
    expect(chooseEditorColumn().column).not.toBe(vscode.ViewColumn.Active);
  });
});
