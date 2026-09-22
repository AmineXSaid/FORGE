<template>
  <!--
    The official assistant message (`u85`): a timeline row whose dot carries the
    status of its first tool use (`p85`) -- dotSuccess, dotFailure, or dotProgress
    while the session is still busy. A message without a tool use gets no status
    class and keeps the base grey dot.

      div.message.timelineMessage.<dot>.[highlightedMessage]  (data-transcript-message)
        <content block>...

    The official also mounts a thumbs up / down rating row under text replies,
    behind an experiment gate and a rating endpoint Forge does not have, so it is
    not rendered here.
  -->
  <div
    data-testid="assistant-message"
    data-transcript-message=""
    :class="`fg-chat__message fg-chat__timelineMessage ${dotClass} ${highlighted ? 'fg-chat__highlightedMessage' : ''}`"
  >
    <template v-if="typeof message.message.content === 'string'">
      <ContentBlock :block="{ type: 'text', text: message.message.content }" :context="context" />
    </template>
    <template v-else>
      <ContentBlock
        v-for="wrapper in message.message.content"
        :key="wrapper.id"
        :block="wrapper.content"
        :wrapper="wrapper"
        :context="context"
      />
    </template>

    <!--
      Forge divergence #7 (docs/forge-design.md): the claim-check badge.

      Shown only on the final message of a finished turn, and only when
      something it claimed has no matching tool call. A badge on every message
      would be decoration; one that appears when the report and the work
      disagree is information.

      Placed inside the message row so the timeline rail's sibling rules
      (.timelineMessage + .timelineMessage) are untouched.
    -->
    <div v-if="claims" class="forge-claims" role="note" :title="claimsTooltip">
      <svg class="forge-claims__glyph" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.2" />
        <path d="M6 3.4v3.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        <circle cx="6" cy="8.3" r="0.6" fill="currentColor" />
      </svg>
      <span class="forge-claims__label">{{ claims.label }}</span>
      <span class="forge-claims__detail">{{ claimsDetail }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { effect } from 'alien-signals';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import { messageStatus, statusDotClass, type MessageStatus } from '../../utils/messageStatus';
import type { ClaimSummary } from '../../core/claimCheck';
import ContentBlock from './ContentBlock.vue';

interface Props {
  message: Message;
  context: ToolContext;
  /** The session's busy flag: a tool use without a result is in progress only while busy. */
  busy?: boolean;
  /** The row whose tool call is waiting on the permission prompt (official `S85`). */
  highlighted?: boolean;
  /** A4's claim summary. Present only when a claim went unverified. */
  claims?: ClaimSummary;
}

const props = withDefaults(defineProps<Props>(), { busy: false, highlighted: false });

// The tool results are signals, so re-run p85 whenever one lands (and when busy changes).
const status = ref<MessageStatus>(null);
watchEffect((onCleanup) => {
  const message = props.message;
  const busy = props.busy;
  onCleanup(
    effect(() => {
      status.value = messageStatus(message, busy);
    })
  );
});

const dotClass = computed(() => statusDotClass(status.value));

/** What went unverified, named rather than merely counted. */
const unverified = computed(() =>
  (props.claims?.verdicts ?? []).filter((v) => !v.verified)
);

const claimsDetail = computed(() => {
  const missing = unverified.value;
  if (!missing.length) return '';
  const names = missing.map((v) => v.claim.target ?? 'tests');
  // Two names fit on the row; beyond that the tooltip carries the rest, since
  // a badge that wraps to three lines stops reading as a badge.
  return names.length <= 2
    ? `— no tool call for ${names.join(' or ')}`
    : `— no tool call for ${names[0]} and ${names.length - 1} more`;
});

const claimsTooltip = computed(() =>
  unverified.value
    .map((v) => `No matching tool call: ${v.claim.target ?? 'tests were not run'}`)
    .join('\n')
);
</script>
