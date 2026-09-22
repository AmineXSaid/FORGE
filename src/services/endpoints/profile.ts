import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";

export type Wire = "openai" | "anthropic" | "raw";

export interface AuthSpec {
  /** none: nothing. bearer/header: static. exchange: run a token request first. exec: shell out. */
  kind: "none" | "bearer" | "header" | "exchange" | "exec";
  /** For bearer/header. Supports ${env:VAR} and ${secret:key} interpolation. */
  value?: string;
  header?: string;
  /** kind: exchange */
  exchange?: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    /** form | json */
    encoding?: "form" | "json";
    body?: Record<string, string>;
    /** dot-path into the JSON response holding the token */
    tokenPath?: string;
    /** dot-path holding seconds-until-expiry; else ttlSeconds is used */
    expiresInPath?: string;
    ttlSeconds?: number;
    /** how the resulting token is attached to the model request */
    attachAs?: { header: string; template?: string };
  };
  /** kind: exec - command printing the token to stdout */
  exec?: { command: string; args?: string[]; ttlSeconds?: number; header?: string; template?: string };
}

export interface TlsSpec {
  /** Extra CA bundle(s). Paths, or "system" to pull the OS store. */
  caBundle?: string | string[];
  /** Client certificate for mTLS. */
  cert?: string;
  key?: string;
  keyPassphrase?: string;
  /** PKCS#12 alternative */
  pfx?: string;
  pfxPassphrase?: string;
  /** Explicit opt-in, never silently defaulted. */
  insecureSkipVerify?: boolean;
  servername?: string;
  minVersion?: "TLSv1.2" | "TLSv1.3";
}

export interface ProxySpec {
  url?: string;
  /** Defaults to reading HTTPS_PROXY / NO_PROXY when unset. */
  useEnvironment?: boolean;
  noProxy?: string[];
  /** Proxy auth, if the corporate proxy demands it. */
  auth?: string;
}

export interface Capabilities {
  streaming: boolean;
  tools: boolean;
  toolChoice: boolean;
  vision: boolean;
  systemRole: "message" | "top-level" | "prepend-user";
  contextWindow: number;
  maxOutputTokens: number;
  /** "api" trusts a usage field; "heuristic" estimates locally (offline-safe). */
  tokenCounting: "api" | "heuristic";
  /**
   * How much base64 image data one request may carry, in bytes.
   *
   * Not a token budget - images are priced by their pixels and a screenshot is
   * about 1,400 tokens whatever it weighs. This is a budget for the *body*,
   * because a screenshot is around 200 KB of base64 and a conversation that
   * takes ten of them is a two megabyte POST. Anthropic will accept that; a
   * corporate gateway with a body cap answers it with a 413, and a 413 that
   * arrives after ten useful turns is the worst possible time to find out.
   *
   * When the budget is exceeded the oldest pictures are replaced with a line
   * saying so, newest kept. The most recent screenshot is always sent, whatever
   * it weighs: a cap that could silently discard the thing the model just asked
   * to look at would be worse than the 413.
   */
  maxImageBytes: number;
  parallelToolCalls: boolean;
  /**
   * How this endpoint caches the stable head of a prompt.
   *
   * "anthropic" emits `cache_control` breakpoints on the system block and the
   * tail of the conversation. "prefix" sends nothing - the gateway caches
   * automatically - but the loop still keeps the prefix byte-stable so that
   * caching can hit. "none" disables both, and is the default: these are
   * arbitrary enterprise gateways and an unknown field is a 400 on some of
   * them, so caching is opt-in per profile rather than assumed.
   */
  promptCaching: "anthropic" | "prefix" | "none";
  /** Anthropic cache TTL. Longer costs more to write, survives idle gaps. */
  cacheTtl: "5m" | "1h";
  /**
   * Run tools the model asked for concurrently when none of them can mutate
   * the workspace. Off means the old strictly-sequential behaviour.
   */
  parallelToolExecution: boolean;
  /**
   * This endpoint honours an effort/reasoning knob.
   *
   * Gates the effort rows in the webview (`Session.ts` reads it through the
   * model list). The CLI's effort ladder is entirely client-side, so it keeps
   * *working* against any endpoint -- this says whether it keeps *meaning*
   * anything. A gateway that silently drops `reasoning_effort` would otherwise
   * offer the user four rungs that all produce the same answer.
   */
  effort: boolean;
  /**
   * Which `reasoning_effort` values this endpoint actually honours.
   *
   * Feeds the effort slider and, through it, whether Ultracode is offered at
   * all: the webview only shows Ultracode when the model lists `xhigh`.
   */
  effortLevels: string[];
  /**
   * Which streamed delta field carries reasoning text.
   *
   * Gateways disagree: vLLM and DeepSeek-shaped APIs use `reasoning_content`,
   * OpenRouter and several aggregators use `reasoning`. `none` means the
   * endpoint reasons invisibly, so there is nothing to re-emit as a thinking
   * block and the transcript shows only the answer.
   */
  reasoningField: "reasoning_content" | "reasoning" | "none";
  /**
   * This endpoint has a faster cut of the same model worth exposing as
   * "Toggle fast mode". Off unless the profile says otherwise, because on a
   * single self-hosted model there is no second tier to switch to.
   */
  fastMode: boolean;
  /**
   * This endpoint can complete code at the cursor quickly enough to be worth
   * showing as ghost text.
   *
   * Defaults false, and that is a judgement about what this extension is for
   * rather than caution. Inline completion wants a sub-500ms round trip and a
   * fill-in-the-middle model. This extension exists for corporate gateways,
   * air-gapped deployments and mTLS endpoints, which typically offer neither -
   * so it is the feature most likely to feel broken on exactly the endpoints
   * the product targets. Anyone whose gateway can carry it turns it on and
   * gets it; nobody else pays for a laggy suggestion they did not ask for.
   */
  fim: boolean;
}

/**
 * An image-generation endpoint, when the profile has one.
 *
 * Kept beside the chat settings rather than in a profile of its own because it
 * is nearly always the same host and the same credential - only the path, the
 * model and the response shape differ. A profile without this block simply has
 * no image tool, which is the honest default: most endpoints cannot draw.
 */
export interface ImageSpec {
  /** Model id sent in the body, e.g. `black-forest-labs/flux.1-dev`. */
  model: string;
  /** Path appended to baseUrl. Defaults to `/v1/images/generations`. */
  path?: string;
  /** Default size, e.g. `1024x1024`. Providers disagree; this is passed through. */
  size?: string;
  /** Merged into every image request, for provider-specific knobs. */
  extraBody?: Record<string, unknown>;
  /** Its own budget: drawing takes far longer than a chat completion. */
  timeoutMs?: number;
}

export interface EndpointProfile {
  name: string;
  description?: string;
  wire: Wire;
  baseUrl: string;
  /** Present only when the profile declares an `image:` block. */
  image?: ImageSpec;
  /** Path appended to baseUrl. Some gateways prefix everything. */
  chatPath?: string;
  model: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  auth: AuthSpec;
  tls?: TlsSpec;
  proxy?: ProxySpec;
  capabilities: Capabilities;
  /** Relative path to a .js/.ts module exporting transformRequest/transformResponse. */
  transform?: string;
  /**
   * Negotiate HTTP/2 with the origin.
   *
   * A last resort, and measured rather than assumed. Against NVIDIA NIM it does
   * fix the non-streaming POST that stalls over HTTP/1.1 - but the same switch
   * took a streaming completion from under a second to just over five minutes,
   * because undici's h2 support is experimental and its streaming path is where
   * that shows. Since the agent streams, enabling this usually trades a fast
   * common path for a slow one. Raise `timeoutMs` first.
   */
  http2?: boolean;
  timeoutMs?: number;
  retries?: number;
  /** Free-form defaults merged into every request body. */
  extraBody?: Record<string, unknown>;
  /**
   * Rewrites model ids on the way out, keyed by the id the CLI sends.
   *
   * The CLI does not only send the model the user picked: conversation titles,
   * memory and subagent chores go to a small model chosen from its own built-in
   * table, and that id means nothing to a private gateway. Rather than guess
   * which ids those are, the relay logs every distinct one it sees, so the map
   * can be filled in from evidence.
   */
  modelMap?: Record<string, string>;
  /**
   * Every model this endpoint serves, for the picker and the UI gating.
   *
   * When present, this replaces the CLI's built-in model table in the webview:
   * that table describes Anthropic tiers, which a private gateway does not
   * serve, so showing it would offer the user models that cannot answer. See
   * `models.ts` for how these rows intersect with `capabilities`.
   */
  models?: import('./models').ProfileModel[];
  /** Set when the profile came from a YAML file. */
  sourceFile?: string;
  /** Which source supplied this profile. `settings` wins a name collision. */
  origin?: "settings" | "file";
}

const DEFAULT_CAPS: Capabilities = {
  streaming: true,
  tools: true,
  toolChoice: true,
  vision: false,
  systemRole: "message",
  contextWindow: 32000,
  maxOutputTokens: 4096,
  tokenCounting: "heuristic",
  // Room for roughly six screenshots. Chosen to sit under the 2 MB body limit
  // that is the common default on nginx and most API gateways, with the rest
  // of the conversation and the tool definitions still to fit around it.
  maxImageBytes: 1_500_000,
  parallelToolCalls: false,
  promptCaching: "none",
  cacheTtl: "5m",
  parallelToolExecution: true,
  // Off by default for the same reason `promptCaching` is: an unknown body key
  // is a 400 on some gateways. A profile that knows its model reasons turns it
  // on, and `forge.detectCapabilities` can propose it after probing.
  effort: false,
  effortLevels: ["low", "medium", "high"],
  reasoningField: "none",
  fastMode: false,
  fim: false,
};

export class ProfileError extends Error {
  constructor(message: string, readonly file?: string) {
    super(message);
  }
}

/** Resolve ${env:X} and ${file:path} in a string. Secrets stay out of the YAML. */
export function interpolate(value: string, secrets: (k: string) => string | undefined): string {
  return value.replace(/\$\{(env|file|secret):([^}]+)\}/g, (_m, kind, key) => {
    if (kind === "env") return process.env[key] ?? "";
    if (kind === "secret") return secrets(key) ?? "";
    const p = key.startsWith("~") ? path.join(os.homedir(), key.slice(1)) : key;
    return fs.readFileSync(p, "utf8").trim();
  });
}

/**
 * Validate one already-parsed profile document and fill in the defaults.
 *
 * Split out from `loadProfile` so that a profile written in `settings.json`
 * under `forge.endpoints` and a profile written as YAML on disk go through the
 * *same* validation and the same `DEFAULT_CAPS` merge. Two sources that
 * disagree about what a valid profile is would be a bug generator: the whole
 * point of the capability block is that the UI can trust it.
 *
 * @param doc   the parsed object, from YAML or from settings.
 * @param source human-readable origin, used in error messages so a typo can be
 *   traced back to the file or the settings key that carries it.
 */
export function parseProfile(doc: any, source: string): EndpointProfile {
  if (!doc || typeof doc !== "object") throw new ProfileError("Profile is empty.", source);

  const missing = ["name", "wire", "baseUrl", "model"].filter((k) => !doc[k]);
  if (missing.length) {
    throw new ProfileError(`Missing required field(s): ${missing.join(", ")}`, source);
  }
  if (!["openai", "anthropic", "raw"].includes(doc.wire)) {
    throw new ProfileError(`wire must be openai, anthropic, or raw - got "${doc.wire}"`, source);
  }
  if (doc.wire === "raw" && !doc.transform) {
    throw new ProfileError("wire: raw requires a transform module.", source);
  }
  // An image block with no model would produce a tool the model can call and
  // that can only ever fail, which is worse than not offering it.
  if (doc.image !== undefined) {
    if (typeof doc.image !== "object" || doc.image === null) {
      throw new ProfileError("image: must be a block with a model.", source);
    }
    if (typeof doc.image.model !== "string" || !doc.image.model.trim()) {
      throw new ProfileError("image.model is required when an image block is present.", source);
    }
  }
  // `effortLevels` drives which rungs the webview offers, so a malformed one
  // would produce an effort slider with no positions rather than an error.
  if (doc.capabilities?.effortLevels !== undefined) {
    const levels = doc.capabilities.effortLevels;
    if (!Array.isArray(levels) || levels.some((l: unknown) => typeof l !== "string")) {
      throw new ProfileError("capabilities.effortLevels must be an array of strings.", source);
    }
  }

  return {
    ...doc,
    auth: doc.auth ?? { kind: "none" },
    capabilities: { ...DEFAULT_CAPS, ...(doc.capabilities ?? {}) },
    timeoutMs: doc.timeoutMs ?? 120_000,
    retries: doc.retries ?? 2,
  } as EndpointProfile;
}

export function loadProfile(file: string): EndpointProfile {
  const raw = fs.readFileSync(file, "utf8");
  let doc: any;
  try {
    doc = parseYaml(raw);
  } catch (e: any) {
    throw new ProfileError(`Could not parse YAML: ${e.message}`, file);
  }
  return { ...parseProfile(doc, file), sourceFile: file, origin: "file" };
}

/**
 * Parse the `forge.endpoints` settings map.
 *
 * The map key is the profile name, so a profile written there may leave `name`
 * out; filling it in from the key keeps `settings.json` free of the redundant
 * repetition that YAML files need. An explicit `name` that disagrees with its
 * key loses, because the key is what `forge.endpointProfile` selects.
 */
export function parseProfileMap(
  map: Record<string, unknown> | undefined,
): { profiles: EndpointProfile[]; errors: ProfileError[] } {
  const profiles: EndpointProfile[] = [];
  const errors: ProfileError[] = [];
  for (const [name, value] of Object.entries(map ?? {})) {
    const source = `settings: forge.endpoints.${name}`;
    try {
      const doc = value && typeof value === "object" ? { ...(value as object), name } : value;
      profiles.push({ ...parseProfile(doc, source), origin: "settings" });
    } catch (e) {
      errors.push(e instanceof ProfileError ? e : new ProfileError(String(e), source));
    }
  }
  return { profiles, errors };
}

export function loadAllProfiles(dir: string): { profiles: EndpointProfile[]; errors: ProfileError[] } {
  const profiles: EndpointProfile[] = [];
  const errors: ProfileError[] = [];
  if (!fs.existsSync(dir)) return { profiles, errors };
  for (const entry of fs.readdirSync(dir)) {
    if (!/\.(ya?ml)$/i.test(entry)) continue;
    try {
      profiles.push(loadProfile(path.join(dir, entry)));
    } catch (e) {
      errors.push(e instanceof ProfileError ? e : new ProfileError(String(e), entry));
    }
  }
  return { profiles, errors };
}
