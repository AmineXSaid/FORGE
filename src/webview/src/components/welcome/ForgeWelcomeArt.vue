<template>
  <!--
    The welcome artwork.

    An image, the way the official page does it: its login screen renders
    `<img src={assetUris["welcome-art"][dark|light]}>` inside the same
    `asciiArtContainer`, and ships two cuts of one drawing -- white ink for a
    dark panel, black ink for a light one, with the accent colour unchanged in
    both.

    Both cuts are rendered and CSS picks one, rather than reading the theme in
    JavaScript: VS Code swaps `vscode-light` on the body when the theme changes
    without reloading the webview, so a value read once at setup would be stale.
  -->
  <template v-if="art">
    <img class="fg-welcomeart fg-welcomeart--dark" :src="art.dark" :alt="ALT" draggable="false">
    <img class="fg-welcomeart fg-welcomeart--light" :src="art.light" :alt="ALT" draggable="false">
  </template>
</template>

<script setup lang="ts">
const ALT = 'A block-world figure swinging a hammer at the Forge cube';

/**
 * The URIs the host resolved. Absent when the bootstrap did not carry them --
 * the page still reads without art, and a broken-image glyph would be worse
 * than none.
 */
const art = (window as unknown as {
  FORGE_BOOTSTRAP?: { welcomeArt?: { light: string; dark: string } };
}).FORGE_BOOTSTRAP?.welcomeArt;
</script>

<style scoped>
.fg-welcomeart {
  display: block;
  width: 100%;
  height: auto;
  user-select: none;
}

/* Dark is the default, so a theme class Forge does not recognise still shows
   something legible on the dark panel Forge is designed against. */
.fg-welcomeart--light {
  display: none;
}

/* The whole selector inside `:global()`: Vue compiles `:global(body.x) .y` to
   `body.x` alone, which hid nothing and left light themes on the white-ink
   cut. The classes are Forge-only, so these rules need no scoping. */
:global(body.vscode-light .fg-welcomeart--dark),
:global(body.vscode-high-contrast-light .fg-welcomeart--dark) {
  display: none;
}

:global(body.vscode-light .fg-welcomeart--light),
:global(body.vscode-high-contrast-light .fg-welcomeart--light) {
  display: block;
}
</style>
