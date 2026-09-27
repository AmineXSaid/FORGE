<template>
  <!--
    The Forge wordmark: the mark -- the voxel F with the cube seated in its
    crossbar niche -- then "orge" in Forge's own sans. One SVG in the official
    logo slot. That slot fixes its SVG at 120px; Forge's wordmark is set larger,
    so the SVG takes its own width and stays centred on the same axis as the
    mascot and tip below it.

    The viewBox matches the rendered size 1:1, so nothing is scaled: the letters
    render at their true size with the same rasterisation as the rest of the
    UI's text, and the F lands on whole device pixels. The F is sized first (see
    usePixelSnap); the text is sized so its cap height equals the F and set on
    the F's baseline.
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
    <g :transform="`translate(${markX} ${markY}) scale(${module})`">
      <g class="fg-wordmark__f" shape-rendering="crispEdges">
        <rect v-for="(r, i) in F_SOLID" :key="i" :x="r[0]" :y="r[1]" :width="r[2]" :height="r[3]" />
      </g>
      <path v-for="ink in INKS" :key="ink" :class="`fg-wordmark__cube--${ink}`" :d="facePath(F_CUBE[ink])" />
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
import { F_CUBE, F_MODULES, F_SOLID, facePath } from './forge/marks';

interface Props {
  class?: string;
}

const props = defineProps<Props>();

const INKS = ['top', 'lit', 'shade'] as const;

/** Tall enough for the capitals and the descender of "g". */
const HEIGHT = 40;
/** Clear space either side of the word, so antialiasing at its edges is never clipped. */
const MARGIN = 2;

/*
  Forge Sans semibold metrics, in em, measured from the bundled face:
  cap height, the left side bearing of "o", the advance of "orge", and the
  descender of "g".
*/
const CAP_HEIGHT = 0.72;
const O_BEARING = 0.0375;
const ORGE_ADVANCE = 2.157;
const DESCENDER = 0.25;

/**
 * Where the mark's ink nearest the "o" ends, in modules: the cube's right
 * edge (F_CUBE reaches 5.5; the top bar above it runs on to 6).
 */
const CUBE_END = 5.5;
/**
 * The ink gap from the cube to the "o", in em: the word's own gap between "o"
 * and "r", measured in the rendered webview at 1x to 2x. The "o" tucks just
 * under the F's top bar, as a kerned "Fo" does.
 */
const F_TO_O = 0.114;

const markSize = usePixelSnap(F_MODULES, () => 24);
const module = computed(() => markSize.value / F_MODULES);
const nameSize = computed(() => markSize.value / CAP_HEIGHT);

/** From the F's left edge to the first ink of the "o". */
const oInk = computed(() => CUBE_END * module.value + F_TO_O * nameSize.value);

const wordWidth = computed(() => oInk.value + (ORGE_ADVANCE - O_BEARING) * nameSize.value);
const below = computed(() => DESCENDER * nameSize.value);
const baseline = computed(() => (HEIGHT - (markSize.value + below.value)) / 2 + markSize.value);

const width = computed(() => Math.ceil(wordWidth.value + 2 * MARGIN));
const markX = computed(() => (width.value - wordWidth.value) / 2);
const markY = computed(() => baseline.value - markSize.value);
const nameX = computed(() => markX.value + oInk.value - O_BEARING * nameSize.value);
</script>

<style scoped>
/* The official logo slot fixes its SVG at 120px wide; the wordmark is sized by
   its own attributes instead (see the template note). */
.fg-wordmark {
  width: auto;
  height: auto;
}

.fg-wordmark__f {
  fill: var(--forge-mark-f);
}

.fg-wordmark__cube--top {
  fill: var(--forge-mark-cube-top);
}

.fg-wordmark__cube--lit {
  fill: var(--forge-mark-cube-lit);
}

.fg-wordmark__cube--shade {
  fill: var(--forge-mark-cube-shade);
}
</style>
