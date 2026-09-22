/**
 * Where an endpoint's token actually lives.
 *
 * The guided "Add endpoint" flow used to ask for the *name* of an environment
 * variable, because `settings.json` syncs between machines and tends to get
 * committed, so a key written there leaks. Asking the user to go and create an
 * env var first is friction for the one step they came to do.
 *
 * So the flow now takes the token itself and puts it in VS Code's
 * `SecretStorage` -- the OS keychain, per machine, never synced and never in a
 * file git can see. `settings.json` gets `${secret:<key>}`, which `interpolate`
 * already understands.
 *
 * The one wrinkle: `interpolate` is synchronous and `SecretStorage.get` is not.
 * Rather than make the whole auth path async, the secret references in a
 * profile are collected up front, resolved once, and handed over as a plain
 * map. A profile names a handful of secrets at most, so this costs one await
 * per relay start.
 */
import type { EndpointProfile } from './profile';

/** `${secret:KEY}`, the reference `interpolate` resolves. */
const SECRET_REFERENCE = /\$\{secret:([^}]+)\}/g;

/** The SecretStorage key a profile's token is filed under. */
export function secretKeyFor(profileName: string): string {
    return `forge.endpoint.${profileName}.token`;
}

/** The `${secret:…}` reference that points at it. */
export function secretRef(key: string): string {
    return `\${secret:${key}}`;
}

/**
 * Every secret a profile refers to.
 *
 * Only the strings `applyAuth` actually runs through `interpolate`: the auth
 * value, and the exchange's headers and body. Scanning fields that are never
 * interpolated would resolve secrets that cannot be used, which is a quiet way
 * to read more of the keychain than the request needs.
 */
export function collectSecretKeys(profile: EndpointProfile): string[] {
    const found = new Set<string>();
    const scan = (value: unknown): void => {
        if (typeof value !== 'string') return;
        for (const match of value.matchAll(SECRET_REFERENCE)) found.add(match[1]);
    };

    scan(profile.auth?.value);
    const exchange = profile.auth?.exchange;
    if (exchange) {
        scan(exchange.url);
        for (const header of Object.values(exchange.headers ?? {})) scan(header);
        for (const field of Object.values(exchange.body ?? {})) scan(field);
    }

    return [...found];
}

/** The slice of `vscode.SecretStorage` this needs, so a test can supply one. */
export interface SecretReader {
    get(key: string): Thenable<string | undefined>;
}

/**
 * Resolve a profile's secrets into a synchronous lookup.
 *
 * Falls back to the environment for a key the keychain does not hold. That is
 * not a security hole -- it is what `${secret:…}` did before SecretStorage was
 * wired up at all, and dropping it would break any profile written against the
 * old behaviour.
 */
export async function secretLookupFor(
    profile: EndpointProfile,
    storage: SecretReader | undefined,
): Promise<(key: string) => string | undefined> {
    const resolved = new Map<string, string>();
    if (storage) {
        for (const key of collectSecretKeys(profile)) {
            try {
                const value = await storage.get(key);
                if (value !== undefined) resolved.set(key, value);
            } catch {
                // A keychain that will not open is the user's problem to see as
                // an auth failure, not a reason to fail before the request.
            }
        }
    }
    return (key: string) => resolved.get(key) ?? process.env[key];
}
