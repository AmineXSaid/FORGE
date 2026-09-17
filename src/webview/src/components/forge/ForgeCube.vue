<template>
  <!--
    The working indicator: raw graphite stock struck into a finished cube.

    One loop is four beats, each a 90-degree turn. Beat one holds the rough lump;
    beats two to four each land a strike that knocks chunks out of the block
    (they fly back in before the next blow) and brings it closer to true, until
    the last leaves a perfect cube. The cube holds, then roughens back into stock,
    and four quarter turns bring it round to where the loop began. It is never
    destroyed.

    Drawn on a canvas: 26 voxels with painter's ordering is far lighter than 150
    3D-transformed elements. The canvas cannot resolve CSS colour, so every ink
    is computed by CSS on a hidden probe and read back -- which also means the
    cube picks up the permission-mode tint the official spinner glyph takes.
  -->
  <span class="fg-cube" :style="{ width: `${props.size}px`, height: `${props.size}px` }" aria-hidden="true">
    <canvas ref="canvasEl" class="fg-cube__canvas" />
    <span ref="probesEl" class="fg-cube__probes">
      <span class="fg-cube__ink fg-cube__ink--top" />
      <span class="fg-cube__ink fg-cube__ink--lit" />
      <span class="fg-cube__ink fg-cube__ink--shade" />
      <span class="fg-cube__ink fg-cube__ink--stockTop" />
      <span class="fg-cube__ink fg-cube__ink--stockLit" />
      <span class="fg-cube__ink fg-cube__ink--stockShade" />
      <span class="fg-cube__ink fg-cube__ink--spark" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { FACES, REST_YAW, facesViewer, placeVoxels, sideLight, toView, type Vec3 } from './cube';

interface Props {
  /** Box size in CSS px. */
  size?: number;
}

const props = withDefaults(defineProps<Props>(), { size: 16 });

const canvasEl = ref<HTMLCanvasElement>();
const probesEl = ref<HTMLElement>();

/** Milliseconds per beat; four beats make one loop. */
const BEAT = 650;
/** Roughness once each beat's strike has landed: stock, one, two, three strikes. */
const ROUGH = [1, 0.55, 0.22, 0];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Where each knocked-out chunk flies, as a fraction of the box. */
const CHUNKS: ReadonlyArray<readonly [number, number]> = [
  [0.44, -0.38],
  [-0.46, 0.2],
  [0.3, 0.46],
  [-0.28, -0.46],
];

interface Frame {
  beat: number;
  yaw: number;
  rough: number;
  /** Impact: positive squashes the block, negative is the rebound. */
  squash: number;
  /** How far the chunks are out of the block, 0..1. */
  burst: number;
}

function frameAt(ms: number): Frame {
  const beat = Math.floor(ms / BEAT) % 4;
  const f = (ms % BEAT) / BEAT;
  const struck = beat > 0;
  return {
    beat,
    yaw: REST_YAW + (beat + easeInOut(clamp01((f - 0.12) / 0.34))) * (Math.PI / 2),
    rough: struck
      ? lerp(ROUGH[beat - 1], ROUGH[beat], easeOut(clamp01(f / 0.2)))
      : easeInOut(clamp01((f - 0.2) / 0.55)),
    squash: !struck || f >= 0.36 ? 0 : f < 0.14 ? Math.sin((f / 0.14) * Math.PI) : -0.3 * Math.sin(((f - 0.14) / 0.22) * Math.PI),
    burst: !struck ? 0 : f < 0.16 ? easeOut(f / 0.16) : f < 0.78 ? 1 - easeInOut((f - 0.16) / 0.62) : 0,
  };
}

/** A finished frame, for reduced motion. */
const RESTING: Frame = { beat: 3, yaw: REST_YAW, rough: 0, squash: 0, burst: 0 };

interface Inks {
  top: string;
  lit: string;
  shade: string;
  stockTop: string;
  stockLit: string;
  stockShade: string;
  spark: string;
}

/**
 * color-mix() serialises as `color(srgb r g b)`. Converted to hex digits so the
 * canvas takes it on any Chromium the host ships; other forms pass through.
 */
function toCanvasColor(css: string): string {
  const m = /color\(srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)/.exec(css);
  if (!m) return css;
  const hex = m
    .slice(1, 4)
    .map((v) => Math.round(clamp01(Number(v)) * 255).toString(16).padStart(2, '0'))
    .join('');
  return '#' + hex;
}

function readInks(): Inks | undefined {
  const probes = probesEl.value?.children;
  if (!probes || probes.length < 7) return undefined;
  const ink = (i: number) => toCanvasColor(getComputedStyle(probes[i]).color);
  return { top: ink(0), lit: ink(1), shade: ink(2), stockTop: ink(3), stockLit: ink(4), stockShade: ink(5), spark: ink(6) };
}

function fill(ctx: CanvasRenderingContext2D, color: string, alpha: number) {
  if (alpha <= 0.004) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = color;
  ctx.fill();
}

function draw(ctx: CanvasRenderingContext2D, px: number, frame: Frame, inks: Inks) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);

  const mid = px / 2;
  // The finished cube fills about four fifths of its box.
  const pitch = px * 0.168;
  const sx = 1 + 0.08 * frame.squash;
  const sy = 1 - 0.16 * frame.squash;
  const finish = 1 - frame.rough;
  // A hair of overlap closes the antialiasing seams between touching voxels.
  const overlap = 0.35;

  const faces = FACES.map((face) => ({
    face,
    normal: toView(face.normal, frame.yaw),
    corners: face.corners.map((c) => toView(c, frame.yaw)),
  })).filter((f) => facesViewer(f.normal));

  const voxels = placeVoxels(frame.rough, frame.yaw, pitch, overlap);

  /** One small cube: its visible faces, lit, blended from stock to finish. */
  const cube = (cx: number, cy: number, centre: Vec3, half: number, alpha: number, heat = 0) => {
    for (const { face, normal, corners } of faces) {
      ctx.beginPath();
      corners.forEach((c, i) => {
        const x = cx + (centre[0] + c[0] * half) * sx;
        const y = cy - (centre[1] + c[1] * half) * sy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      if (face.normal[1] === 1) {
        fill(ctx, inks.stockTop, alpha);
        fill(ctx, inks.top, alpha * finish);
      } else {
        const light = sideLight(normal);
        fill(ctx, inks.stockShade, alpha);
        fill(ctx, inks.stockLit, alpha * light);
        fill(ctx, inks.shade, alpha * finish);
        fill(ctx, inks.lit, alpha * light * finish);
      }
      // Sparks: a struck chunk glows hot, brightest on its lit faces.
      if (heat > 0) fill(ctx, inks.spark, alpha * heat * (face.normal[1] === 1 ? 0.9 : 0.35 + 0.55 * sideLight(normal)));
    }
  };

  for (const { centre, half } of voxels) cube(mid, mid, centre, half, 1);

  // Chunks burst from inside the block and are pulled back in: small voxels of
  // the same material, glowing like sparks as they fly and cooling on the way
  // back. Each strike throws a different three.
  if (frame.burst > 0) {
    const half = pitch * 0.2 * (0.6 + 0.4 * frame.burst);
    const alpha = clamp01(frame.burst * 2.5);
    for (const i of [frame.beat % 4, (frame.beat + 2) % 4, (frame.beat + 3) % 4]) {
      cube(mid + CHUNKS[i][0] * px * frame.burst, mid + CHUNKS[i][1] * px * frame.burst, [0, 0, 0], half, alpha, frame.burst);
    }
  }
  ctx.globalAlpha = 1;
}

let raf = 0;
let startedAt = 0;
let inks: Inks | undefined;
let inksReadAt = -Infinity;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function render(now: number) {
  const canvas = canvasEl.value;
  const ctx = canvas?.getContext('2d');
  // A miss on the frame the loop happens to start -- the ref or the inks not
  // resolved yet -- must not end the animation. Returning without asking for
  // another frame left the very first spinner of a session drawing nothing: a
  // 300x150 untouched canvas that never recovered. Keep asking until there is
  // something to draw on.
  if (!canvas || !ctx) {
    raf = requestAnimationFrame(render);
    return;
  }

  const px = Math.max(1, Math.round(props.size * (window.devicePixelRatio || 1)));
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  // Re-read the inks now and then: the permission mode can re-tint the spinner.
  if (!inks || now - inksReadAt > 500) {
    inks = readInks();
    inksReadAt = now;
  }
  if (!inks) {
    raf = requestAnimationFrame(render);
    return;
  }

  if (reducedMotion.matches) {
    draw(ctx, px, RESTING, inks);
    return;
  }
  if (!startedAt) startedAt = now;
  draw(ctx, px, frameAt(now - startedAt), inks);
  raf = requestAnimationFrame(render);
}

function start() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(render);
}

onMounted(() => {
  start();
  reducedMotion.addEventListener('change', start);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  reducedMotion.removeEventListener('change', start);
});
</script>

<style scoped>
.fg-cube {
  display: inline-block;
  position: relative;
  vertical-align: middle;
}

.fg-cube__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.fg-cube__probes {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
}

/* Finished faces: tints of the colour the cube is painted, lit from above. */
.fg-cube__ink--top {
  color: color-mix(in srgb, currentColor 52%, var(--forge-cube-light));
}

.fg-cube__ink--lit {
  color: color-mix(in srgb, currentColor 86%, var(--forge-cube-light));
}

.fg-cube__ink--shade {
  color: color-mix(in srgb, currentColor 68%, var(--forge-cube-dark));
}

/* Sparks off the anvil: the one warm hue in the cube. */
.fg-cube__ink--spark {
  color: var(--forge-cube-spark);
}

/* Raw stock: graphite, carrying just a trace of the finished colour. */
.fg-cube__ink--stockTop {
  color: color-mix(in srgb, color-mix(in srgb, var(--forge-cube-stock) 88%, currentColor) 70%, var(--forge-cube-light));
}

.fg-cube__ink--stockLit {
  color: color-mix(in srgb, var(--forge-cube-stock) 88%, currentColor);
}

.fg-cube__ink--stockShade {
  color: color-mix(in srgb, color-mix(in srgb, var(--forge-cube-stock) 88%, currentColor) 62%, var(--forge-cube-dark));
}
</style>
