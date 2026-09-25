<template>
  <!--
    Heroicons 2.2.0 `16/solid/arrow-path`, copied from the npm package.

    The official model menu has no refresh control, so there is no glyph of its
    own to extract. The official webview's icons are Heroicons micro (16px
    solid, `data-slot="icon"`): its search-clear glyph (SearchClearIcon.vue) is
    byte-identical to Heroicons `16/solid/x-mark`. So the refresh comes from the
    same set, in the same size, rather than from a codicon.
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
      d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.241l-.84-.84v1.371a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.932.75.75 0 0 1 1.025-.273Z"
      clip-rule="evenodd"
    />
  </svg>
</template>
