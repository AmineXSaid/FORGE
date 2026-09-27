/**
 * Forge brand geometry -- the one source for every place the mark is drawn: the
 * ForgeMark component, the wordmark, and the packaged icons written by
 * scripts/gen-forge-marks.mjs. The generator reads these arrays as text, so keep
 * them plain numeric literals.
 *
 * The mark is "F + cube": a voxel F on a six-module grid, stem and top bar only,
 * with the Forge cube seated in the niche where the crossbar would be. The cube
 * is the finished cube of cube.ts (28 degree tilt, a vertical edge toward the
 * viewer, lit from the upper left), so the mark and the working indicator show
 * the same object from the same angle under the same light.
 */

/** Modules per side. Every rendered size should be a whole multiple of this. */
export const F_MODULES = 6;

/** Solid modules of the F, as [x, y, width, height]. */
export const F_SOLID: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 2, 6], // stem
  [2, 0, 4, 2], // top bar
];

/** A cube face as its corner points [x, y], in modules. */
export type CubeFace = ReadonlyArray<readonly [number, number]>;

/**
 * The cube in the crossbar niche: three modules wide, its left edge half a
 * module off the stem and its top apex 0.4 below the top bar. Faces in paint
 * order. test/forgeMarks.spec.ts re-derives these from cube.ts's projection.
 */
export const F_CUBE: Readonly<Record<'top' | 'lit' | 'shade', CubeFace>> = {
  top: [[4, 2.4], [5.5, 3.104], [4, 3.808], [2.5, 3.104]],
  lit: [[2.5, 3.104], [4, 3.808], [4, 5.681], [2.5, 4.977]],
  shade: [[4, 3.808], [5.5, 3.104], [5.5, 4.977], [4, 5.681]],
};

/**
 * Face opacities for single-colour cuts (the activity bar masks its icon to one
 * colour, so only alpha separates the faces).
 */
export const F_CUBE_FLAT: Readonly<Record<'top' | 'lit' | 'shade', number>> = { top: 1, lit: 0.6, shade: 0.3 };

/** SVG path data for a face. */
export const facePath = (face: CubeFace) => 'M' + face.map(([x, y]) => `${x} ${y}`).join('L') + 'Z';
