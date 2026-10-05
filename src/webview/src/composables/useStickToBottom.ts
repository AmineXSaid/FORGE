/**
 * Keep the transcript at its bottom while its content settles.
 *
 * Rows do not reach their final height when they mount: a mermaid diagram
 * renders asynchronously, code is highlighted, images and fonts load. The
 * chat scrolled to the bottom once, after the rows mounted, and nothing
 * followed the growth after that -- so on a reload, with diagrams in the
 * transcript, the view was left thousands of pixels up (measured 3978px).
 *
 * So the container follows its own content: while the reader is at the
 * bottom (within 50px, the official threshold), any growth keeps them there;
 * once they scroll up to read, it lets them be until they come back down.
 * The rows are the container's direct children (the official DOM, so no
 * wrapper is added): each is watched, and rows added later are picked up.
 */
import { onBeforeUnmount, watch, type Ref } from 'vue';

/** Within this many pixels of the end counts as "at the bottom" (official). */
export const STICK_THRESHOLD = 50;

export interface ScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export const distanceFromBottom = (box: ScrollBox): number => box.scrollHeight - box.scrollTop - box.clientHeight;

/** The decision, without the DOM: whether to follow, and following. */
export class StickToBottom {
  /** Starts stuck: a freshly loaded transcript opens at its end. */
  stuck = true;

  constructor(private readonly box: ScrollBox) {}

  /** A scroll -- the reader's or ours -- decides whether we still follow. */
  onScroll(): void {
    this.stuck = distanceFromBottom(this.box) < STICK_THRESHOLD;
  }

  /** Content changed size: follow it down if we are following. */
  onResize(): void {
    if (this.stuck) this.box.scrollTop = this.box.scrollHeight;
  }

  /** Go to the end and follow from there (a new conversation, a reload). */
  stick(): void {
    this.stuck = true;
    this.box.scrollTop = this.box.scrollHeight;
  }
}

export function useStickToBottom(container: Ref<HTMLElement | null>): { stick: () => void } {
  let controller: StickToBottom | undefined;
  let detach: (() => void) | undefined;

  function attach(el: HTMLElement): () => void {
    const ctl = (controller = new StickToBottom(el));
    const onScroll = () => ctl.onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    const resize = new ResizeObserver(() => ctl.onResize());
    for (const child of el.children) resize.observe(child);
    const rows = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) resize.observe(node);
      }
      ctl.onResize();
    });
    rows.observe(el, { childList: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      resize.disconnect();
      rows.disconnect();
    };
  }

  watch(
    container,
    (el) => {
      detach?.();
      detach = undefined;
      controller = undefined;
      if (el) detach = attach(el);
    },
    { immediate: true, flush: 'post' }
  );
  onBeforeUnmount(() => detach?.());

  return { stick: () => controller?.stick() };
}
