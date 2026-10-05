import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { DOT_SETTLED, SETTLE_MS, useDotSettle } from '../src/webview/src/composables/useDotSettle';

function harness(initial: string) {
  const dot = ref(initial);
  let settled!: ReturnType<typeof useDotSettle>;
  const scope = effectScope();
  scope.run(() => { settled = useDotSettle(dot); });
  return { dot, settled: () => settled.value, scope };
}

describe('useDotSettle: the burst plays only when a running row finishes', () => {
  it('progress -> success settles, then clears', async () => {
    vi.useFakeTimers();
    const h = harness('fg-chat__dotProgress');
    h.dot.value = 'fg-chat__dotSuccess';
    await nextTick();
    expect(h.settled()).toBe(DOT_SETTLED);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.settled()).toBe('');
    vi.useRealTimers();
  });

  it('progress -> failure settles too', async () => {
    const h = harness('fg-chat__dotProgress');
    h.dot.value = 'fg-chat__dotFailure';
    await nextTick();
    expect(h.settled()).toBe(DOT_SETTLED);
  });

  it('waiting on the user -> passed settles; progress <-> waiting does not', async () => {
    const h = harness('fg-chat__dotProgress');
    h.dot.value = 'fg-chat__dotWarning';
    await nextTick();
    expect(h.settled()).toBe('');
    h.dot.value = 'fg-chat__dotSuccess';
    await nextTick();
    expect(h.settled()).toBe(DOT_SETTLED);
  });

  it('a row that mounts finished, or changes between finished states, stays still', async () => {
    const h = harness('fg-chat__dotSuccess');
    expect(h.settled()).toBe('');
    h.dot.value = 'fg-chat__dotFailure';
    await nextTick();
    expect(h.settled()).toBe('');
    h.dot.value = '';
    await nextTick();
    expect(h.settled()).toBe('');
  });

  it('a timer pending at unmount is cleared', async () => {
    vi.useFakeTimers();
    const h = harness('fg-chat__dotProgress');
    h.dot.value = 'fg-chat__dotSuccess';
    await nextTick();
    expect(vi.getTimerCount()).toBe(1);
    h.scope.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
