<template>
  <!--
    The official terminal banner (reference `kq0`, module Z3DrKA): terminal glyph,
    a question with a link, and a close button. The official links to a setting that
    switches back to the terminal; Forge has no such setting, so its link opens Forge
    in a terminal directly. Dismissal is remembered.

    The welcome page no longer carries it: its "Use the terminal" button makes the
    same offer (divergence #55 in docs/forge-design.md).
  -->
  <div v-if="visible" class="fg-banner__banner">
    <div class="fg-banner__content">
      <TerminalIcon class="fg-termicon__icon" :width="16" :height="16" />
      <label>
        Prefer the Terminal experience?
        <a href="#" class="fg-banner__link" @click.prevent="openTerminal">Open Forge in Terminal.</a>
      </label>
    </div>
    <button class="fg-banner__closeButton" aria-label="Close banner" @click="dismiss">
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import TerminalIcon from '../forge/icons/TerminalIcon.vue';
import { runHostAction, transport } from '../../core/runtimeTransport';

const STORAGE_KEY = 'forge-vscode-terminal-banner-dismissed';

function wasDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

const visible = ref(!wasDismissed());

function dismiss(): void {
  visible.value = false;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, 'true');
  } catch {
    // Without storage the banner simply returns next time.
  }
}

function openTerminal(): void {
  runHostAction('open Forge in the terminal', () =>
    transport.openClaudeInTerminal(undefined, undefined, undefined),
  );
}
</script>
