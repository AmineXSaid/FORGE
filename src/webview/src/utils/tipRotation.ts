/**
 * Which tip the empty state shows under the hammer.
 *
 * The tips themselves are the existing list in `RandomTip.vue` (the official
 * tips voiced as Forge, shortcut chips included) plus the opening tip; nothing
 * here writes copy. This only decides which one comes next: a new one on every
 * new conversation, and never the one that was just on screen.
 *
 * The last one shown is remembered across remounts and reloads, since every
 * new conversation mounts a fresh tip and a module-level value alone would
 * forget it on reload -- the one moment a repeat is most noticeable.
 */

export const LAST_TIP_KEY = 'forge.lastTip';

function storageGet(key: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function storageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Without storage a repeat across a reload is possible; nothing else changes.
  }
}

/**
 * A random index into `keys`, never one whose key equals `lastKey`.
 *
 * Keys, not indexes, because the list repeats an entry on purpose (the official
 * list carries its /model tip twice) and two copies of the same words are the
 * same tip to whoever reads them. With nothing else to offer it returns 0.
 */
export function pickDifferent(
  keys: readonly string[],
  lastKey: string | undefined,
  random: () => number = Math.random,
): number {
  const candidates = keys.map((_, i) => i).filter((i) => keys[i] !== lastKey);
  if (!candidates.length) return 0;
  return candidates[Math.floor(random() * candidates.length)];
}

export function readLastTip(): string | undefined {
  return storageGet(LAST_TIP_KEY);
}

export function rememberTip(key: string): void {
  storageSet(LAST_TIP_KEY, key);
}
