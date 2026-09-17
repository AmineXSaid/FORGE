<template>
  <!--
    The permission-mode glyph. Each variant is lifted verbatim from the real
    Claude Code bundle (see .claude/skills/ui-parity).

    The official ships two sizes of every mode glyph and they are NOT
    interchangeable: `iconV2` (drawn to fill the 20px box) is for the rows of the
    Modes menu, `iconV2Small` (drawn inside it, with more padding) is for the
    footer button. Using the menu glyph in the footer is what made the hand read
    as oversized next to its label.

    One dynamic root, not a v-if chain, so the caller's class and data-mode land
    on the <svg> itself. The official puts its glyph straight inside the footer
    button, and `.footerButton span` there styles the *label* (ellipsis,
    max-width 200px) -- a wrapper span around the icon would inherit that.
  -->
  <component :is="glyph" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ModeManualIcon from './icons/ModeManualIcon.vue';
import ModeEditIcon from './icons/ModeEditIcon.vue';
import ModePlanIcon from './icons/ModePlanIcon.vue';
import ModeBypassIcon from './icons/ModeBypassIcon.vue';
import ModeManualSmallIcon from './icons/ModeManualSmallIcon.vue';
import ModeEditSmallIcon from './icons/ModeEditSmallIcon.vue';
import ModePlanSmallIcon from './icons/ModePlanSmallIcon.vue';
import ModeAutoSmallIcon from './icons/ModeAutoSmallIcon.vue';
import ModeBypassSmallIcon from './icons/ModeBypassSmallIcon.vue';

const props = defineProps<{ mode: string; small?: boolean }>();

const glyph = computed(() => {
  if (props.small) {
    if (props.mode === 'default' || props.mode === 'dontAsk') return ModeManualSmallIcon;
    if (props.mode === 'acceptEdits') return ModeEditSmallIcon;
    if (props.mode === 'plan') return ModePlanSmallIcon;
    if (props.mode === 'auto') return ModeAutoSmallIcon;
    return ModeBypassSmallIcon;
  }
  if (props.mode === 'default' || props.mode === 'dontAsk') return ModeManualIcon;
  if (props.mode === 'acceptEdits') return ModeEditIcon;
  if (props.mode === 'plan') return ModePlanIcon;
  return ModeBypassIcon;
});
</script>
