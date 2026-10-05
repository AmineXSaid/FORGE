<template>
  <!--
    The session's mark in the Agent map: a ring of twelve dots round a centre
    dot, after the Monad hub (docs/forge-design.md). While the session works
    the ring turns slowly and a brighter arc chases round it; idle, it rests,
    dimmed. Decorative: the row's text already says which state it is in.
  -->
  <svg
    class="fg-orbit"
    :class="{ 'fg-orbit--live': live }"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    aria-hidden="true"
  >
    <g class="fg-orbit__ring">
      <circle
        v-for="(dot, i) in DOTS"
        :key="i"
        class="fg-orbit__dot"
        :cx="dot.x"
        :cy="dot.y"
        r="0.95"
        :style="{ animationDelay: `${(i - DOTS.length) * (1.8 / DOTS.length)}s` }"
      />
    </g>
    <circle class="fg-orbit__core" cx="8" cy="8" r="1.1" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ live?: boolean; size?: number }>(), { live: false, size: 16 });

const COUNT = 12;
const DOTS = Array.from({ length: COUNT }, (_, i) => {
  const a = (i / COUNT) * Math.PI * 2 - Math.PI / 2;
  return { x: +(8 + 6.2 * Math.cos(a)).toFixed(3), y: +(8 + 6.2 * Math.sin(a)).toFixed(3) };
});
</script>

<style scoped>
.fg-orbit {
  flex-shrink: 0;
  display: block;
  color: var(--forge-text-muted);
}
.fg-orbit--live {
  color: var(--forge-running);
}
.fg-orbit__dot,
.fg-orbit__core {
  fill: currentColor;
}
.fg-orbit__dot {
  opacity: 0.55;
}
.fg-orbit--live .fg-orbit__dot {
  opacity: 0.25;
}
@media (prefers-reduced-motion: no-preference) {
  .fg-orbit--live .fg-orbit__ring {
    transform-origin: 8px 8px;
    animation: fg-orbit-turn 9s linear infinite;
  }
  /* A brighter arc chases round the ring: each dot brightens in turn. */
  .fg-orbit--live .fg-orbit__dot {
    animation: fg-orbit-chase 1.8s ease-out infinite;
  }
}
@keyframes fg-orbit-turn {
  to {
    transform: rotate(360deg);
  }
}
@keyframes fg-orbit-chase {
  0% {
    opacity: 1;
  }
  45%,
  100% {
    opacity: 0.22;
  }
}
</style>
