/**
 * Where the side-question card sits, and where a drag may take it.
 *
 * It opens bottom-right, above the composer -- out of the transcript's
 * reading line, beside where the question was typed. Dragged, it stays
 * wholly on screen (an 8px margin), and the spot is remembered per viewer.
 */
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const EDGE = 8;
/** Clear of the composer's top edge and the chat's right gutter. */
export const HOME_INSET = { right: 16, aboveComposer: 12 } as const;
export const STORAGE_KEY = 'forge.sideQuestions.position';

/** Keep a card of `card` size inside a `view`-sized window. */
export function clampPosition(p: Point, card: Size, view: Size): Point {
  const maxX = Math.max(EDGE, view.width - card.width - EDGE);
  const maxY = Math.max(EDGE, view.height - card.height - EDGE);
  return {
    x: Math.round(Math.min(maxX, Math.max(EDGE, p.x))),
    y: Math.round(Math.min(maxY, Math.max(EDGE, p.y))),
  };
}

/** The opening spot: bottom-right, its bottom edge just above the composer's top. */
export function homePosition(card: Size, view: Size, composerTop: number): Point {
  return clampPosition(
    {
      x: view.width - card.width - HOME_INSET.right,
      y: composerTop - card.height - HOME_INSET.aboveComposer,
    },
    card,
    view,
  );
}

/**
 * The card changed height (an answer arrived, it folded or unfolded): it is
 * anchored by its bottom edge, so it grows and shrinks upward, then stays on
 * screen.
 */
export function keepBottom(p: Point, before: number, after: Size, view: Size): Point {
  return clampPosition({ x: p.x, y: p.y + before - after.height }, after, view);
}

/** A remembered spot, if one was saved and still parses. */
export function readSaved(raw: string | null): Point | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as Partial<Point>;
    return typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? { x: p.x, y: p.y }
      : undefined;
  } catch {
    return undefined;
  }
}

/** A pointer moved this far is a drag, not a click (the official's 4px). */
export const DRAG_SLOP = 4;
