<template>
  <!--
    The Forge F. Sized to whole device pixels per module (see usePixelSnap), so
    the voxel edges stay sharp at every display scale.
  -->
  <svg
    class="fg-mark"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${F_MODULES} ${F_MODULES}`"
    shape-rendering="crispEdges"
    fill="currentColor"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect v-for="(r, i) in F_SOLID" :key="i" :x="r[0]" :y="r[1]" :width="r[2]" :height="r[3]" />
    <rect
      v-if="props.ghost"
      :x="F_GHOST[0]"
      :y="F_GHOST[1]"
      :width="F_GHOST[2]"
      :height="F_GHOST[3]"
      :opacity="F_GHOST_OPACITY"
    />
  </svg>
</template>

<script setup lang="ts">
import { usePixelSnap } from '../../composables/usePixelSnap';
import { F_GHOST, F_GHOST_OPACITY, F_MODULES, F_SOLID } from './marks';

interface Props {
  /** Target size in CSS px; snapped to whole device pixels per module. */
  size?: number;
  /** Draw the knocked-out crossbar module. Leave off at icon sizes. */
  ghost?: boolean;
}

const props = withDefaults(defineProps<Props>(), { size: 12, ghost: true });
const size = usePixelSnap(F_MODULES, () => props.size);
</script>

<style scoped>
.fg-mark {
  display: block;
  flex-shrink: 0;
  color: var(--forge-brand-strong);
}
</style>
