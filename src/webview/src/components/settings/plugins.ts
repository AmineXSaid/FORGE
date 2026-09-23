/**
 * The Plugins tab's pure parts, ported from the official plugin manager dialog
 * (`fH0` in webview/index.js) and its helpers. Kept free of Vue so the spec
 * drives them directly.
 */
import type { AvailablePlugin, InstalledPlugin, MarketplaceSource } from '../../../../shared/messages';

/** `O85`: the marketplace the official marks as its own. */
export const OFFICIAL_MARKETPLACE_REPO = 'anthropics/claude-plugins-official';

/** `bH0` */
export function isOfficialMarketplace(source: MarketplaceSource): boolean {
  return source.source === 'github' && source.repo === OFFICIAL_MARKETPLACE_REPO;
}

/** `_85`: how a marketplace's source is written under its name. */
export function marketplaceSourceLabel(source: MarketplaceSource): string {
  switch (source.source) {
    case 'github':
      return `GitHub: ${source.repo}`;
    case 'git':
      return `Git: ${source.url}`;
    case 'url':
      return `URL: ${source.url}`;
    case 'directory':
      return `Directory: ${source.path}`;
    case 'file':
      return `File: ${source.path}`;
    case 'npm':
      return `npm: ${source.package}`;
  }
}

/** `kH0`: a link for a marketplace, when its source has one. */
export function marketplaceUrl(source: MarketplaceSource): string | null {
  switch (source.source) {
    case 'github':
      return `https://github.com/${source.repo}`;
    case 'url':
      return source.url;
    case 'git':
      return source.url.startsWith('http') ? source.url : null;
    default:
      return null;
  }
}

/** `R85`: a link for a plugin inside its marketplace (`./path` sources), else the marketplace's. */
export function pluginSourceUrl(marketplace: MarketplaceSource, pluginSource: unknown): string | null {
  if (typeof pluginSource !== 'string' || !pluginSource.startsWith('./')) return marketplaceUrl(marketplace);
  const sub = pluginSource.slice(2);
  switch (marketplace.source) {
    case 'github':
      return `https://github.com/${marketplace.repo}/tree/main/${sub}`;
    case 'git':
      return marketplace.url.startsWith('https://github.com/')
        ? `${marketplace.url.replace(/\.git$/, '')}/tree/main/${sub}`
        : null;
    default:
      return null;
  }
}

/** `L85`: 48210 -> "48.2k". */
export function formatInstallCount(count: number): string {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return count.toString();
}

/** `T85`: the search box, over name, description and marketplace. */
export function filterAvailable(plugins: AvailablePlugin[], query: string): AvailablePlugin[] {
  if (!query.trim()) return plugins;
  const q = query.toLowerCase().trim();
  return plugins.filter(
    (p) =>
      p.entry.name.toLowerCase().includes(q) ||
      p.entry.description?.toLowerCase().includes(q) ||
      p.marketplaceName.toLowerCase().includes(q),
  );
}

/** The installed list gets the same search (the official only filters "Available"). */
export function filterInstalled(plugins: InstalledPlugin[], query: string): InstalledPlugin[] {
  if (!query.trim()) return plugins;
  const q = query.toLowerCase().trim();
  return plugins.filter(
    (p) => p.manifest.name.toLowerCase().includes(q) || p.manifest.description?.toLowerCase().includes(q),
  );
}

/** Available plugins, most installed first, as the official sorts them. */
export function sortAvailable(plugins: AvailablePlugin[]): AvailablePlugin[] {
  return [...plugins].sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0));
}

/** `Bt`: a plugin's name without its `@marketplace`. */
export function pluginDisplayName(plugin: InstalledPlugin): string {
  const name = plugin.manifest.name;
  const at = name.lastIndexOf('@');
  return at === -1 ? name : name.slice(0, at);
}

/** `IH0`: the marketplace an installed plugin came from. */
export function pluginMarketplace(plugin: InstalledPlugin): string {
  const at = plugin.source.lastIndexOf('@');
  return at === -1 ? plugin.source : plugin.source.slice(at + 1);
}

/** `fF1`: one installed plugin's identity (the same id can be installed per scope). */
export function installedKey(plugin: InstalledPlugin): string {
  return `${plugin.scope ?? ''}:${plugin.projectPath ?? ''}:${plugin.source}`;
}

export type UpdateFailureKind =
  | 'timeout'
  | 'policy'
  | 'disabled'
  | 'needs_consent'
  | 'not_installed'
  | 'not_found'
  | 'network'
  | 'other';

// `F85`, `A85`, `D85`, `P85`, `j85`, `M85`: the CLI's own wording, matched as the official matches it.
const POLICY = /^(?:Plugin "[^"]*" is blocked by your organization's policy|Plugin "[^"]*" is from marketplace "[^"]*", which is blocked by your organization's policy|Command-sourced plugins are disabled by your organization's managed settings|"[^"]*" fetches its archive through a (?:marketplace-declared )?headersHelper command(?: that was not run)?[,:] .*(?:your organization's managed settings|not yet verified|consented))/;
const DISABLED = /^\S+ is disabled, so the command that installs it was not run\./;
const NEEDS_CONSENT = /^(?:Aborted — the headersHelper command was not confirmed|This (?:update|install) would run a headersHelper command for "|The headersHelper command for "[^"]*" changed since it was shown|The archive URL for "[^"]*" changed since its headersHelper command was shown|\S+ is installed by running a command on this machine \(`|\S+'s marketplace entry now installs it by running a command on this machine \(`|\S+'s marketplace entry changed while it was being installed \(it now declares `|\S+'s marketplace changed the command that installs it, or how its output is used \(now `)/;
const NOT_INSTALLED = /^Plugin "[^"]*" is not installed(?: at scope |$)/;
const NOT_FOUND = /^(?:Plugin "[^"]*" not found$|Plugin source not found at |Plugin "[^"]*" is not in the locally cached marketplace catalog)/;
const NETWORK = /^(?:Failed to clone repository: |Failed to (?:fetch|download) |fetch failed|getaddrinfo |connect E[A-Z]+ )/;

export interface UpdateFailure {
  kind: UpdateFailureKind;
  detail: string;
}

/** `uy` + `w85`: what an update failure was, from the CLI's message. */
export function classifyUpdateFailure(reason: string): UpdateFailure {
  const timedOut = reason.startsWith('Claude CLI timed out');
  const detail = reason
    .replace(/^Claude CLI (?:exited with code \S+|timed out after \S+):\s*/, '')
    .replace(/^[✘✗×]\s*Failed to update plugin "[^"]*":\s*/, '')
    .trim();
  let kind: UpdateFailureKind = 'other';
  if (timedOut) kind = 'timeout';
  else if (POLICY.test(detail)) kind = 'policy';
  else if (DISABLED.test(detail)) kind = 'disabled';
  else if (NEEDS_CONSENT.test(detail)) kind = 'needs_consent';
  else if (NOT_INSTALLED.test(detail)) kind = 'not_installed';
  else if (NOT_FOUND.test(detail)) kind = 'not_found';
  else if (NETWORK.test(detail)) kind = 'network';
  return { kind, detail };
}

/**
 * `r2`: the title and message the official shows for each kind. The actions
 * are the component's; this is the copy.
 */
export function describeUpdateFailure(
  kind: UpdateFailureKind,
  name: string,
  marketplace: string,
): { title: string; message: string } {
  switch (kind) {
    case 'timeout':
      return { title: `Updating ${name} is taking too long`, message: "It didn't finish in the time allowed." };
    case 'policy':
      return { title: `${name} can't be updated here`, message: "Your organization's settings block updating this plugin." };
    case 'disabled':
      return { title: `${name} is turned off`, message: 'Turn it on to update it.' };
    case 'needs_consent':
      return { title: `${name} installs by running a command on your machine`, message: "It can't be accepted from here yet." };
    case 'not_installed':
      return { title: `${name} is no longer installed here`, message: 'The list is out of date.' };
    case 'not_found':
      return { title: `${name} isn't in your copy of ${marketplace}`, message: 'Refresh the marketplace, then try the update again.' };
    case 'network':
      return { title: `Something went wrong while updating ${name}`, message: 'The marketplace could not be reached.' };
    case 'other':
      return { title: `Something went wrong while updating ${name}`, message: 'The update did not finish.' };
  }
}

/** The official `L0`'s notice for an update that changed nothing. */
export function updateNotice(name: string, message: string, upstreamUnchecked?: boolean): string {
  if (message.startsWith('Skipped')) return `${name} was not updated because another plugin needs the version it has.`;
  if (upstreamUnchecked) return `${name} may already be at the latest version; the marketplace couldn't be checked.`;
  return `${name} is already at the latest version.`;
}
