<template>
  <!--
    The focus-view fold row (the official `gq0` and `mq0`, reference module
    29QDkQ), element for element:

      div.focusFoldRow.timelineMessage.<dot>   role=button tabIndex=0 aria-expanded
        running  ? label.runningLabel  "Running Bash…"  + span  "3 tool calls"
                 : label               "3 tool calls"
        expanded ? ChevronUp : ChevronDown

    The collapse row at the bottom of an expanded fold is the same element with
    the label "Collapse", an `aria-label` naming what it collapses, and
    `aria-expanded` pinned true -- that is `mq0`.
  -->
  <div
    :class="`fg-focusfold__focusFoldRow fg-chat__timelineMessage ${dotClass}`"
    role="button"
    :tabindex="0"
    :aria-expanded="variant === 'end' ? true : isExpanded"
    :aria-label="variant === 'end' ? `Collapse ${label}` : undefined"
    :data-testid="variant === 'end' ? 'focus-fold-end-row' : 'focus-fold-row'"
    @click="onToggle"
    @keydown="onKeyDown"
  >
    <template v-if="variant === 'end'">
      <label>Collapse</label>
      <ChevronUpIcon />
    </template>
    <template v-else-if="runningLabel !== null">
      <label class="fg-focusfold__runningLabel">{{ runningLabel }}</label>
      <span v-if="fold.toolCallCount > 0">{{ label }}</span>
      <ChevronUpIcon v-if="isExpanded" />
      <ChevronDownIcon v-else />
    </template>
    <template v-else>
      <label>{{ label }}</label>
      <ChevronUpIcon v-if="isExpanded" />
      <ChevronDownIcon v-else />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ChevronDownIcon from './icons/ChevronDownIcon.vue';
import ChevronUpIcon from './icons/ChevronUpIcon.vue';
import { FOLD_DOT_CLASS, foldDotState, foldLabel, foldRunningLabel, type FocusFold } from '../../core/focusView';

interface Props {
  fold: FocusFold;
  /** `gq0` is the header, `mq0` the collapse row an expanded fold ends with. */
  variant?: 'header' | 'end';
  isExpanded?: boolean;
  /** `G5`: a permission prompt is waiting on a tool inside this fold. */
  permissionPending?: boolean;
  onToggle: () => void;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'header',
  isExpanded: false,
  permissionPending: false,
});

const label = computed(() => foldLabel(props.fold));
const runningLabel = computed(() => foldRunningLabel(props.fold, props.permissionPending));
const dotClass = computed(() => FOLD_DOT_CLASS[foldDotState(props.fold, props.permissionPending)]);

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    props.onToggle();
  }
}
</script>
