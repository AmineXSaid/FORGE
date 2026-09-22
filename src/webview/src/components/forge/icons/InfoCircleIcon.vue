<template>
  <!--
    The official `D21`, the glyph beside "Rewinding does not affect files edited
    manually or via bash." in the rewind confirm dialog. Copied by hand from the
    bundle (`index.js` @3607020): it is a heroicons-style wrapper built with a
    different element factory, which extract-icons.mjs does not parse -- the same
    limitation that hid ArchiveIcon in step 21.

    Attributes are the wrapper's own, unchanged: fill none, 24x24 viewBox,
    stroke-width 1.5, currentColor, aria-hidden, data-slot="icon".
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
      d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
    />
  </svg>
</template>
