<template>
  <!--
    The official `vG`, one span and nothing else:

      function vG({state:$,ring:J=!1,title:Z,className:Y}){
        return F("span",{className:`${IK.statusDot} ${v55[$]}${J?` ${IK.statusDotElsewhere}`:""}${Y?` ${Y}`:""}`,
                         "data-status-dot":$, title:Z}) }

    `data-status-dot` is the official's own attribute, so the probes and the
    oracle can read the state off the DOM without guessing from classes.
  -->
  <span
    class="fg-statusdot__statusDot"
    :class="[stateClass, ring ? 'fg-statusdot__statusDotElsewhere' : '']"
    :data-status-dot="state"
    :title="title"
  ></span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SessionOpenState } from '../../core/sessionStates';

const props = withDefaults(
  defineProps<{
    state: SessionOpenState;
    /** The official `ring`: drawn as an outline when the session is live elsewhere. */
    ring?: boolean;
    title?: string;
  }>(),
  { ring: false, title: undefined }
);

/** `v55`: state -> modifier class. */
const STATE_CLASS: Record<SessionOpenState, string> = {
  running: 'fg-statusdot__statusDotRunning',
  waiting: 'fg-statusdot__statusDotWaiting',
  idle: 'fg-statusdot__statusDotIdle',
  unread: 'fg-statusdot__statusDotUnread',
  failed: 'fg-statusdot__statusDotFailed',
};

const stateClass = computed(() => STATE_CLASS[props.state] ?? '');
</script>
