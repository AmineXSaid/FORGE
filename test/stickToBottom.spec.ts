import { describe, expect, it } from 'vitest';
import { StickToBottom, distanceFromBottom, type ScrollBox } from '../src/webview/src/composables/useStickToBottom';

/** A scroll box whose content can grow, like the transcript while diagrams render. */
function box(scrollHeight: number, clientHeight = 600, scrollTop = scrollHeight - clientHeight) {
  const b = { scrollTop, scrollHeight, clientHeight } as ScrollBox & { scrollHeight: number };
  // scrollTop clamps like a real element.
  return new Proxy(b, {
    set(target, key, value) {
      if (key === 'scrollTop') target.scrollTop = Math.max(0, Math.min(value, target.scrollHeight - target.clientHeight));
      else (target as any)[key] = value;
      return true;
    },
  });
}

describe('StickToBottom: the transcript follows its content down', () => {
  it('stays at the bottom while content grows after load (diagrams rendering)', () => {
    const b = box(2000);
    const ctl = new StickToBottom(b);
    (b as any).scrollHeight = 6000; // a diagram rendered
    ctl.onResize();
    expect(distanceFromBottom(b)).toBe(0);
  });

  it('lets a reader who scrolled up read in peace', () => {
    const b = box(2000);
    const ctl = new StickToBottom(b);
    b.scrollTop = 200;
    ctl.onScroll();
    (b as any).scrollHeight = 6000;
    ctl.onResize();
    expect(b.scrollTop).toBe(200);
  });

  it('follows again once the reader comes back to the bottom', () => {
    const b = box(2000);
    const ctl = new StickToBottom(b);
    b.scrollTop = 200;
    ctl.onScroll();
    b.scrollTop = 1380; // 20px from the end: within the threshold
    ctl.onScroll();
    (b as any).scrollHeight = 3000;
    ctl.onResize();
    expect(distanceFromBottom(b)).toBe(0);
  });

  it('stick() goes to the end and follows from there, whatever came before', () => {
    const b = box(2000, 600, 0);
    const ctl = new StickToBottom(b);
    ctl.onScroll();
    expect(ctl.stuck).toBe(false);
    ctl.stick();
    expect(distanceFromBottom(b)).toBe(0);
    expect(ctl.stuck).toBe(true);
  });
});
