<template>
  <!--
    Heroicons 24px outline "arrow-right", same idiom as `CheckIcon.vue`.

    It trails its label rather than leading it, because the action moves you
    past this page rather than acting on it: the mark points at where you end
    up. That is also why it is the one thing on the page that moves, nudging
    2px on hover.
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
    <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
  </svg>
</template>
