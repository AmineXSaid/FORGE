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
import { computed, ref, watch } from 'vue';
import ForgeHammer from './forge/ForgeHammer.vue';
import { firstRunBypassed, isWindowsPlatform } from '../utils/firstRun';

interface Props {
  platform: string;
  /** The empty state hides the tip while an announcement card has the floor. */
  showMessage?: boolean;
}

const props = withDefaults(defineProps<Props>(), { showMessage: true });

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

const tip = ref<Part[]>(OPENING_TIP);

watch(
  [tips, firstRunBypassed],
  () => {
    tip.value = firstRunBypassed.value ? tips.value[Math.floor(Math.random() * tips.value.length)] : OPENING_TIP;
  },
  { immediate: true },
);
</script>
