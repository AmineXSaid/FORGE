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
 * Profiles are YAML files. They live in `~/.forge/endpoints` by default, or
 * wherever `forge.endpointProfilesDir` points, and `forge.endpointProfile`
 * selects the active one by name. With no active profile this service does
 * nothing at all and Forge talks to Anthropic directly.
 */
import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { loadAllProfiles, type EndpointProfile, type ProfileError } from './profile';
import { startRelay, type RunningRelay } from './relay';
import { clearAuthCache } from './auth';
import { clearSecureContexts } from './transport';
import { listModels, type ListedModel } from './check';
import { candidateIds } from './models';
import { keepHealthy, type EndpointHealth } from './healthStore';

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

/** What a profile will actually serve, after health has had its say. */
export interface ServedModels {
  profile: EndpointProfile;
  /** Ids to offer, in picker order. */
  ids: string[];
  /** Where the candidates came from, which decides how health filters them. */
  source: 'declared' | 'listing';
  /** How many ids the gateway listed, before any filtering. */
  listed: number;
  /** Set when the listing could not be fetched. The ids fall back to the profile. */
  error?: string;
}

export interface IEndpointService {
  readonly _serviceBrand: undefined;

  /** All profiles that parse, plus the ones that did not. */
  listProfiles(): { profiles: EndpointProfile[]; errors: ProfileError[] };

  /**
   * The models to offer for a profile.
   *
   * @param health the stored verdicts, when there are any. Given them, the
   *   list is filtered through `keepHealthy` -- which is why this takes the
   *   record rather than reading it: the health service reads profiles from
   *   here, and importing it back would close a cycle through a file holding a
   *   `createDecorator` call. See `healthStore.ts`.
   */
  servedModels(profileName?: string, health?: EndpointHealth): Promise<ServedModels | undefined>;

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
}

export class EndpointService implements IEndpointService {
  readonly _serviceBrand: undefined;

  private relay?: RunningRelay;
  private activeProfile?: EndpointProfile;
  private report: string[] = [];
  private errors: ProfileError[] = [];
  private available: EndpointProfile[] = [];

  constructor(@ILogService private readonly logService: ILogService) {}

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
   * The gateway's listing, held for one relay lifetime.
   *
   * The cache and the health store answer different questions and cannot
   * disagree, because neither overrules the other: membership comes from the
   * live listing -- a model the gateway stopped listing is gone whatever a
   * stale healthy verdict says -- and exclusion comes from the store. The
   * filter is re-applied on every call rather than baked into the cached value.
   */
  private servedModelCache = new Map<string, { listed: ListedModel[]; error?: string }>();

  listProfiles(): { profiles: EndpointProfile[]; errors: ProfileError[] } {
    const result = loadAllProfiles(this.profilesDir);
    this.available = result.profiles;
    this.errors = result.errors;
    for (const e of result.errors) {
      this.logService.warn(`[endpoints] ${e.file ?? 'profile'}: ${e.message}`);
    }
    return result;
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
        `[endpoints] forge.endpointProfile is "${name}", but no such profile was found in ${this.profilesDir}. ` +
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
        secrets: (key) => process.env[key],
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

  async servedModels(profileName?: string, health?: EndpointHealth): Promise<ServedModels | undefined> {
    const name = profileName?.trim() || this.activeName;
    if (!name) return undefined;
    const { profiles } = this.listProfiles();
    const profile = profiles.find((p) => p.name === name);
    if (!profile) return undefined;

    let cached = this.servedModelCache.get(profile.name);
    if (!cached) {
      const result = await listModels(profile, (key) => process.env[key]);
      cached = { listed: result.models, ...(result.error ? { error: result.error } : {}) };
      this.servedModelCache.set(profile.name, cached);
    }

    const { ids, source } = candidateIds(profile, cached.listed);
    return {
      profile,
      ids: keepHealthy(ids, health, source),
      source,
      listed: cached.listed.length,
      ...(cached.error ? { error: cached.error } : {}),
    };
  }

  getStatus(): EndpointStatus {
    return {
      profile: this.activeProfile,
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
    // The listing is per relay lifetime, so it goes when the relay goes. The
    // health store outlives both and is not touched here.
    this.servedModelCache.clear();
    clearAuthCache();
    clearSecureContexts();
  }
}
