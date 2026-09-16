<template>
  <!--
    The permission-mode glyph. Each variant is lifted verbatim from the real
    Claude Code bundle (see .claude/skills/ui-parity).

    The official ships two sizes of every mode glyph and they are NOT
    interchangeable: `iconV2` (drawn to fill the 20px box) is for the rows of the
    Modes menu, `iconV2Small` (drawn inside it, with more padding) is for the
    footer button. Using the menu glyph in the footer is what made the hand read
    as oversized next to its label.
  -->
  <template v-if="small">
    <ModeManualSmallIcon v-if="mode === 'default' || mode === 'dontAsk'" />
    <ModeEditSmallIcon v-else-if="mode === 'acceptEdits'" />
    <ModePlanSmallIcon v-else-if="mode === 'plan'" />
    <ModeAutoSmallIcon v-else-if="mode === 'auto'" />
    <ModeBypassSmallIcon v-else />
  </template>
  <template v-else>
    <ModeManualIcon v-if="mode === 'default' || mode === 'dontAsk'" />
    <ModeEditIcon v-else-if="mode === 'acceptEdits'" />
    <ModePlanIcon v-else-if="mode === 'plan'" />
    <ModeBypassIcon v-else />
  </template>
</template>

<script setup lang="ts">
import ModeManualIcon from './icons/ModeManualIcon.vue';
import ModeEditIcon from './icons/ModeEditIcon.vue';
import ModePlanIcon from './icons/ModePlanIcon.vue';
import ModeBypassIcon from './icons/ModeBypassIcon.vue';
import ModeManualSmallIcon from './icons/ModeManualSmallIcon.vue';
import ModeEditSmallIcon from './icons/ModeEditSmallIcon.vue';
import ModePlanSmallIcon from './icons/ModePlanSmallIcon.vue';
import ModeAutoSmallIcon from './icons/ModeAutoSmallIcon.vue';
import ModeBypassSmallIcon from './icons/ModeBypassSmallIcon.vue';

defineProps<{ mode: string; small?: boolean }>();
</script>
