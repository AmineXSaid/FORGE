<template>
  <!--
    Forge's send glyph (the user's request, 2026-09-19; the official is a thin
    arrow): a forged arrowhead rising off the anvil, with three sparks at its
    foot. On hover the arrow lifts and the sparks flare (styles/forge-design.css).
    Keeps the official `sendIcon` class, so its size and colour rules still apply.
  -->
  <svg class="fg-footer__sendIcon forge-send-glyph" viewBox="0 0 20 20" aria-hidden="true">
    <path
      class="forge-send-arrow"
      d="M10 3.1 14.7 8.9 11 7.8V14.4H9V7.8L5.3 8.9Z"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="1"
      stroke-linejoin="round"
    />
    <g class="forge-send-sparks" stroke="currentColor" stroke-linecap="round" stroke-width="1.3" fill="none">
      <path class="forge-spark forge-spark--left" d="M7.3 16.5 6.2 17.7" />
      <path class="forge-spark forge-spark--mid" d="M10 17v1.5" />
      <path class="forge-spark forge-spark--right" d="M12.7 16.5 13.8 17.7" />
    </g>
  </svg>
</template>
