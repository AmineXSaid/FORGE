/**
 * The Plugins tab's helpers, ported from the official plugin manager dialog:
 * the install count, the search, the source labels and links, and the update
 * failure classifier with the official's titles and messages.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyUpdateFailure,
  describeUpdateFailure,
  filterAvailable,
  formatInstallCount,
  isOfficialMarketplace,
  marketplaceSourceLabel,
  marketplaceUrl,
  pluginDisplayName,
  pluginMarketplace,
  pluginSourceUrl,
  sortAvailable,
  updateNotice,
} from '../src/webview/src/components/settings/plugins';

const plugin = (name: string, description: string, marketplaceName: string, installCount?: number) => ({
  entry: { name, description },
  marketplaceName,
  pluginId: `${name}@${marketplaceName}`,
  isInstalled: false,
  installCount,
});

describe('plugins: the lists', () => {
  it('writes install counts as the official L85 does', () => {
    expect(formatInstallCount(999)).toBe('999');
    expect(formatInstallCount(1000)).toBe('1k');
    expect(formatInstallCount(48210)).toBe('48.2k');
    expect(formatInstallCount(2_000_000)).toBe('2m');
  });

  it('searches name, description and marketplace, and sorts by installs', () => {
    const list = [plugin('github', 'Issues and PRs', 'official', 10), plugin('lint', 'Style checks', 'acme', 500)];
    expect(filterAvailable(list, '  ').length).toBe(2);
    expect(filterAvailable(list, 'PRS').map((p) => p.entry.name)).toEqual(['github']);
    expect(filterAvailable(list, 'acme').map((p) => p.entry.name)).toEqual(['lint']);
    expect(sortAvailable(list).map((p) => p.entry.name)).toEqual(['lint', 'github']);
  });

  it('names an installed plugin without its marketplace', () => {
    const installed = { name: 'fmt@acme', manifest: { name: 'fmt@acme' }, path: '', source: 'fmt@acme', enabled: true };
    expect(pluginDisplayName(installed)).toBe('fmt');
    expect(pluginMarketplace(installed)).toBe('acme');
  });
});

describe('plugins: marketplaces', () => {
  it('labels and links each kind of source', () => {
    const gh = { source: 'github', repo: 'anthropics/claude-plugins-official' } as const;
    expect(isOfficialMarketplace(gh)).toBe(true);
    expect(isOfficialMarketplace({ source: 'github', repo: 'acme/plugins' })).toBe(false);
    expect(marketplaceSourceLabel(gh)).toBe('GitHub: anthropics/claude-plugins-official');
    expect(marketplaceSourceLabel({ source: 'directory', path: 'C:/p' })).toBe('Directory: C:/p');
    expect(marketplaceUrl(gh)).toBe('https://github.com/anthropics/claude-plugins-official');
    expect(marketplaceUrl({ source: 'git', url: 'git@github.com:a/b.git' })).toBeNull();
    expect(marketplaceUrl({ source: 'directory', path: 'C:/p' })).toBeNull();
    expect(pluginSourceUrl(gh, './plugins/github')).toBe('https://github.com/anthropics/claude-plugins-official/tree/main/plugins/github');
    expect(pluginSourceUrl({ source: 'git', url: 'https://github.com/a/b.git' }, './x')).toBe('https://github.com/a/b/tree/main/x');
    expect(pluginSourceUrl(gh, { source: 'git-subdir' })).toBe('https://github.com/anthropics/claude-plugins-official');
  });
});

describe('plugins: a failed update', () => {
  it('reads the kind from the CLI message, as uy and w85 do', () => {
    const cli = (m: string) => `Claude CLI exited with code 1: ✘ Failed to update plugin "fmt@acme": ${m}`;
    expect(classifyUpdateFailure('Claude CLI timed out after 30s: ').kind).toBe('timeout');
    expect(classifyUpdateFailure(cli('Plugin "fmt" is blocked by your organization\'s policy')).kind).toBe('policy');
    expect(classifyUpdateFailure(cli('fmt@acme is disabled, so the command that installs it was not run.')).kind).toBe('disabled');
    expect(classifyUpdateFailure(cli('fmt@acme is installed by running a command on this machine (`npx x`) that has not been reviewed yet, so it was not run.')).kind).toBe('needs_consent');
    expect(classifyUpdateFailure(cli('Plugin "fmt@acme" is not installed at scope user')).kind).toBe('not_installed');
    expect(classifyUpdateFailure(cli('Plugin "fmt@acme" not found')).kind).toBe('not_found');
    expect(classifyUpdateFailure(cli('Failed to clone repository: timeout')).kind).toBe('network');
    const other = classifyUpdateFailure(cli('Something odd'));
    expect(other).toEqual({ kind: 'other', detail: 'Something odd' });
  });

  it("says what the official says", () => {
    expect(describeUpdateFailure('not_found', 'fmt', 'acme')).toEqual({
      title: "fmt isn't in your copy of acme",
      message: 'Refresh the marketplace, then try the update again.',
    });
    expect(describeUpdateFailure('network', 'fmt', 'acme').message).toBe('The marketplace could not be reached.');
    expect(updateNotice('fmt', 'fmt@acme is already at the latest version (1.0.0).')).toBe('fmt is already at the latest version.');
    expect(updateNotice('fmt', 'Skipped: pinned')).toBe('fmt was not updated because another plugin needs the version it has.');
    expect(updateNotice('fmt', 'x', true)).toBe("fmt may already be at the latest version; the marketplace couldn't be checked.");
  });
});
