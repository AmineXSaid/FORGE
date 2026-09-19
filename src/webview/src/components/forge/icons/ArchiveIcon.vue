<template>
  <!--
    Lifted from the real Claude Code webview: `H21 = k0(Ww0)`, the glyph the
    sessions list uses for "Archive session".

      function Ww0({title:$,titleId:J,...Z},Y){return p1("svg",Object.assign({
        xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",
        strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true",
        "data-slot":"icon",ref:Y,"aria-labelledby":J},Z),
        $?p1("title",{id:J},$):null,
        p1("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"m20.25 7.5…"}))}

    Written out by hand rather than by `extract-icons.mjs`, which only reads the
    inline-`<svg>` component form and finds no drawable children in this
    heroicons-style wrapper. Attributes and path data are copied verbatim; the
    size comes from `.fg-sessions__actionIcon` (20×20), as it does officially.
  -->
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke-width="1.5"
    stroke="currentColor"
    aria-hidden="true"
    data-slot="icon"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
    />
  </svg>
</template>
