import { computed, ref, unref, type MaybeRef, type Ref } from 'vue';
import type { TermLine } from './terminalText';

export type CollapseMode = 'head' | 'tail';

/**
 * Long terminal text collapses to `limit` lines: the first ones for input and
 * structured output ("Show N more lines"), the last ones for a running log
 * ("Show N earlier lines"), as a terminal keeps its newest output in view.
 */
export function useLineCollapse(lines: Ref<TermLine[]>, mode: MaybeRef<CollapseMode>, limit: MaybeRef<number>) {
  const expanded = ref(false);
  const canCollapse = computed(() => lines.value.length > unref(limit));
  const hiddenCount = computed(() => (canCollapse.value ? lines.value.length - unref(limit) : 0));
  const collapsed = computed(() => canCollapse.value && !expanded.value);

  const visible = computed(() => {
    if (!collapsed.value) return lines.value;
    return unref(mode) === 'tail' ? lines.value.slice(-unref(limit)) : lines.value.slice(0, unref(limit));
  });

  /** Index of the first visible line, for stable keys. */
  const offset = computed(() => (collapsed.value && unref(mode) === 'tail' ? hiddenCount.value : 0));

  const stateClass = computed(() => {
    if (collapsed.value) return `fterm-collapsed-${unref(mode)}`;
    return canCollapse.value ? 'fterm-expanded' : '';
  });

  const toggleLabel = computed(() => {
    if (expanded.value) return 'Show less';
    const n = hiddenCount.value;
    const noun = `line${n === 1 ? '' : 's'}`;
    return unref(mode) === 'tail' ? `Show ${n} earlier ${noun}` : `Show ${n} more ${noun}`;
  });

  function toggle(): void {
    expanded.value = !expanded.value;
  }

  return { expanded, canCollapse, hiddenCount, visible, offset, stateClass, toggleLabel, toggle };
}
