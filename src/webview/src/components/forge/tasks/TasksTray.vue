<template>
  <!--
    Forge's background-tasks tray: the session's subagents, workflows and
    background commands, inside the chat, just above the composer. After the
    Claude desktop app's tasks pane (code.claude.com/docs/en/desktop: "click any
    entry to see its output ... or stop it"); the desktop's code is not
    available, so this is Forge's own design (forge-style), recorded in
    docs/forge-design.md. Agents keep the official surfaces too: the pill and
    the Agent map, which "Transcript" opens on that agent.

    Collapsed: one quiet line. Open: a card that grows upward over the
    transcript, its rows expanding in place.
  -->
  <section
    v-if="visible"
    class="fg-tray"
    :class="{ 'fg-tray--open': open }"
    aria-label="Background tasks"
    @keydown.esc.stop.prevent="open = false"
  >
    <div v-if="open" :id="listId" class="fg-tray__body">
      <template v-for="group in groups" :key="group.name">
        <div v-if="group.rows.length" class="fg-tray__group">{{ group.name }}</div>
        <div
          v-for="row in group.rows"
          :key="row.taskId"
          class="fg-tray__item"
          :class="{ 'fg-tray__item--expanded': expanded === row.taskId }"
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
                <span class="fg-tray__kind">{{ KIND_LABELS[row.kind] }}</span>
                <template v-if="lineOf(row) && expanded !== row.taskId"><span class="fg-tray__sep" aria-hidden="true">·</span>{{ lineOf(row) }}</template>
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
            <div class="fg-tray__facts">
              <span>{{ STATUS_LABELS[row.status] }}</span>
              <span v-if="row.usage && row.usage.totalTokens > 0">{{ formatTokens(row.usage.totalTokens) }} tokens</span>
              <span v-if="row.usage && row.usage.toolUses > 0">{{ row.usage.toolUses }} {{ row.usage.toolUses === 1 ? 'tool call' : 'tool calls' }}</span>
            </div>
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
 * Dismissing hides the finished list until a task this tray has not seen
 * starts. Nothing is deleted: the Agent map still has every agent.
 */
const dismissedIds = ref<ReadonlySet<string>>(new Set());
const visible = computed(() => rows.value.some((r) => !dismissedIds.value.has(r.taskId)));
function dismiss(): void {
  dismissedIds.value = new Set(rows.value.map((r) => r.taskId));
  open.value = false;
}
// Nothing left to show: fold back down, so the next task starts collapsed.
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
.fg-tray {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
  overflow: hidden;
  border: 1px solid var(--forge-hairline);
  border-radius: 12px;
  background: var(--forge-surface);
  color: var(--forge-text);
}

/* ---- the bar ------------------------------------------------------------ */
.fg-tray__bar {
  display: flex;
  align-items: center;
}
.fg-tray--open .fg-tray__bar {
  border-top: 1px solid var(--forge-hairline);
}
.fg-tray__summary {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
  height: 32px;
  padding: 0 12px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.fg-tray__summary:hover {
  background: var(--forge-surface-hover);
}
.fg-tray__dots {
  display: inline-flex;
  flex-shrink: 0;
  gap: 3px;
}
.fg-tray__headline {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fg-tray__totals {
  flex: 1;
  overflow: hidden;
  font-size: 11px;
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
.fg-tray--open .fg-tray__chevron {
  transform: rotate(180deg);
}
.fg-tray__dismiss {
  margin-right: 8px;
}

/* ---- the open card ------------------------------------------------------ */
.fg-tray__body {
  max-height: min(45vh, 360px);
  overflow-y: auto;
  padding: 4px 0;
}
.fg-tray__group {
  padding: 10px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--forge-text-muted);
}
.fg-tray__item {
  position: relative;
}
.fg-tray__item + .fg-tray__item {
  border-top: 1px solid var(--forge-hairline);
}
.fg-tray__item--expanded {
  background: var(--forge-surface-deep);
}
.fg-tray__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
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
  gap: 2px;
  min-width: 0;
}
.fg-tray__rowTitle {
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fg-tray__rowSub {
  overflow: hidden;
  font-size: 11px;
  color: var(--forge-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fg-tray__kind {
  font-weight: 600;
}
.fg-tray__sep {
  padding: 0 5px;
}
.fg-tray__time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
}

/* A running row's quiet sign of life: a short segment travelling its base. */
.fg-tray__progress {
  position: absolute;
  right: 12px;
  bottom: 0;
  left: 12px;
  height: 1px;
  overflow: hidden;
}
.fg-tray__progress > span {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 24%;
  background: var(--forge-text-muted);
  opacity: 0.5;
}
@media (prefers-reduced-motion: no-preference) {
  .fg-tray__progress > span {
    animation: fg-tray-travel 1.6s ease-in-out infinite;
  }
  .fg-tray--open .fg-tray__body {
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
    left: -24%;
  }
  to {
    left: 100%;
  }
}
@keyframes fg-tray-open {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.fg-tray__detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 12px 30px;
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
  gap: 4px 12px;
  font-size: 11px;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
}
.fg-tray__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fg-tray__spacer {
  flex: 1;
}
.fg-tray__button {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--forge-outline);
  border-radius: 8px;
  background: transparent;
  color: var(--forge-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.fg-tray__button:hover:not(:disabled) {
  background: var(--forge-surface-hover);
}
.fg-tray__button--danger {
  border-color: var(--forge-danger-border);
  color: var(--forge-danger);
}
.fg-tray__button--danger:hover:not(:disabled) {
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
