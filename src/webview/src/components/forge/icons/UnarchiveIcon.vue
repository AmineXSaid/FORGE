<template>
  <!--
    Lifted from the real Claude Code webview: `B21 = k0(Pw0)`, the glyph the
    sessions list uses for "Unarchive session".

      function Pw0({title:$,titleId:J,...Z},Y){return p1("svg",Object.assign({
        xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",
        strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true",
        "data-slot":"icon",ref:Y,"aria-labelledby":J},Z),
        $?p1("title",{id:J},$):null,
        p1("path",{strokeLinecap:"round",strokeLinejoin:"round",
                   d:"M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"}))}

    Written out by hand rather than by `extract-icons.mjs` -- see ArchiveIcon.vue.
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
      d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
    />
  </svg>
</template>
