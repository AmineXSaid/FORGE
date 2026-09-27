<template>
  <!--
    The Forge mark: the voxel F with the cube in its crossbar niche. Sized to
    whole device pixels per module (see usePixelSnap), so the F's edges stay
    sharp at every display scale; the cube is antialiased like any drawing.
  -->
  <svg
    class="fg-mark"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${F_MODULES} ${F_MODULES}`"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g class="fg-mark__f" shape-rendering="crispEdges">
      <rect v-for="(r, i) in F_SOLID" :key="i" :x="r[0]" :y="r[1]" :width="r[2]" :height="r[3]" />
    </g>
    <path v-for="ink in INKS" :key="ink" :class="`fg-mark__cube--${ink}`" :d="facePath(F_CUBE[ink])" />
  </svg>
</template>

<script setup lang="ts">
import { usePixelSnap } from '../../composables/usePixelSnap';
import { F_CUBE, F_MODULES, F_SOLID, facePath } from './marks';

interface Props {
  /** Target size in CSS px; snapped to whole device pixels per module. */
  size?: number;
}

const INKS = ['top', 'lit', 'shade'] as const;

const props = withDefaults(defineProps<Props>(), { size: 12 });
const size = usePixelSnap(F_MODULES, () => props.size);
</script>

<style scoped>
.fg-mark {
  display: block;
  flex-shrink: 0;
}

.fg-mark__f {
  fill: var(--forge-mark-f);
}

.fg-mark__cube--top {
  fill: var(--forge-mark-cube-top);
}

.fg-mark__cube--lit {
  fill: var(--forge-mark-cube-lit);
}

.fg-mark__cube--shade {
  fill: var(--forge-mark-cube-shade);
}
</style>
