/**
 * The pure half of "Forge: Add Endpoint Profile".
 *
 * Reported from a real install: "endpoints were settings.json-only; nothing in
 * the UI led there." The command that fixes that lives in `forgeCommands.ts`,
 * because it is a sequence of VS Code prompts -- but what it *validates* and
 * what it *writes* are decisions, not UI, so they live here where a test can
 * reach them without a workbench.
 *
 * The flow takes the token itself -- asking for the name of an environment
 * variable first is friction for the one step someone came here to do. What it
 * does *not* do is write that token into `settings.json`, which syncs between
 * machines and tends to get committed: the token goes to VS Code's
 * `SecretStorage` and the profile stores a `${secret:…}` reference, which
 * `interpolate()` resolves at request time.
 */
import type { Wire } from './profile';
import { secretRef } from './secretStore';

/** What the guided flow collects, before it becomes a settings value. */
export interface ProfileDraft {
  /** `openai` or `anthropic`. `raw` is not offered: it needs a transform module. */
  wire: Exclude<Wire, 'raw'>;
  baseUrl: string;
  model: string;
  auth: DraftAuth;
}

export type DraftAuth =
  | { kind: 'none' }
  /** `secretKey` is the SecretStorage key the token was filed under, not the token. */
  | { kind: 'bearer'; secretKey: string }
  | { kind: 'header'; header: string; secretKey: string };

/**
 * A name is both a `forge.endpoints` key and the value of
 * `forge.endpointProfile`, so it has to be typeable and unambiguous.
 */
export function validateProfileName(value: string, taken: Iterable<string>): string | undefined {
  const name = value.trim();
  if (!name) return 'A name is required.';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    return 'Use letters, digits, dot, dash or underscore.';
  }
  for (const existing of taken) {
    if (existing === name) return `"${name}" already exists.`;
  }
  return undefined;
}

/** The origin Forge will POST to. Anything that is not http(s) is a typo. */
export function validateBaseUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'A base URL is required.';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'That is not a URL.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use http:// or https://.';
  return undefined;
}

/**
 * The token itself.
 *
 * Deliberately permissive about shape -- gateways issue all sorts, and refusing
 * one because it does not look like an Anthropic key would be a guess that
 * blocks a working endpoint. The two things worth catching are an empty box
 * and a value that is already a reference, which is what someone who read the
 * old documentation would paste.
 */
export function validateToken(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'A token is required.';
  if (/^\$\{(env|file|secret):/.test(trimmed)) {
    return 'Paste the token itself. Forge stores it in the OS keychain for you.';
  }
  if (/\s/.test(trimmed)) return 'A token has no spaces. Check for a stray copy.';
  return undefined;
}

export function validateModel(value: string): string | undefined {
  return value.trim() ? undefined : 'A model id is required.';
}

export function validateHeaderName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'A header name is required.';
  // RFC 7230 token, which is what a gateway will accept as a header field name.
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(trimmed)) return 'That is not a header name.';
  return undefined;
}

/**
 * The value written under `forge.endpoints[name]`.
 *
 * `name` is deliberately absent: `parseProfileMap` fills it in from the map
 * key, and the key is what `forge.endpointProfile` selects, so repeating it
 * inside the value only creates something that can disagree with itself.
 *
 * Nothing else is written either. `capabilities`, `timeoutMs` and `retries`
 * all have defaults `parseProfile` merges in, and a capability block guessed
 * before the endpoint has ever answered would be a guess the UI then trusts --
 * `forge.detectCapabilities` measures it instead.
 */
export function buildProfileValue(draft: ProfileDraft): Record<string, unknown> {
  return {
    wire: draft.wire,
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
    auth: buildAuth(draft.auth),
  };
}

function buildAuth(auth: DraftAuth): Record<string, unknown> {
  switch (auth.kind) {
    case 'none':
      return { kind: 'none' };
    case 'bearer':
      return { kind: 'bearer', value: secretRef(auth.secretKey) };
    case 'header':
      return { kind: 'header', header: auth.header.trim(), value: secretRef(auth.secretKey) };
  }
}
