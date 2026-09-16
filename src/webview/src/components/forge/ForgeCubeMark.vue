<template>
  <!--
    The Forge cube as a static mark: same geometry, angle and light as the
    animated ForgeCube. Finished (rough 0) it is three faces, for small places
    like the subagent badge; with some roughness it shows the voxels mid-forge.
  -->
  <svg
    class="fg-cubemark"
    :width="props.size"
    :height="props.size"
    :viewBox="viewBox"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path v-for="(p, i) in mark.paths" :key="i" :class="`fg-cubemark__${p.ink}`" :d="p.d" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { markPaths } from './cube';

interface Props {
  size?: number;
  /** 0 is the finished cube; higher shows the voxels of the raw stock. */
  rough?: number;
}

const props = withDefaults(defineProps<Props>(), { size: 12, rough: 0 });

const mark = computed(() => markPaths(props.rough));
const viewBox = computed(() => {
  const [x, y, w, h] = mark.value.box;
  const side = Math.max(w, h);
  return `${x - (side - w) / 2} ${y - (side - h) / 2} ${side} ${side}`;
});
</script>

<style scoped>
.fg-cubemark {
  display: block;
  flex-shrink: 0;
  color: var(--forge-brand);
}

.fg-cubemark__top {
  fill: color-mix(in srgb, currentColor 52%, var(--forge-cube-light));
}

.fg-cubemark__lit {
  fill: color-mix(in srgb, currentColor 86%, var(--forge-cube-light));
}

.fg-cubemark__shade {
  fill: color-mix(in srgb, currentColor 68%, var(--forge-cube-dark));
}
</style>
