<template>
  <!--
    The Forge mascot: a war hammer drawn as a 16x16 item sprite, the way block-game
    tools are drawn, so its pixels are as chunky as the voxels of the cube and the F.
    Shown at 4px per pixel (snapped to whole device pixels), every pixel is visible.
    One path per ink, so the sprite is 14 elements rather than ~130 rects.
  -->
  <svg
    class="fg-hammer"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${CELLS} ${CELLS}`"
    shape-rendering="crispEdges"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path v-for="layer in LAYERS" :key="layer.ink" :d="layer.d" :fill="layer.fill" />
  </svg>
</template>

<script setup lang="ts">
import { usePixelSnap } from '../../composables/usePixelSnap';

interface Props {
  /** Target size in CSS px; snapped so every pixel is whole device pixels. */
  size?: number;
}

const props = withDefaults(defineProps<Props>(), { size: 64 });

/**
 * The sprite, one character per pixel, lit from the top left. `.` is empty.
 * Head inks run dark to light (O outline, 1-7); grip inks are letters
 * (K darkest to P brightest). The collar where the handle passes through the
 * head sits on the diagonal between the two lobes, which mirror each other.
 */
const ART = [
  '.......OOO......',
  '......O453O.....',
  '.....O4743OO....',
  '.....O6432O5O...',
  '.....O432O43OOO.',
  '.....O32O42O354O',
  '......OOO2O3753O',
  '.......PLO36432O',
  '......NJ.O4321O.',
  '.....PL...OOOO..',
  '....NJ..........',
  '...ML...........',
  '.OOK............',
  'O64O............',
  'O42O............',
  '.OO.............',
];

const INKS: Record<string, string> = {
  O: 'var(--forge-hammer-outline)',
  1: 'var(--forge-hammer-head-deep)',
  2: 'var(--forge-hammer-head-dark)',
  3: 'var(--forge-hammer-head)',
  4: 'var(--forge-hammer-head-bright)',
  5: 'var(--forge-hammer-head-light)',
  6: 'var(--forge-hammer-head-pale)',
  7: 'var(--forge-hammer-glint)',
  K: 'var(--forge-hammer-grip-outline)',
  J: 'var(--forge-hammer-grip-deep)',
  L: 'var(--forge-hammer-grip-dark)',
  M: 'var(--forge-hammer-grip)',
  N: 'var(--forge-hammer-grip-light)',
  P: 'var(--forge-hammer-grip-glint)',
};

const CELLS = ART.length;

/** Horizontal runs of each ink, merged into one path per ink. */
const LAYERS = Object.entries(INKS)
  .map(([ink, fill]) => {
    let d = '';
    ART.forEach((row, y) => {
      for (let x = 0; x < row.length; ) {
        if (row[x] !== ink) {
          x++;
          continue;
        }
        let end = x;
        while (end < row.length && row[end] === ink) end++;
        d += `M${x} ${y}h${end - x}v1h${x - end}z`;
        x = end;
      }
    });
    return { ink, fill, d };
  })
  .filter((layer) => layer.d);

const size = usePixelSnap(CELLS, () => props.size);
</script>

<style scoped>
.fg-hammer {
  display: block;
  flex-shrink: 0;
}
</style>
