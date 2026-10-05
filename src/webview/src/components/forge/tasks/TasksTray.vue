<template>
  <!--
    Forge's background-tasks card, nested inside the composer's frame at its
    top edge -- the way the Claude app nests a notice card inside its chat box.
    After the desktop app's tasks pane (subagents, workflows, background
    commands; open one, stop it). Forge's own design in the forge-style
    language: the Anthropic reference (flat tonal layers, hairlines, weighted
    text for labels, tabular figures, no shadow, accent only where you must
    act) in the Pajamas palette. Recorded in docs/forge-design.md.

    Closed: one line. Open: the list unfolds inside the composer, which grows
    upward from its anchor at the bottom of the chat.
  -->
  <section
    v-if="visible"
    class="fg-tray"
    :class="{ 'fg-tray--open': open }"
    aria-label="Background tasks"
    @keydown.esc.stop.prevent="open = false"
  >
    <div class="fg-tray__bar">
      <button
        type="button"
        class="fg-tray__summary"
        :aria-expanded="open"
        :aria-controls="listId"
        @click="open = !open"
      >
        <span class="fg-tray__dots" aria-hidden="true">
          <StatusDot v-for="(state, i) in dots" :key="i" :state="state" />
        </span>
        <span class="fg-tray__headline">{{ headline }}</span>
        <span v-if="totals" class="fg-tray__totals">{{ totals }}</span>
        <ChevronUpIcon class="fg-tray__chevron" />
      </button>
      <button
        v-if="liveCount === 0"
        type="button"
        class="fg-iconbutton__iconButton fg-iconbutton__iconButton16 fg-tray__dismiss"
        aria-label="Dismiss finished tasks"
        title="Dismiss"
        @click="dismiss"
      >
        <CloseIcon />
      </button>
    </div>

    <div v-if="open" :id="listId" class="fg-tray__body">
      <template v-for="group in groups" :key="group.name">
        <div v-if="group.rows.length" class="fg-tray__group">
          <span>{{ group.name }}</span>
          <span class="fg-tray__groupCount">{{ group.rows.length }}</span>
        </div>
        <div
          v-for="row in group.rows"
          :key="row.taskId"
          class="fg-tray__item"
          :class="{
            'fg-tray__item--expanded': expanded === row.taskId,
            'fg-tray__item--needsYou': row.status === 'waiting',
          }"
          :data-task-kind="row.kind"
          :data-task-status="row.status"
        >
          <button
            type="button"
            class="fg-tray__row"
            :aria-expanded="expanded === row.taskId"
            @click="expanded = expanded === row.taskId ? null : row.taskId"
          >
            <StatusDot :state="dotOf(row.status)" />
            <span class="fg-tray__rowText">
              <span class="fg-tray__rowTitle">{{ row.title }}</span>
              <span class="fg-tray__rowSub">
                <span class="fg-tray__kind">{{ row.status === 'waiting' ? 'Needs you' : KIND_LABELS[row.kind] }}</span>
                <template v-if="lineOf(row) && expanded !== row.taskId">
                  <span class="fg-tray__sep" aria-hidden="true">·</span>{{ lineOf(row) }}
                </template>
              </span>
            </span>
            <span class="fg-tray__time">{{ elapsedOf(row) }}</span>
          </button>
          <span v-if="isLive(row.status)" class="fg-tray__progress" aria-hidden="true"><span /></span>

          <div v-if="expanded === row.taskId" class="fg-tray__detail">
            <p v-if="row.error" class="fg-tray__text fg-tray__text--failure">{{ row.error }}</p>
            <p v-else-if="row.activity" class="fg-tray__text">{{ row.activity }}</p>
            <p v-if="stopFailed === row.taskId" class="fg-tray__text fg-tray__text--failure">
              The task could not be stopped. It may have finished already.
            </p>
            <dl class="fg-tray__facts">
              <div><dt>Status</dt><dd>{{ STATUS_LABELS[row.status] }}</dd></div>
              <div v-if="row.usage && row.usage.totalTokens > 0"><dt>Tokens</dt><dd>{{ formatTokens(row.usage.totalTokens) }}</dd></div>
              <div v-if="row.usage && row.usage.toolUses > 0"><dt>Tool calls</dt><dd>{{ row.usage.toolUses }}</dd></div>
              <div v-if="elapsedOf(row)"><dt>Time</dt><dd>{{ elapsedOf(row) }}</dd></div>
            </dl>
            <div class="fg-tray__actions">
              <button v-if="row.kind === 'agent' && row.agentKey" type="button" class="fg-tray__button" @click="emit('openAgent', row.agentKey)">
                Transcript
              </button>
              <button v-if="row.outputFile && !isLive(row.status)" type="button" class="fg-tray__button" @click="context.fileOpener.open(row.outputFile)">
                Output
              </button>
              <span class="fg-tray__spacer" />
              <button
                v-if="row.stoppable"
                type="button"
                class="fg-tray__button fg-tray__button--danger"
                :disabled="stopping.has(row.taskId)"
                @click="stop(row.taskId)"
              >{{ stopping.has(row.taskId) ? 'Stopping…' : 'Stop' }}</button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import StatusDot from '../StatusDot.vue';
import CloseIcon from '../icons/CloseIcon.vue';
import ChevronUpIcon from '../icons/ChevronUpIcon.vue';
import { agentsAwaitingPermission, formatDuration, formatTokens } from '../../../core/agentMap';
import {
  KIND_LABELS,
  STATUS_LABELS,
  dotOf,
  isLive,
  paneRows,
  trayHeadline,
  type PaneRow,
} from '../../../core/backgroundTasks';
import type { Session } from '../../../core/Session';
import type { ToolContext } from '../../../types/tool';

const props = defineProps<{ session: Session; context: ToolContext }>();
const emit = defineEmits<{ (e: 'openAgent', agentKey: string): void }>();

const agents = useSignal(props.session.agentMapAgents);
const running = useSignal(props.session.subagentTasks);
const others = useSignal(props.session.otherTasks);
const permissionRequests = useSignal(props.session.permissionRequests);

const listId = `fg-tray-${Math.random().toString(36).slice(2)}`;
const open = ref(false);
const expanded = ref<string | null>(null);
const stopping = ref(new Set<string>());
const stopFailed = ref<string | null>(null);

const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(tick));

const rows = computed(() =>
  paneRows(agents.value, agentsAwaitingPermission(permissionRequests.value), running.value, others.value)
);
const live = computed(() => rows.value.filter((r) => isLive(r.status)));
const liveCount = computed(() => live.value.length);
const groups = computed(() => [
  { name: 'Running', rows: live.value },
  { name: 'Finished', rows: rows.value.filter((r) => !isLive(r.status)) },
]);

/**
 * Dismissing hides the finished list until a task this card has not seen
 * starts. Nothing is deleted: the Agent map still has every agent.
 */
const dismissedIds = ref<ReadonlySet<string>>(new Set());
const visible = computed(() => rows.value.some((r) => !dismissedIds.value.has(r.taskId)));
function dismiss(): void {
  dismissedIds.value = new Set(rows.value.map((r) => r.taskId));
  open.value = false;
}
watch(visible, (v) => {
  if (!v) open.value = false;
});

/** Up to three dots, waiting first: a glance says whether anything needs you. */
const dots = computed(() => {
  const order = { waiting: 0, running: 1, failed: 2, idle: 3 } as const;
  const source = live.value.length > 0 ? live.value : rows.value;
  return source.map((r) => dotOf(r.status)).sort((a, b) => order[a] - order[b]).slice(0, 3);
});

const headline = computed(() => trayHeadline(rows.value));

/** Tokens and the longest running time, for the live work only. */
const totals = computed(() => {
  if (live.value.length === 0) return '';
  const tokens = live.value.reduce((n, r) => n + (r.usage?.totalTokens ?? 0), 0);
  const longest = Math.max(...live.value.map((r) => now.value - r.startTime));
  return [tokens > 0 ? `${formatTokens(tokens)} tokens` : '', longest >= 1000 ? formatDuration(longest) : '']
    .filter(Boolean)
    .join(' · ');
});

function lineOf(row: PaneRow): string {
  return row.error ?? row.activity ?? '';
}

function elapsedOf(row: PaneRow): string {
  const end = isLive(row.status) ? now.value : row.endTime ?? row.startTime;
  const ms = end - row.startTime;
  return ms >= 1000 ? formatDuration(ms) : '';
}

function stop(taskId: string): void {
  stopFailed.value = null;
  stopping.value = new Set(stopping.value).add(taskId);
  const done = () => {
    const next = new Set(stopping.value);
    next.delete(taskId);
    stopping.value = next;
  };
  props.session.stopSubagent(taskId).then(done, () => {
    done();
    stopFailed.value = taskId;
  });
}
</script>

<style scoped>
/*
  A card nested in the composer: one tonal step deeper than the composer
  (the reference's oat panel, Pajamas neutral), inset 4px with a radius
  concentric to the composer's 8px. No border of its own, no shadow.
*/
.fg-tray {
  position: relative;
  z-index: 5;
  display: flex;
  flex-direction: column;
  margin: 4px 4px 0;
  overflow: hidden;
  border-radius: 6px;
  background: var(--forge-surface-deep);
  color: var(--forge-text);
}

/* ---- the line ----------------------------------------------------------- */
.fg-tray__bar {
  display: flex;
  align-items: center;
}
.fg-tray__summary {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.fg-tray__dots {
  display: inline-flex;
  flex-shrink: 0;
  gap: 3px;
}
.fg-tray__headline {
  overflow: hidden;
  font-weight: 500;
  letter-spacing: -0.005em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fg-tray__totals {
  flex: 1;
  overflow: hidden;
  font-size: 11px;
  letter-spacing: -0.02em;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fg-tray__chevron {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-left: auto;
  color: var(--forge-text-muted);
  transition: transform 160ms ease-out;
}
.fg-tray__summary:hover .fg-tray__chevron {
  color: var(--forge-text);
}
.fg-tray--open .fg-tray__chevron {
  transform: rotate(180deg);
}
.fg-tray__dismiss {
  margin-right: 6px;
}

/* ---- the list ----------------------------------------------------------- */
.fg-tray__body {
  max-height: min(42vh, 340px);
  overflow-y: auto;
  border-top: 1px solid var(--forge-hairline);
  padding-bottom: 4px;
}
.fg-tray__group {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 10px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--forge-text-muted);
}
.fg-tray__groupCount {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.fg-tray__item {
  position: relative;
  margin: 0 4px;
  border-radius: 4px;
}
.fg-tray__item--expanded {
  background: var(--forge-surface);
}
/* The one row that needs you reads as featured, the reference's manilla. */
.fg-tray__item--needsYou {
  background: var(--forge-surface-feature);
}
.fg-tray__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.fg-tray__row:hover {
  background: var(--forge-surface-hover);
}
.fg-tray__rowText {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.fg-tray__rowTitle {
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fg-tray__rowSub {
  overflow: hidden;
  font-size: 11px;
  letter-spacing: -0.02em;
  line-height: 1.4;
  color: var(--forge-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* A badge is weighted text, not a box. */
.fg-tray__kind {
  font-weight: 600;
}
.fg-tray__item--needsYou .fg-tray__kind {
  color: var(--forge-warning);
}
.fg-tray__sep {
  padding: 0 5px;
}
.fg-tray__time {
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: -0.02em;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
}

/* A running row's sign of life: a short hairline segment crossing its base. */
.fg-tray__progress {
  position: absolute;
  right: 8px;
  bottom: 0;
  left: 26px;
  height: 1px;
  overflow: hidden;
}
.fg-tray__progress > span {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 20%;
  background: var(--forge-outline);
}
@media (prefers-reduced-motion: no-preference) {
  .fg-tray__progress > span {
    animation: fg-tray-travel 1.8s ease-in-out infinite;
  }
  .fg-tray__body {
    animation: fg-tray-open 180ms ease-out;
  }
}
@media (prefers-reduced-motion: reduce) {
  .fg-tray__progress {
    display: none;
  }
}
@keyframes fg-tray-travel {
  from {
    left: -20%;
  }
  to {
    left: 100%;
  }
}
@keyframes fg-tray-open {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* ---- a row, opened ------------------------------------------------------ */
.fg-tray__detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 8px 10px 26px;
}
.fg-tray__text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.fg-tray__text--failure {
  color: var(--forge-danger);
}
.fg-tray__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
}
.fg-tray__facts > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.fg-tray__facts dt {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--forge-text-muted);
}
.fg-tray__facts dd {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.fg-tray__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fg-tray__spacer {
  flex: 1;
}
/* Outlined, per the reference: hairline in the outline tone, rounded 12px. */
.fg-tray__button {
  height: 24px;
  padding: 0 12px;
  border: 1px solid var(--forge-outline);
  border-radius: 12px;
  background: transparent;
  color: var(--forge-text);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.fg-tray__button:hover:not(:disabled) {
  border-color: var(--forge-text-muted);
}
.fg-tray__button--danger {
  border-color: var(--forge-danger-border);
  color: var(--forge-danger);
}
.fg-tray__button--danger:hover:not(:disabled) {
  border-color: var(--forge-danger);
  background: var(--forge-danger-surface);
}
.fg-tray__button:disabled {
  cursor: default;
}
.fg-tray__summary:focus-visible,
.fg-tray__row:focus-visible,
.fg-tray__button:focus-visible {
  outline: 1px solid var(--forge-focus-ring);
  outline-offset: -1px;
}
</style>
