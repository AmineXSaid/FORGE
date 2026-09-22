/**
 * Endpoint profiles: BYO-gateway support for Forge.
 *
 * A profile describes an OpenAI/Anthropic-compatible endpoint that is not
 * api.anthropic.com -- a corporate gateway, a self-hosted model, an air-gapped
 * deployment -- together with everything needed to actually reach it: client
 * certificates, a custom CA bundle, an authenticating proxy, a token exchange,
 * and a transform for gateways that are not quite API-shaped.
 *
 * The spawned `claude` binary can do none of that, so when a profile is active
 * this service stands up a loopback relay (see relay.ts) and hands the SDK an
 * `ANTHROPIC_BASE_URL` pointing at it.
 *
 * Profiles come from two places. `forge.endpoints` in `settings.json` is the
 * primary one -- it gets a JSON schema in package.json, so it has IntelliSense,
 * enum validation and hover docs while you type. YAML files in
 * `~/.forge/endpoints` (or wherever `forge.endpointProfilesDir` points) remain
 * supported as a secondary source, which costs nothing because both go through
 * the same `parseProfile`. `forge.endpointProfile` selects the active one by
 * name; settings win a name collision. With no active profile this service does
 * nothing at all and Forge talks to Anthropic directly.
 *
 * Secrets never belong in either source -- `settings.json` syncs and gets
 * committed. Auth values interpolate `${env:VAR}`, `${file:path}` and
 * `${secret:KEY}` at request time instead.
 */
import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { loadAllProfiles, parseProfileMap, type EndpointProfile, type ProfileError } from './profile';
import { startRelay, type RunningRelay } from './relay';
import { clearAuthCache } from './auth';
import { clearSecureContexts } from './transport';
import { secretLookupFor, type SecretReader } from './secretStore';
import { listModels } from './check';
import { EndpointHealthStore, fingerprintOf, keepHealthy } from './healthStore';

export const IEndpointService = createDecorator<IEndpointService>('endpointService');

export interface EndpointStatus {
  /** Active profile, if any. */
  profile?: EndpointProfile;
  /** Where the relay is listening, when one is running. */
  baseUrl?: string;
  /** How the transport was built. Never contains a credential. */
  report: string[];
  /** Profiles that failed to load, so a typo is visible rather than silent. */
  errors: ProfileError[];
  /** Every profile that loaded, for the picker. */
  available: EndpointProfile[];
}

export interface IEndpointService {
  readonly _serviceBrand: undefined;

  /** All profiles that parse, plus the ones that did not. */
  listProfiles(): { profiles: EndpointProfile[]; errors: ProfileError[] };

  /**
   * Environment for the spawned CLI. Empty when no profile is active, so the
   * default Anthropic path is completely untouched.
   *
   * @param profileName overrides `forge.endpointProfile`, so an agent bound to
   *   its own gateway gets that one instead of the global default.
   */
  getEnvironment(profileName?: string): Promise<Record<string, string>>;

  /** Current state, for the settings UI and the output channel. */
  getStatus(): EndpointStatus;

  /** Tear down the relay and drop cached tokens and TLS contexts. */
  reset(): Promise<void>;

  /**
   * A synchronous lookup for the secrets this profile refers to.
   *
   * Every caller that reaches `applyAuth` -- the relay, the diagnostics ladder,
   * the capability probe, the model list -- needs the same one, or a token in
   * SecretStorage resolves for a real request and not for the command meant to
   * tell you why a real request failed.
   */
  secretsFor(profile: EndpointProfile): Promise<(key: string) => string | undefined>;

  /**
   * Every model id this endpoint serves, asked of the gateway itself.
   *
   * For a profile with no `models` block the alternative is a picker holding
   * the single id the profile happens to name, which is what "the model list
   * didn't load" turned out to mean on a gateway serving dozens. Cached per
   * profile and dropped on `reset`, so the handshake costs one request rather
   * than one per launch.
   *
   * `undefined` when the gateway has no `/models` route or cannot be reached --
   * the caller falls back to the profile's own declaration.
   *
   * Filtered through the health store: being listed is not being servable, and
   * an id that has been probed and did not answer is not offered. Until a sweep
   * has run, the listing is returned as-is -- unknown is not the same as bad.
   */
  servedModels(profile: EndpointProfile): Promise<string[] | undefined>;
}

export class EndpointService implements IEndpointService {
  readonly _serviceBrand: undefined;

  private relay?: RunningRelay;
  private activeProfile?: EndpointProfile;
  private report: string[] = [];
  private errors: ProfileError[] = [];
  private available: EndpointProfile[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext | undefined,
    @ILogService private readonly logService: ILogService,
  ) {}

  /**
   * The keychain, when there is one.
   *
   * Optional because a few code paths construct this service without an
   * extension context; there the lookup falls back to the environment, which is
   * what `${secret:…}` did before SecretStorage was wired up.
   */
  private get secretStorage(): SecretReader | undefined {
    return this.context?.secrets;
  }

  async secretsFor(profile: EndpointProfile): Promise<(key: string) => string | undefined> {
    return secretLookupFor(profile, this.secretStorage);
  }

  /** Model ids per profile name, for the lifetime of one relay. */
  private servedModelCache = new Map<string, string[] | undefined>();

  /**
   * The health verdicts, read-only.
   *
   * A store rather than the health *service*, deliberately: the service depends
   * on this one (it needs `listProfiles` and `secretsFor`), so holding the
   * service here would close a dependency cycle. The store is a plain reader
   * over the same `globalState` key, so both see the same records and only the
   * health service ever writes them.
   */
  private get healthStore(): EndpointHealthStore | undefined {
    if (!this.context) return undefined;
    this.health ??= new EndpointHealthStore(this.context.globalState);
    return this.health;
  }
  private health?: EndpointHealthStore;

  /**
   * Which models this endpoint will actually serve.
   *
   * Two sources, and they answer different questions. The gateway's listing
   * says what it *knows the name of*, and it is the only thing that can add a
   * model. The health store says what *answered a real request*, and it is the
   * only thing that can remove one. So membership comes from the live listing
   * and exclusion from the store -- a model the gateway has stopped listing is
   * gone whatever a stale healthy verdict says, and a listed model that failed
   * its probe is not offered however freshly it was listed.
   *
   * That also settles the lifetime question: `servedModelCache` lives for one
   * relay, the store outlives every relay, and they never disagree because
   * neither overrules the other -- the cache holds the listing, the store
   * filters it, and the filter is re-applied on every call rather than baked
   * into the cached value.
   */
  async servedModels(profile: EndpointProfile): Promise<string[] | undefined> {
    const listed = await this.listedModels(profile);
    if (!listed) return undefined;

    const health = this.healthStore?.get(profile.name, fingerprintOf(profile));
    const { ids, reason } = keepHealthy(listed, health);
    this.logService.info(
      `[endpoints] "${profile.name}": ${ids.length} of ${listed.length} listed model(s) offered — ${reason}`,
    );
    // An empty list is a real answer once a sweep has measured it: the picker
    // says "No models available" and the welcome gate offers a re-check. What
    // it must never be is the *absence* of evidence, which `keepHealthy`
    // guarantees by returning the listing untouched when nothing has swept.
    return ids;
  }

  /** The gateway's own listing, cached for the life of one relay. */
  private async listedModels(profile: EndpointProfile): Promise<string[] | undefined> {
    if (this.servedModelCache.has(profile.name)) {
      return this.servedModelCache.get(profile.name);
    }
    let ids: string[] | undefined;
    try {
      const result = await listModels(profile, await this.secretsFor(profile));
      ids = result.error || !result.models.length ? undefined : result.models.map((m) => m.id);
      if (result.error) {
        this.logService.info(`[endpoints] "${profile.name}" did not list models: ${result.error}`);
      } else {
        this.logService.info(`[endpoints] "${profile.name}" serves ${ids?.length ?? 0} model(s)`);
      }
    } catch (e) {
      this.logService.info(`[endpoints] could not list models on "${profile.name}": ${e}`);
    }
    this.servedModelCache.set(profile.name, ids);
    return ids;
  }

  private get profilesDir(): string {
    const configured = vscode.workspace
      .getConfiguration('forge')
      .get<string>('endpointProfilesDir', '');
    return configured?.trim()
      ? configured.replace(/^~(?=$|[/\\])/, os.homedir())
      : path.join(os.homedir(), '.forge', 'endpoints');
  }

  private get activeName(): string {
    return vscode.workspace.getConfiguration('forge').get<string>('endpointProfile', '')?.trim() ?? '';
  }

  /**
   * Every profile, from both sources, with `forge.endpoints` taking precedence.
   *
   * Settings win a name collision because they are the source the user edits by
   * hand and can see in the Settings UI; a stale YAML file silently shadowing
   * the profile someone just typed into `settings.json` would be very hard to
   * diagnose. The collision is logged either way, so it is never silent.
   */
  listProfiles(): { profiles: EndpointProfile[]; errors: ProfileError[] } {
    const fromSettings = parseProfileMap(
      vscode.workspace.getConfiguration('forge').get<Record<string, unknown>>('endpoints', {}),
    );
    const fromFiles = loadAllProfiles(this.profilesDir);

    const profiles = [...fromSettings.profiles];
    const taken = new Set(profiles.map((p) => p.name));
    for (const p of fromFiles.profiles) {
      if (taken.has(p.name)) {
        this.logService.warn(
          `[endpoints] profile "${p.name}" is defined both in forge.endpoints and in ` +
          `${p.sourceFile}. Using the settings one; the file is ignored.`,
        );
        continue;
      }
      taken.add(p.name);
      profiles.push(p);
    }

    const errors = [...fromSettings.errors, ...fromFiles.errors];
    this.available = profiles;
    this.errors = errors;
    for (const e of errors) {
      this.logService.warn(`[endpoints] ${e.file ?? 'profile'}: ${e.message}`);
    }
    return { profiles, errors };
  }

  async getEnvironment(profileName?: string): Promise<Record<string, string>> {
    const name = profileName?.trim() || this.activeName;

    // No profile selected: leave the environment alone entirely.
    if (!name) {
      await this.reset();
      return {};
    }

    const { profiles } = this.listProfiles();
    const profile = profiles.find((p) => p.name === name);
    if (!profile) {
      this.logService.warn(
        `[endpoints] forge.endpointProfile is "${name}", but no such profile was found in ` +
        `forge.endpoints or ${this.profilesDir}. ` +
        `Available: ${profiles.map((p) => p.name).join(', ') || '(none)'}. Falling back to the default endpoint.`,
      );
      await this.reset();
      return {};
    }

    // Reuse a relay that is already serving this exact profile.
    if (this.relay && this.activeProfile?.name === profile.name) {
      return this.envFor(this.relay);
    }

    await this.reset();

    try {
      this.relay = await startRelay({
        profile,
        secrets: await this.secretsFor(profile),
        workspaceRoot:
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        log: (m) => this.logService.info(m),
      });
      this.activeProfile = profile;
      this.report = this.relay.report;
      for (const line of this.report) this.logService.info(`[endpoints] ${line}`);
      return this.envFor(this.relay);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logService.error(`[endpoints] could not start the relay for "${profile.name}": ${message}`);
      void vscode.window.showErrorMessage(
        `Forge: endpoint profile "${profile.name}" could not be started -- ${message}. Using the default endpoint.`,
      );
      await this.reset();
      return {};
    }
  }

  private envFor(relay: RunningRelay): Record<string, string> {
    return {
      ANTHROPIC_BASE_URL: relay.baseUrl,
      ANTHROPIC_AUTH_TOKEN: relay.token,
      // The CLI prefers x-api-key when this is set; the relay accepts either and
      // drops both before forwarding.
      ANTHROPIC_API_KEY: relay.token,
    };
  }

  /**
   * Current state.
   *
   * Falls back to the *selected* profile when no relay is running yet. The
   * webview probes for the model list during init, which can land before the
   * first turn has started a relay; without the fallback the picker would show
   * the CLI's Anthropic tiers for one render and then swap, which looks like a
   * bug and briefly offers models the gateway does not serve.
   */
  getStatus(): EndpointStatus {
    let profile = this.activeProfile;
    if (!profile && this.activeName) {
      const { profiles } = this.listProfiles();
      profile = profiles.find((p) => p.name === this.activeName);
    }
    return {
      profile,
      baseUrl: this.relay?.baseUrl,
      report: this.report,
      errors: this.errors,
      available: this.available,
    };
  }

  async reset(): Promise<void> {
    if (this.relay) {
      await this.relay.close();
      this.logService.info('[endpoints] relay stopped');
    }
    this.relay = undefined;
    this.activeProfile = undefined;
    this.report = [];
    // A profile that was just edited may serve a different list.
    this.servedModelCache.clear();
    clearAuthCache();
    clearSecureContexts();
  }
}
