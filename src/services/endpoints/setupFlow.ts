/**
 * "Forge: Add Endpoint Profile": an endpoint and its model, set up together.
 *
 * The user asked for Genesis's model on 2026-09-23 -- a profile is one endpoint
 * *with* the model it runs -- and confirmed four failures of the old flow:
 *
 * 1. **The first message failed.** The chosen model never reached the CLI (fixed
 *    in the launch path), and nothing here checked the pair before saving.
 * 2. **Not active after setup.** Only the toast's "Use it now" selected it.
 * 3. **Local servers.** A local runtime was asked for a key it does not use, and
 *    one that was not detected could not have its port changed.
 * 4. **Wrong or dead model list.** The model was asked for *before* the key, so
 *    an authenticated gateway could not be listed; embedding models were
 *    offered as chat models; listed ids were never checked.
 *
 * The order is now: where it runs, name, URL, wire, key, then the model --
 * listed with the key, embeddings dropped, and on a remote gateway each id
 * checked with one tiny request, answering ones first -- then one real check of
 * the chosen pair, then save and select. Nothing is written until that point,
 * and a failed write takes back the secret it stored.
 *
 * The prompts are reached only through `SetupUi`, so the spec walks every path
 * without a workbench.
 */
import { parseProfile, type EndpointProfile } from './profile';
import type { ModelListResult, ServableResult } from './check';
import type { StartItem } from './startPicker';
import {
  buildProfileValue,
  validateBaseUrl,
  validateHeaderName,
  validateModel,
  validateProfileName,
  validateToken,
  type DraftAuth,
} from './newProfile';
import { suggestProfileName } from './discover';
import { secretKeyFor } from './secretStore';

export interface PickItem<T = unknown> {
  label: string;
  description?: string;
  detail?: string;
  value: T;
}

export interface InputOptions {
  title: string;
  prompt?: string;
  value?: string;
  placeHolder?: string;
  password?: boolean;
  validate?: (value: string) => string | undefined;
}

/** The prompts, as the flow needs them. `undefined` is always "cancelled". */
export interface SetupUi {
  pickStart(existing: readonly EndpointProfile[]): Promise<StartItem | undefined>;
  input(options: InputOptions): Promise<string | undefined>;
  pick<T>(items: PickItem<T>[], options: { title: string; placeHolder?: string }): Promise<PickItem<T> | undefined>;
  withProgress<T>(title: string, task: () => Promise<T>): Promise<T>;
}

/**
 * Where a profile is saved. Always the user's settings: `forge.endpoints` is
 * machine-scoped (a repository must not be able to define an endpoint, its
 * auth command or its transform), so VS Code would refuse a workspace write.
 */
export type SaveTarget = 'user';

export interface SetupDeps {
  /** Profiles that parse, for the "another model from" rows. */
  profiles: readonly EndpointProfile[];
  /** Every name in use, including entries that failed to parse. */
  takenNames: readonly string[];
  /** The raw settings value of an existing profile, to copy its connection. */
  rawProfile(name: string): Record<string, unknown> | undefined;
  /** Secrets already stored (the keychain), for an existing profile's key. */
  storedSecret(key: string): string | undefined;
  listModels(profile: EndpointProfile, secrets: (key: string) => string | undefined): Promise<ModelListResult>;
  probe(profile: EndpointProfile, ids: string[], secrets: (key: string) => string | undefined): Promise<ServableResult[]>;
  check(
    profile: EndpointProfile,
    secrets: (key: string) => string | undefined,
  ): Promise<{ ok: boolean; summary: string; fix?: string }>;
  storeSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  writeProfile(name: string, value: Record<string, unknown>, target: SaveTarget): Promise<void>;
  select(name: string, target: SaveTarget): Promise<void>;
}

export interface SetupResult {
  name: string;
  model: string;
}

/**
 * Ids a chat endpoint lists that are not chat models. Offered in the picker
 * they are a trap: the check fails, or worse, the gateway answers with an error
 * the chat shows as the model's reply.
 */
const NOT_CHAT = /(^|[-_/:.])(embed|embedding|embeddings|rerank|reranker|whisper|tts|bge|e5|nomic-embed|clip|moderation|dall-e|image|audio|transcribe|speech)([-_/:.]|$)|embed/i;

export function chatModelIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !NOT_CHAT.test(id));
}

/** How many listed ids a remote gateway gets checked, each one a 4-token request. */
export const PROBE_CAP = 40;

/** "qwen3-coder:30b" -> "qwen3-coder-30b", for a sibling profile's name. */
function slug(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'model';
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

// Lives in `urls.ts` so the health checks can use it without this module.
import { isLoopback } from './urls';
export { isLoopback };

function ping(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const TYPE_ID = Symbol('type-id');

/** The model picker's rows: answered first (fastest first), then the rest, then free text. */
export function modelItems(
  ids: readonly string[],
  results: readonly ServableResult[] | undefined,
): PickItem<string | typeof TYPE_ID>[] {
  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  const answered = ids
    .filter((id) => byId.get(id)?.servable)
    .sort((a, b) => (byId.get(a)!.ms - byId.get(b)!.ms) || a.localeCompare(b));
  const rest = ids.filter((id) => !byId.get(id)?.servable);
  return [
    ...answered.map((id) => ({ label: `$(pass-filled) ${id}`, description: `answered in ${ping(byId.get(id)!.ms)}`, value: id })),
    ...rest.map((id) => {
      const r = byId.get(id);
      return r
        ? { label: `$(circle-slash) ${id}`, description: `did not answer: ${r.detail ?? 'no reply'}`, value: id }
        : { label: `$(circle-outline) ${id}`, description: results ? 'not checked' : '', value: id };
    }),
    { label: '$(edit) Type a model id…', description: 'For a model the list does not show', value: TYPE_ID },
  ];
}

/** Resolve a draft's secrets: the token being set up first, then the keychain. */
function secretsWith(pending: { key: string; token: string } | undefined, deps: SetupDeps) {
  return (key: string) => (pending && key === pending.key ? pending.token : deps.storedSecret(key));
}

export async function runEndpointSetup(ui: SetupUi, deps: SetupDeps): Promise<SetupResult | 'edit' | undefined> {
  const start = await ui.pickStart(deps.profiles);
  if (!start) return undefined;
  if (start.action === 'edit') return 'edit';

  // ── The connection ────────────────────────────────────────────────────
  let name: string | undefined;
  let raw: Record<string, unknown>;
  let pending: { key: string; token: string } | undefined;
  const target: SaveTarget = 'user';
  let fromProfile: EndpointProfile | undefined;

  if (start.from) {
    // Another model from an endpoint that already works: same URL, wire, key
    // (the same `${secret:…}` reference), only the model differs.
    fromProfile = start.from;
    const copied = deps.rawProfile(fromProfile.name);
    raw = copied ? { ...copied } : { wire: fromProfile.wire, baseUrl: fromProfile.baseUrl, auth: { kind: 'none' } };
  } else {
    name = await ui.input({
      title: start.runtime ? `Add ${start.runtime.label}: name` : 'Add endpoint: name',
      prompt: 'What this endpoint is called in the model menu.',
      value: start.runtime ? suggestProfileName(start.runtime.id, deps.takenNames) : undefined,
      placeHolder: 'company-gateway',
      validate: (v) => validateProfileName(v, deps.takenNames),
    });
    if (!name) return undefined;
    name = name.trim();

    // A runtime that answered has its URL; one that did not may run on a
    // different port, so its default is offered for editing, not assumed.
    let baseUrl = start.found ? start.runtime!.baseUrl : undefined;
    if (!baseUrl) {
      baseUrl = await ui.input({
        title: start.runtime ? `Add ${start.runtime.label}: address` : 'Add endpoint: base URL',
        prompt: start.runtime
          ? `Not detected at its default address. Change the port if it runs elsewhere.`
          : 'The address Forge talks to, e.g. https://gateway.example.com/v1.',
        value: start.runtime?.baseUrl,
        placeHolder: 'https://gateway.example.com/v1',
        validate: validateBaseUrl,
      });
      if (!baseUrl) return undefined;
    }

    const wire = start.runtime
      ? 'openai'
      : (await ui.pick(
        [
          { label: 'OpenAI-compatible', detail: 'Chat Completions: vLLM, Ollama, LiteLLM, OpenRouter, Azure OpenAI, most gateways.', value: 'openai' as const },
          { label: 'Anthropic Messages', detail: 'api.anthropic.com, Bedrock or Vertex relays, Anthropic-compatible proxies.', value: 'anthropic' as const },
        ],
        { title: 'Add endpoint: API', placeHolder: 'Which API does it speak?' },
      ))?.value;
    if (!wire) return undefined;

    // A local runtime takes no key. A gateway usually does; which header
    // depends on the API it speaks.
    let auth: DraftAuth = { kind: 'none' };
    if (!start.runtime) {
      const kinds = [
        { label: 'Bearer token', detail: 'Authorization: Bearer <key>. What most gateways want.', value: 'bearer' as const },
        { label: 'API key header', detail: wire === 'anthropic' ? 'x-api-key, as api.anthropic.com expects.' : 'api-key, x-api-key or similar.', value: 'header' as const },
        { label: 'No key', detail: 'An endpoint on a trusted network.', value: 'none' as const },
      ];
      if (wire === 'anthropic') kinds.unshift(kinds.splice(1, 1)[0]);
      const kind = await ui.pick(kinds, { title: 'Add endpoint: key', placeHolder: 'How does it authenticate?' });
      if (!kind) return undefined;
      if (kind.value !== 'none') {
        const token = await ui.input({
          title: 'Add endpoint: key',
          prompt: 'Paste the key. Forge keeps it in the OS keychain, never in settings.json.',
          password: true,
          validate: validateToken,
        });
        if (!token) return undefined;
        pending = { key: secretKeyFor(name), token: token.trim() };
        if (kind.value === 'header') {
          const header = await ui.input({
            title: 'Add endpoint: header name',
            prompt: 'Which header carries the key.',
            value: wire === 'anthropic' ? 'x-api-key' : 'api-key',
            validate: validateHeaderName,
          });
          if (!header) return undefined;
          auth = { kind: 'header', header: header.trim(), secretKey: pending.key };
        } else {
          auth = { kind: 'bearer', secretKey: pending.key };
        }
      }
    }
    raw = buildProfileValue({ wire, baseUrl, model: 'x', auth });
    delete raw.model;
  }

  const secrets = secretsWith(pending, deps);
  const draftName = fromProfile?.name ?? name!;
  const draft = (model: string): EndpointProfile => parseProfile({ ...raw, name: draftName, model }, 'setup');
  const host = hostOf(String(raw.baseUrl));

  // ── The model: listed with the key, checked, picked ───────────────────
  const listing = await ui.withProgress(`Loading the models ${host} serves…`, () => deps.listModels(draft('probe'), secrets));
  const listed = listing.error !== undefined ? [] : chatModelIds(listing.models.map((m) => m.id));
  let results: ServableResult[] | undefined;
  // A remote gateway lists names it cannot always serve, so each gets one tiny
  // request. A local runtime's list is its disk, and probing would load every
  // model into memory in turn; its pair is checked once, below.
  if (!start.runtime && !isLoopback(String(raw.baseUrl)) && listed.length) {
    const candidates = listed.slice(0, PROBE_CAP);
    results = await ui.withProgress(`Checking which of ${candidates.length} models answer…`, () =>
      deps.probe(draft(candidates[0]), candidates, secrets),
    );
  }

  let model: string | undefined;
  for (;;) {
    if (!model) {
      if (listed.length) {
        const picked = await ui.pick(modelItems(listed, results), {
          title: fromProfile ? `Another model from ${fromProfile.name}` : 'Add endpoint: model',
          placeHolder: results
            ? `${results.filter((r) => r.servable).length} of ${results.length} checked models answered. Pick the one to use.`
            : `Pick the model to use (${listed.length} available).`,
        });
        if (!picked) return undefined;
        if (picked.value !== TYPE_ID) model = picked.value as string;
      }
      if (!model) {
        model = await ui.input({
          title: 'Add endpoint: model id',
          prompt: listing.error !== undefined
            ? `Could not list the models (${listing.error}). Type the id the endpoint expects.`
            : 'The model id, exactly as the endpoint expects it.',
          placeHolder: String(raw.wire) === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o',
          validate: validateModel,
        });
        if (!model) return undefined;
        model = model.trim();
      }
    }

    // ── One real check of the pair ───────────────────────────────────────
    const chosen = model;
    const verdict = await ui.withProgress(`Checking ${chosen} on ${host}…`, () => deps.check(draft(chosen), secrets));
    if (verdict.ok) break;
    const next = await ui.pick(
      [
        { label: '$(list-selection) Pick another model', value: 'model' as const },
        { label: '$(save) Save anyway', detail: 'Keep it; the chat shows the error until the endpoint answers.', value: 'save' as const },
        { label: '$(close) Cancel', value: 'cancel' as const },
      ],
      { title: `${chosen} did not answer`, placeHolder: [verdict.summary, verdict.fix].filter(Boolean).join(' ') },
    );
    if (!next || next.value === 'cancel') return undefined;
    if (next.value === 'save') break;
    model = undefined;
  }

  // ── Save and select ───────────────────────────────────────────────────
  if (fromProfile) {
    const taken = new Set(deps.takenNames);
    let suggested = `${fromProfile.name}-${slug(model)}`;
    for (let n = 2; taken.has(suggested); n++) suggested = `${fromProfile.name}-${slug(model)}-${n}`;
    name = await ui.input({
      title: 'Another model: name',
      prompt: 'What this endpoint and model are called in the model menu.',
      value: suggested,
      validate: (v) => validateProfileName(v, deps.takenNames),
    });
    if (!name) return undefined;
    name = name.trim();
  }

  // The secret first, so the saved profile never names a key the keychain
  // does not hold; and taken back if the profile cannot be written, so a
  // failed setup leaves nothing behind.
  if (pending) await deps.storeSecret(pending.key, pending.token);
  try {
    await deps.writeProfile(name!, { ...raw, model }, target);
  } catch (error) {
    if (pending) await deps.deleteSecret(pending.key).catch(() => {});
    throw error;
  }
  await deps.select(name!, target);
  return { name: name!, model: model! };
}
