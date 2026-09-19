<template>
  <!--
    NOT an official glyph. The official has no row button for unread at all: its
    "Mark as unread" / "Mark as read" is a text row in the row context menu
    (`mH0`), which also carries multi-select, groups and "Add to group" -- all
    out of Forge's scope. Forge's dropdown has no context menu, so by the user's
    decision the toggle became a row action beside Rename and Archive (step 22).

    Heroicons outline `envelope`, the same family, viewBox, stroke width and
    `data-slot` as the ported `ArchiveIcon` / `UnarchiveIcon`, so it sits in
    `.fg-sessions__actionIcon` (20x20) exactly as they do. One glyph for both
    directions: like the official's single menu row, only the title flips.
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
      d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
    />
  </svg>
</template>
