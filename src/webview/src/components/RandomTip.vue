<template>
  <!-- The official opening tip: mascot above one line of advice. -->
  <div class="fg-tip__container">
    <ForgeHammer :size="64" />
    <div v-if="props.showMessage" class="fg-tip__messageContainer">
      <div class="fg-tip__message">
        <template v-for="(part, i) in tip" :key="i">
          <br v-if="part === BR">
          <div v-else-if="typeof part === 'object'" class="fg-tip__keyboardShortcut">
            <span v-for="key in part.keys" :key="key" class="fg-tip__key">{{ key }}</span>
          </div>
          <template v-else>{{ part }}</template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ForgeHammer from './forge/ForgeHammer.vue';
import { firstRunBypassed, isWindowsPlatform } from '../utils/firstRun';
import { pickDifferent, readLastTip, rememberTip } from '../utils/tipRotation';

interface Props {
  platform: string;
  /** The empty state hides the tip while an announcement card has the floor. */
  showMessage?: boolean;
  /**
   * This empty state was opened by New Conversation, so it gets a fresh tip even
   * before the first message has ever been sent. Without it the first-run rule
   * held the opening tip on every new conversation for as long as nothing had
   * been sent -- the line under the hammer "never changed".
   */
  rotate?: boolean;
}

const props = withDefaults(defineProps<Props>(), { showMessage: true, rotate: false });

/** A line break inside a tip. */
const BR = '\n';
type Part = string | { keys: string[] };

/** Shown until the first message is ever sent, as in the official build. */
const OPENING_TIP: Part[] = ['What to do first? Ask about this codebase or we can start writing code.'];

/**
 * The official tip list, verbatim and in its order -- including its repeated
 * /model tip -- voiced as Forge. The two memory-file tips name the file by what
 * it is rather than by its filename, so no other product's name reaches the UI.
 */
const tips = computed<Part[][]>(() => {
  const shortcut = [isWindowsPlatform(props.platform) ? 'Alt' : 'Option', 'K'];
  return [
    ['// TODO: Everything. Let’s start.'],
    ['Ready to code?', BR, "Let's write something worth deploying."],
    ['Type /model to pick the right tool for the job.'],
    ['Make a memory file for instructions Forge will read every single time.'],
    ['Tired of repeating yourself? Tell Forge to remember what you’ve told it in its memory file.'],
    ['Press', ' ', { keys: ['Shift', 'Tab'] }, ' ', 'to automatically approve code edits'],
    ['Highlight any text and press', ' ', { keys: shortcut }, ' ', 'to chat about it'],
    ['Use Forge in the terminal to configure MCP servers. They’ll work here, too!'],
    ['Use planning mode to talk through big changes before a commit. Press', ' ', { keys: ['Shift', 'Tab'] }, ' ', 'to cycle between modes.'],
    ['Type /model to pick the right tool for the job.'],
    ['You’ve come to the absolutely right place!'],
  ];
});

/**
 * What a new conversation draws from: the opening tip and the list above. The
 * key is the tip's words with its shortcut chips reduced to a placeholder, so
 * the Alt/Option difference between platforms does not make two tips of one.
 */
const pool = computed<Part[][]>(() => [OPENING_TIP, ...tips.value]);
const keyOf = (tip: Part[]) => tip.map((part) => (typeof part === 'string' ? part : '[keys]')).join('');

/**
 * Chosen once, when this empty state mounts; every new conversation mounts a
 * new one. An index rather than the tip itself, so a platform that arrives
 * after mount still renders the right shortcut.
 */
const index = (() => {
  if (!props.rotate && !firstRunBypassed.value) return 0;
  return pickDifferent(pool.value.map(keyOf), readLastTip());
})();
// Only a tip that is actually on screen counts as "just shown".
if (props.showMessage) rememberTip(keyOf(pool.value[index]));

const tip = computed<Part[]>(() => pool.value[index] ?? OPENING_TIP);
</script>
