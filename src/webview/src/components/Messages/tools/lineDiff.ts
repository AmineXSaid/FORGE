/**
 * Line diff for the Edit tool's diff view. The official hands both texts to a
 * Monaco diff editor; Forge computes the same line alignment itself (longest
 * common subsequence) and draws the rows.
 */

export type DiffRow =
  | { kind: 'equal'; original: string; modified: string }
  | { kind: 'removed'; original: string }
  | { kind: 'added'; modified: string };

/** Above this many cells the LCS table is skipped and the texts are shown as one replacement. */
const MAX_CELLS = 250_000;

export function diffLines(original: string, modified: string): DiffRow[] {
  const a = original.split('\n');
  const b = modified.split('\n');

  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((line): DiffRow => ({ kind: 'removed', original: line })),
      ...b.map((line): DiffRow => ({ kind: 'added', modified: line })),
    ];
  }

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'equal', original: a[i], modified: b[j] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      rows.push({ kind: 'removed', original: a[i++] });
    } else {
      rows.push({ kind: 'added', modified: b[j++] });
    }
  }
  while (i < a.length) rows.push({ kind: 'removed', original: a[i++] });
  while (j < b.length) rows.push({ kind: 'added', modified: b[j++] });
  return rows;
}

/** One side-by-side line: a left cell, a right cell, either of which may be blank filler. */
export interface SideBySideRow {
  left?: { text: string; removed: boolean };
  right?: { text: string; added: boolean };
}

/**
 * Pair removed and added runs line for line, the way a side-by-side diff lays a
 * modification out; the shorter run is padded with filler.
 */
export function toSideBySide(rows: DiffRow[]): SideBySideRow[] {
  const out: SideBySideRow[] = [];
  let k = 0;
  while (k < rows.length) {
    const row = rows[k];
    if (row.kind === 'equal') {
      out.push({ left: { text: row.original, removed: false }, right: { text: row.modified, added: false } });
      k++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (k < rows.length && rows[k].kind !== 'equal') {
      const r = rows[k++];
      if (r.kind === 'removed') removed.push(r.original);
      else if (r.kind === 'added') added.push(r.modified);
    }
    for (let n = 0; n < Math.max(removed.length, added.length); n++) {
      out.push({
        left: n < removed.length ? { text: removed[n], removed: true } : undefined,
        right: n < added.length ? { text: added[n], added: true } : undefined,
      });
    }
  }
  return out;
}
