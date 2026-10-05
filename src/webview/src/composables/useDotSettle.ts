/**
 * The timeline dot's "settle": a one-shot burst when a running row finishes.
 *
 * Only the change from running (or waiting on the user) to success or failure plays it -- a row that
 * mounts already finished (a loaded transcript) stays still, which is why
 * this is a watch on the class and not a CSS animation on the finished state.
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue';

export const DOT_PROGRESS = 'fg-chat__dotProgress';
/** Waiting on the user: still unfinished, so finishing from it settles too. */
export const DOT_WAITING = 'fg-chat__dotWarning';
const UNFINISHED = new Set([DOT_PROGRESS, DOT_WAITING]);
export const DOT_SETTLED = 'fg-chat__dotSettled';
/** Long enough for the ring (`fg-dot-settle`, 900ms) to finish. */
export const SETTLE_MS = 950;

export function useDotSettle(dotClass: Ref<string>): Ref<string> {
  const settled = ref('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(dotClass, (next, prev) => {
    if (!UNFINISHED.has(prev) || UNFINISHED.has(next) || !next) return;
    if (timer) clearTimeout(timer);
    settled.value = DOT_SETTLED;
    timer = setTimeout(() => {
      settled.value = '';
      timer = undefined;
    }, SETTLE_MS);
  });
  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });
  return settled;
}
