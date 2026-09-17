<template>
  <!--
    New conversation: a rounded square with a pencil, drawn to the reference image
    supplied for Forge's header. Stroked in currentColor, padded inside the 20px
    icon-button box so its weight matches the history glyph beside it.
  -->
  <svg
    width="20"
    height="20"
    viewBox="-2 -2 28 28"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    style="display: block"
    aria-hidden="true"
  >
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
  </svg>
</template>
