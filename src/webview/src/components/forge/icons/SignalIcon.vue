<template>
  <!--
    Heroicons 24px outline "signal", in the same idiom as `CheckIcon.vue`:
    stroke 1.5, `currentColor`, round caps. A drawn glyph from the library the
    official webview itself draws from, not a lookalike codicon and not a
    Unicode stand-in.

    Chosen for what a health check actually is: Forge calls out to every model
    and waits to hear back. Arcs radiating from a point say "reaching out and
    listening" in one mark; a heart or a stethoscope would say "medical", which
    is a metaphor about the word rather than about the work.
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
      d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
    />
  </svg>
</template>
