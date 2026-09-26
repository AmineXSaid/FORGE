/**
 * Small string-similarity helpers for "did you mean" hints.
 *
 * Used by the relay (a tool name the model invented) and the host (a file path
 * it invented, a line it misremembered). Deliberately simple and dependency-
 * free: these rank a handful of candidates, they do not search a corpus.
 */

/** Classic edit distance, with an early exit once `limit` is exceeded. */
export function levenshtein(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Dice coefficient over character bigrams, 0..1. */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = bigrams.get(g) ?? 0;
    if (n > 0) {
      overlap++;
      bigrams.set(g, n - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length - 2);
}

/**
 * The closest candidates to `name`, best first, at most `max`.
 *
 * Ranking, from alphacode `tool/mod.rs` `closest_tool_names`: an exact
 * case-insensitive match, then a prefix, then a substring, then anything
 * within an edit distance of a third of the name's length (at least 2).
 */
export function closestNames(name: string, candidates: readonly string[], max = 3): string[] {
  const needle = name.toLowerCase();
  const scored: [number, string][] = [];
  for (const candidate of candidates) {
    const hay = candidate.toLowerCase();
    let score: number | undefined;
    if (hay === needle) score = 0;
    else if (hay.startsWith(needle) || needle.startsWith(hay)) score = 1;
    else if (hay.includes(needle) || needle.includes(hay)) score = 2;
    else {
      const limit = Math.max(Math.floor(needle.length / 3), 2);
      const d = levenshtein(needle, hay, limit);
      if (d <= limit) score = 3 + d;
    }
    if (score !== undefined) scored.push([score, candidate]);
  }
  return scored.sort((x, y) => x[0] - y[0] || x[1].localeCompare(y[1])).slice(0, max).map(([, c]) => c);
}
