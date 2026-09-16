/**
 * Forge brand geometry -- the one source for every place the F is drawn: the
 * ForgeMark component, the wordmark, and the packaged icons written by
 * scripts/gen-forge-marks.mjs. The generator reads these arrays as text, so keep
 * them plain numeric literals.
 *
 * The F is "crossbar break": a voxel F on a six-module grid whose crossbar has
 * one module knocked out. Where there is room the missing module is drawn as a
 * faint ghost; at icon sizes it is simply absent.
 */

/** Modules per side. Every rendered size should be a whole multiple of this. */
export const F_MODULES = 6;

/** Solid modules, as [x, y, width, height]. */
export const F_SOLID: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 2, 6], // stem
  [2, 0, 4, 2], // top bar
  [2, 3, 1, 1], // crossbar, before the break
  [4, 3, 1, 1], // crossbar, after the break
];

/** The knocked-out crossbar module, as [x, y, width, height]. */
export const F_GHOST: readonly [number, number, number, number] = [3, 3, 1, 1];

/** Opacity of the ghost module where it is drawn. */
export const F_GHOST_OPACITY = 0.2;
