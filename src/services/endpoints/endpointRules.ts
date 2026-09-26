/**
 * Rules Forge adds to the system prompt of every session on a given gateway.
 *
 * Asked for on 2026-09-25: every model served by the company gateway
 * (gpt.technica-engineering.net) must follow strict rules. A model there
 * (DeepSeek V4 Flash) looped, re-read files, started subagents and answered at
 * length. The rules belong to the gateway, not to a profile: each user names
 * their profile differently ("TE-GW" for one, something else for the next),
 * and the base URL's path varies (`/v1`, `/api/v1`). So they are matched on the
 * host of the profile's `baseUrl`, and ship with Forge in
 * `resources/endpoint-rules/<host>.md`, with nothing to configure.
 *
 * They are appended to Claude Code's own system prompt (the SDK's
 * `systemPrompt.append`), so they sit where the model's standing instructions
 * are, not in the conversation.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Where the rules live, relative to the extension folder. */
export const ENDPOINT_RULES_DIR = path.join('resources', 'endpoint-rules');

/**
 * The host a profile's rules are filed under, or undefined when its URL has
 * none. Lower-cased, and only a plain DNS name: the host becomes a file name,
 * so anything else (an IPv6 literal, a stray character) finds no rules rather
 * than a path.
 */
export function rulesHost(baseUrl: string | undefined): string | undefined {
    if (!baseUrl) return undefined;
    let host: string;
    try {
        host = new URL(baseUrl).hostname.toLowerCase();
    } catch {
        return undefined;
    }
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host) ? host : undefined;
}

/**
 * The rules for the gateway a profile points at, or undefined when Forge ships
 * none for it.
 *
 * @param resolve maps a path relative to the extension folder to an absolute
 *   one (`ExtensionContext.asAbsolutePath`).
 */
export function endpointRulesFor(
    baseUrl: string | undefined,
    resolve: (relative: string) => string,
    read: (file: string) => string | undefined = (file) => {
        try {
            return fs.readFileSync(file, 'utf8');
        } catch {
            return undefined;
        }
    }
): { host: string; text: string } | undefined {
    const host = rulesHost(baseUrl);
    if (!host) return undefined;
    const text = read(resolve(path.join(ENDPOINT_RULES_DIR, `${host}.md`)))?.trim();
    return text ? { host, text } : undefined;
}

/** The `systemPrompt.append` text: Forge's own, then an agent's, then the gateway's rules. */
export function composeSystemPromptAppend(...parts: Array<string | undefined>): string {
    return parts.map((part) => part?.trim()).filter((part): part is string => !!part).join('\n\n');
}
