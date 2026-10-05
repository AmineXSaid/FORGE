import { describe, expect, it } from 'vitest';
import { EDGE, clampPosition, homePosition, keepBottom, readSaved } from '../src/webview/src/components/forge/btw/sideChatPlacement';

const view = { width: 900, height: 820 };
const card = { width: 360, height: 420 };

describe('side-question card placement', () => {
  it('opens bottom-right with its bottom edge above the composer', () => {
    const p = homePosition(card, view, 726);
    expect(p.x + card.width).toBe(900 - 16);
    expect(p.y + card.height).toBe(726 - 12);
  });

  it('a drag never takes it off screen', () => {
    expect(clampPosition({ x: -500, y: -500 }, card, view)).toEqual({ x: EDGE, y: EDGE });
    expect(clampPosition({ x: 5000, y: 5000 }, card, view)).toEqual({ x: 900 - 360 - EDGE, y: 820 - 420 - EDGE });
  });

  it('grows and shrinks upward, keeping its bottom edge', () => {
    const at = { x: 500, y: 400 };
    expect(keepBottom(at, 200, { width: 360, height: 300 }, view)).toEqual({ x: 500, y: 300 });
    expect(keepBottom(at, 300, { width: 200, height: 38 }, view)).toEqual({ x: 500, y: 662 });
  });

  it('a card taller than the room left still stays on screen', () => {
    expect(keepBottom({ x: 500, y: 100 }, 200, { width: 360, height: 700 }, view).y).toBe(EDGE);
  });

  it('reads back only a well-formed saved spot', () => {
    expect(readSaved('{"x":12,"y":40}')).toEqual({ x: 12, y: 40 });
    expect(readSaved('{"x":"a"}')).toBeUndefined();
    expect(readSaved('nope')).toBeUndefined();
    expect(readSaved(null)).toBeUndefined();
  });
});
