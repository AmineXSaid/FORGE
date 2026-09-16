import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef } from 'vue';

/**
 * Pixel art is only crisp when every art cell covers a whole number of device
 * pixels. At fractional display scaling (125%, 150%) a fixed CSS size smears
 * cells into uneven 2px/3px columns, so marks are sized here instead: the CSS
 * size nearest `target` at which `cells` cells land on whole device pixels.
 *
 * Tracks devicePixelRatio, which changes when the window moves between displays
 * or the user zooms.
 */
export function usePixelSnap(cells: number, target: () => number): ComputedRef<number> {
  const dpr = ref(window.devicePixelRatio || 1);
  let query: MediaQueryList | undefined;

  const onChange = () => {
    dpr.value = window.devicePixelRatio || 1;
    watchResolution();
  };

  // A resolution query only fires when *leaving* the resolution it names, so it
  // is re-armed at the new ratio after every change.
  const watchResolution = () => {
    query?.removeEventListener('change', onChange);
    query = window.matchMedia(`(resolution: ${dpr.value}dppx)`);
    query.addEventListener('change', onChange);
  };

  onMounted(watchResolution);
  onBeforeUnmount(() => query?.removeEventListener('change', onChange));

  return computed(() => {
    const devicePerCell = Math.max(1, Math.round((target() / cells) * dpr.value));
    return (devicePerCell * cells) / dpr.value;
  });
}
