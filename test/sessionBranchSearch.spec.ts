/**
 * Step 23: git-branch search.
 *
 * The official filter matches the row's title **or** its `gitBranch`,
 * case-insensitively:
 *
 *   let x8=V1.toLowerCase(),
 *   KZ=V1?B0.filter((X1)=>kR(X1).toLowerCase().includes(x8)
 *        ||(X1.gitBranch.value?.toLowerCase().includes(x8)??!1)):B0
 *
 * `gitBranch` reaches the row through `list_sessions`: step 20 put the lister on
 * the SDK's `listSessions()`, so `SDKSessionInfo.gitBranch` is mapped straight
 * onto the summary. These specs cover the filter and that mapping.
 */
import { describe, expect, it } from 'vitest';
import { matchesSessionQuery } from '../src/webview/src/core/sessionStates';
import { toSessionListRow } from '../src/services/claude/sessionList';
import { Session } from '../src/webview/src/core/Session';
import { signal } from 'alien-signals';

const sessionContext = {
  currentSelection: signal(undefined),
  commandRegistry: { registerAction: () => {} },
  fileOpener: {},
  renameTab: () => {},
} as any;

describe('the official filter (KZ)', () => {
  it('an empty query keeps every row', () => {
    expect(matchesSessionQuery('anything', 'any/branch', '')).toBe(true);
    expect(matchesSessionQuery('anything', undefined, '')).toBe(true);
  });

  it('matches a substring of the title', () => {
    expect(matchesSessionQuery('Split the settings loader', undefined, 'settings')).toBe(true);
    expect(matchesSessionQuery('Split the settings loader', undefined, 'loader')).toBe(true);
    expect(matchesSessionQuery('Split the settings loader', undefined, 'nope')).toBe(false);
  });

  it('matches a substring of the branch', () => {
    expect(matchesSessionQuery('Untitled', 'feature/settings-loader', 'settings')).toBe(true);
    expect(matchesSessionQuery('Untitled', 'feature/settings-loader', 'feature/')).toBe(true);
    expect(matchesSessionQuery('Untitled', 'docs/tidy', 'settings')).toBe(false);
  });

  it('is case-insensitive on both sides, for both fields', () => {
    expect(matchesSessionQuery('Split The Settings Loader', undefined, 'SETTINGS')).toBe(true);
    expect(matchesSessionQuery('split the settings loader', undefined, 'Settings')).toBe(true);
    expect(matchesSessionQuery('Untitled', 'feature/Settings-Loader', 'settings-loader')).toBe(true);
    expect(matchesSessionQuery('Untitled', 'FEATURE/X', 'feature/x')).toBe(true);
  });

  it('a row with no branch can only match on its title', () => {
    expect(matchesSessionQuery('Untitled', undefined, 'untitled')).toBe(true);
    expect(matchesSessionQuery('Untitled', undefined, 'main')).toBe(false);
    expect(matchesSessionQuery('Untitled', '', 'main')).toBe(false);
  });

  it('the title wins even when the branch does not match, and vice versa', () => {
    expect(matchesSessionQuery('settings', 'docs/tidy', 'settings')).toBe(true);
    expect(matchesSessionQuery('tidy', 'feature/settings', 'settings')).toBe(true);
    expect(matchesSessionQuery('tidy', 'docs/tidy', 'settings')).toBe(false);
  });
});

describe('gitBranch reaches the row', () => {
  it('toSessionListRow maps SDKSessionInfo.gitBranch onto the row', () => {
    const row = toSessionListRow(
      {
        sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
        lastModified: 5,
        gitBranch: 'feature/Settings-Loader',
      } as any,
      '/repo',
      new Set<string>()
    );
    expect(row.gitBranch).toBe('feature/Settings-Loader');
  });

  it('a session with no branch carries undefined, not an empty string', () => {
    const row = toSessionListRow(
      { sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', lastModified: 5 } as any,
      '/repo',
      new Set<string>()
    );
    expect(row.gitBranch).toBeUndefined();
  });

  it('Session.fromServer puts the branch on the session signal', () => {
    const session = Session.fromServer(
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        lastModified: 1,
        summary: 'A',
        gitBranch: 'feature/Settings-Loader',
        isCurrentWorkspace: true,
      } as any,
      async () => ({}) as any,
      sessionContext
    );
    expect(session.gitBranch()).toBe('feature/Settings-Loader');
  });
});
