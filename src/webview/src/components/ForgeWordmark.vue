<template>
  <!--
    The Forge wordmark: the voxel cube as the mark, then the name, whose capital
    is the purple voxel F with "orge" following in Forge's own sans. One SVG in
    the official logo slot. That slot fixes its SVG at 120px; Forge's wordmark is
    set larger, so the SVG takes its own width and stays centred on the same axis
    as the mascot and tip below it.

    The viewBox matches the rendered size 1:1, so nothing is scaled:
    the letters render at their true size with the same rasterisation as the rest
    of the UI's text, and the F lands on whole device pixels. The F is sized first
    (see usePixelSnap); the text is sized so its cap height equals the F and set
    on the F's baseline, and the cube is centred on the cap height beside them.
  -->
  <svg
    class="fg-wordmark"
    :class="props.class"
    :width="width"
    :height="HEIGHT"
    :viewBox="`0 0 ${width} ${HEIGHT}`"
    fill="none"
    role="img"
    aria-label="Forge"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g class="fg-wordmark__cube" :transform="`translate(${cubeX} ${cubeY}) scale(${cubeScale})`">
      <path
        v-for="(p, i) in CUBE.paths"
        :key="i"
        :class="`fg-wordmark__cube--${p.ink}`"
        :transform="`translate(${-CUBE.box[0]} ${-CUBE.box[1]})`"
        :d="p.d"
      />
    </g>
    <g
      class="fg-wordmark__mark"
      :transform="`translate(${markX} ${markY}) scale(${module})`"
      shape-rendering="crispEdges"
      fill="currentColor"
    >
      <rect v-for="(r, i) in F_SOLID" :key="i" :x="r[0]" :y="r[1]" :width="r[2]" :height="r[3]" />
      <rect
        :x="F_GHOST[0]"
        :y="F_GHOST[1]"
        :width="F_GHOST[2]"
        :height="F_GHOST[3]"
        :opacity="F_GHOST_OPACITY"
      />
    </g>
    <text
      :x="nameX"
      :y="baseline"
      fill="var(--app-primary-foreground)"
      font-family="var(--forge-font-sans)"
      :font-size="nameSize"
      font-weight="600"
    >orge</text>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { usePixelSnap } from '../composables/usePixelSnap';
import { F_GHOST, F_GHOST_OPACITY, F_MODULES, F_SOLID } from './forge/marks';
import { markPaths } from './forge/cube';

interface Props {
  class?: string;
}

const props = defineProps<Props>();

/** Tall enough for the cube above the cap line and the descender of "g" below. */
const HEIGHT = 40;
/** Clear space either side of the word, so antialiasing at its edges is never clipped. */
const MARGIN = 2;

/*
  Forge Sans semibold metrics, in em, measured from the bundled face:
  cap height, the left side bearing of "o", the advance of "orge", and the
  descender of "g".
*/
const CAP_HEIGHT = 0.72;
const O_BEARING = 0.03;
const ORGE_ADVANCE = 2.157;
const DESCENDER = 0.25;

/**
 * Where "o" starts, in F modules: half a module past the crossbar, which tucks
 * it under the F's top bar the way a kerned "Fo" pair sits.
 */
const O_START = 5.5;
/** The cube stands a little taller than the capitals, as a mark beside a name does. */
const CUBE_TO_CAP = 1.35;
/** Space between the cube and the F, as a fraction of the cap height. */
const CUBE_GAP = 0.4;

/** The cube caught mid-forge: the voxels still show, but it is nearly true. */
const CUBE = markPaths(0.35);

const markSize = usePixelSnap(F_MODULES, () => 24);
const module = computed(() => markSize.value / F_MODULES);
const nameSize = computed(() => markSize.value / CAP_HEIGHT);

const cubeHeight = computed(() => markSize.value * CUBE_TO_CAP);
const cubeScale = computed(() => cubeHeight.value / CUBE.box[3]);
const cubeWidth = computed(() => CUBE.box[2] * cubeScale.value);
const gap = computed(() => markSize.value * CUBE_GAP);

const wordWidth = computed(
  () =>
    cubeWidth.value +
    gap.value +
    O_START * module.value +
    (ORGE_ADVANCE - O_BEARING) * nameSize.value,
);
const above = computed(() => Math.max(markSize.value, markSize.value / 2 + cubeHeight.value / 2));
const below = computed(() => DESCENDER * nameSize.value);
const baseline = computed(() => (HEIGHT - (above.value + below.value)) / 2 + above.value);

const width = computed(() => Math.ceil(wordWidth.value + 2 * MARGIN));
const cubeX = computed(() => (width.value - wordWidth.value) / 2);
const cubeY = computed(() => baseline.value - markSize.value / 2 - cubeHeight.value / 2);
const markX = computed(() => cubeX.value + cubeWidth.value + gap.value);
const markY = computed(() => baseline.value - markSize.value);
const nameX = computed(() => markX.value + O_START * module.value - O_BEARING * nameSize.value);
</script>

<style scoped>
/* The official logo slot fixes its SVG at 120px wide; the wordmark is sized by
   its own attributes instead (see the template note). */
.fg-wordmark {
  width: auto;
  height: auto;
}

.fg-wordmark__mark,
.fg-wordmark__cube {
  color: var(--forge-brand-strong);
}

.fg-wordmark__cube--top {
  fill: color-mix(in srgb, currentColor 52%, var(--forge-cube-light));
}

.fg-wordmark__cube--lit {
  fill: color-mix(in srgb, currentColor 86%, var(--forge-cube-light));
}

.fg-wordmark__cube--shade {
  fill: color-mix(in srgb, currentColor 68%, var(--forge-cube-dark));
}
</style>
