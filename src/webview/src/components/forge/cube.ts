/**
 * The Forge cube -- the secondary mark. A 3x3x3 block of voxels seen from above
 * at a fixed tilt and lit from the upper left. Shared by the animated working
 * indicator (ForgeCube) and the static mark (ForgeCubeMark), so both show the
 * same object from the same angle under the same light.
 */

export type Vec3 = readonly [number, number, number];

/** How far the view looks down onto the cube: how much of the top face shows. */
const TILT = (28 * Math.PI) / 180;
const COS_TILT = Math.cos(TILT);
const SIN_TILT = Math.sin(TILT);

/** Resting yaw: a vertical edge toward the viewer, both side faces showing. */
export const REST_YAW = Math.PI / 4;

/**
 * Turn a point about the vertical axis by `yaw`, then tilt it toward the viewer.
 * The result is in view space: +x right, +y up, +z toward the viewer.
 */
export function toView(p: Vec3, yaw: number): [number, number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x = p[0] * c + p[2] * s;
  const z = -p[0] * s + p[2] * c;
  return [x, p[1] * COS_TILT - z * SIN_TILT, p[1] * SIN_TILT + z * COS_TILT];
}

export interface Face {
  normal: Vec3;
  /** Corners of the unit face (half-size 1), in perimeter order. */
  corners: readonly Vec3[];
}

export const FACES: readonly Face[] = [
  { normal: [0, 1, 0], corners: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]] },
  { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, 0, -1], corners: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]] },
];

/** A face is drawn when its view-space normal points at the viewer. */
export const facesViewer = (viewNormal: Vec3) => viewNormal[2] > 0.02;

/**
 * How lit a side face is, from 0 (turned from the light) to 1 (facing it).
 * The light sits to the upper left, so faces turned toward -x read lit.
 */
export const sideLight = (viewNormal: Vec3) => Math.min(1, Math.max(0, (1 - viewNormal[0]) / 2));

/** Deterministic noise, so the lump is the same lump everywhere it is drawn. */
const noise = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

export interface Voxel {
  at: Vec3;
  jitter: Vec3;
  /** Scale on the raw stock: corners and some edges start chipped. */
  chip: number;
}

/** The 26 visible voxels of the 3x3x3 block; the core is never seen. */
export const VOXELS: readonly Voxel[] = (() => {
  const voxels: Voxel[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const exposure = Math.abs(x) + Math.abs(y) + Math.abs(z);
        if (exposure === 0) continue;
        const n = voxels.length + 1;
        voxels.push({
          at: [x, y, z],
          jitter: [noise(n) - 0.5, noise(n + 0.37) - 0.5, noise(n + 0.71) - 0.5],
          chip: exposure === 3 ? 0.45 + 0.25 * noise(n + 0.13) : exposure === 2 && noise(n + 0.53) > 0.5 ? 0.72 : 1,
        });
      }
    }
  }
  return voxels;
})();

export interface PlacedVoxel {
  centre: [number, number, number];
  half: number;
}

/**
 * Every voxel in view space at a roughness from 0 (finished) to 1 (raw stock),
 * sorted far to near so painting in order occludes correctly. `pitch` is the
 * voxel spacing; `overlap` widens each voxel to close antialiasing seams.
 */
export function placeVoxels(rough: number, yaw: number, pitch: number, overlap = 0): PlacedVoxel[] {
  const spread = 1 + 0.05 * rough;
  const jitter = 0.26 * rough;
  return VOXELS.map((v) => ({
    centre: toView(
      [
        (v.at[0] * spread + v.jitter[0] * jitter) * pitch,
        (v.at[1] * spread + v.jitter[1] * jitter) * pitch,
        (v.at[2] * spread + v.jitter[2] * jitter) * pitch,
      ],
      yaw,
    ),
    half: (pitch / 2) * (1 + (v.chip - 1) * rough) + overlap,
  })).sort((a, b) => a.centre[2] - b.centre[2]);
}

/** A face's ink in a static mark: the top, or a side facing or turned from the light. */
export type Ink = 'top' | 'lit' | 'shade';

export interface MarkPath {
  ink: Ink;
  d: string;
}

/**
 * The cube at rest as flat SVG paths in paint order, in units where the finished
 * cube spans -1..1. Finished (rough 0) it is three faces; rougher, it is drawn
 * voxel by voxel. `box` is the drawing's bounds as [x, y, width, height].
 */
export function markPaths(rough: number): { paths: MarkPath[]; box: [number, number, number, number] } {
  const blocks: PlacedVoxel[] = rough > 0 ? placeVoxels(rough, REST_YAW, 2 / 3) : [{ centre: [0, 0, 0], half: 1 }];
  const faces = FACES.map((face) => ({
    face,
    normal: toView(face.normal, REST_YAW),
    corners: face.corners.map((c) => toView(c, REST_YAW)),
  })).filter((f) => facesViewer(f.normal));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const paths: MarkPath[] = [];
  for (const { centre, half } of blocks) {
    for (const { face, normal, corners } of faces) {
      const d =
        corners
          .map((c, i) => {
            const x = centre[0] + c[0] * half;
            const y = -(centre[1] + c[1] * half);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            return `${i ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`;
          })
          .join('') + 'Z';
      const ink: Ink = face.normal[1] === 1 ? 'top' : sideLight(normal) > 0.5 ? 'lit' : 'shade';
      paths.push({ ink, d });
    }
  }
  return { paths, box: [minX, minY, maxX - minX, maxY - minY] };
}
