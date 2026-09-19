<template>
  <!--
    Lifted from the real Claude Code webview: `AF1 = k0(N75)`, the chevron on the
    sessions list's group headers ("Archived sessions"). It points right and the
    official rotates it 90° with `.groupChevronExpanded`, so the glyph itself is
    chevron-*right*, not chevron-down.

      function N75({title:$,titleId:J,...Z},Y){return p1("svg",Object.assign({
        xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 16 16",fill:"currentColor",
        "aria-hidden":"true","data-slot":"icon",ref:Y,"aria-labelledby":J},Z),
        $?p1("title",{id:J},$):null,
        p1("path",{fillRule:"evenodd",d:"M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 …",
                   clipRule:"evenodd"}))}

    Written out by hand rather than by `extract-icons.mjs` -- see ArchiveIcon.vue.
    The size comes from `.fg-sessions__groupChevron` (14×14), as it does officially.
  -->
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    data-slot="icon"
  >
    <path
      fill-rule="evenodd"
      d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
      clip-rule="evenodd"
    />
  </svg>
</template>
