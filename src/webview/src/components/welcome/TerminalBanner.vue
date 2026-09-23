<template>
  <!--
    The official terminal banner (reference `kq0`, module Z3DrKA): terminal glyph,
    a question with a link, and a close button. The official links to a setting that
    switches back to the terminal; Forge has no such setting, so its link opens Forge
    in a terminal directly. Dismissal is remembered, and shared: closing it on the
    welcome page closes it on the chat page too, since it is one offer.

    `command` is the welcome page's form of the same banner: the link is the
    command itself, a `$ forge` chip that opens a terminal running Forge. Same
    glyph, same question, same close, so the two surfaces read as one hint.
  -->
  <div v-if="visible" class="fg-banner__banner" :class="{ 'forge-banner--card': card }">
    <div class="fg-banner__content">
      <TerminalIcon class="fg-termicon__icon" :width="16" :height="16" />
      <label>
        Prefer the Terminal experience?
        <template v-if="command">
          Run
          <button
            type="button"
            class="forge-banner__command"
            title="Open a terminal running Forge"
            @click="openTerminal"
          >
            <span class="forge-banner__sigil" aria-hidden="true">$</span>forge
          </button>
        </template>
        <a v-else href="#" class="fg-banner__link" @click.prevent="openTerminal">Open Forge in Terminal.</a>
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

const props = withDefaults(
  defineProps<{
    /** Render the link as the `$ forge` command chip (the welcome page's form). */
    command?: boolean;
    /** Sit on a surface of its own, as a card, rather than bare on the page. */
    card?: boolean;
    /** Where the terminal opens; the official row passes none. */
    location?: 'bottom';
  }>(),
  { command: false, card: false, location: undefined },
);

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
    transport.openClaudeInTerminal(undefined, undefined, props.location),
  );
}
</script>

<style scoped>
/*
 * The welcome page's card: the same banner on a surface of its own. Forge-only
 * classes, so the ported `fg-banner__*` rules stay exactly as the official has
 * them and this only adds the ground, the edge and the command chip.
 */
.forge-banner--card {
  background: var(--forge-welcome-surface);
  border: 1px solid var(--forge-welcome-border);
  color: var(--forge-welcome-muted);
  box-shadow: 0 6px 18px -12px var(--forge-welcome-shadow);
}

.forge-banner--card label {
  color: var(--forge-welcome-muted);
}

.forge-banner__command {
  align-items: baseline;
  background: var(--forge-welcome-chip-bg);
  border: 1px solid var(--forge-welcome-chip-border);
  border-radius: var(--corner-radius-small);
  color: var(--forge-welcome-chip-fg);
  cursor: pointer;
  display: inline-flex;
  font-family: var(--app-monospace-font-family);
  font-size: 0.95em;
  gap: 0.45em;
  margin-left: 0.15em;
  padding: 0.05em 0.5em;
  transition:
    background-color 140ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 140ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.forge-banner__command:hover {
  background: color-mix(in srgb, var(--forge-welcome-brand) 22%, transparent);
  border-color: var(--forge-welcome-brand);
}

.forge-banner__command:active {
  transform: translateY(1px);
}

.forge-banner__command:focus-visible {
  outline: 2px solid var(--forge-welcome-ring);
  outline-offset: 2px;
}

/* The prompt is furniture, not something you type, so it recedes. */
.forge-banner__sigil {
  opacity: 0.55;
  user-select: none;
}

@media (prefers-reduced-motion: reduce) {
  .forge-banner__command {
    transition: none;
  }

  .forge-banner__command:active {
    transform: none;
  }
}
</style>
