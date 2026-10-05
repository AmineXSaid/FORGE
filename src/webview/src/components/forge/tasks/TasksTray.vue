<template>
  <!--
    Forge's background-tasks card, nested inside the composer's frame at its
    top edge -- the way the Claude app nests a notice card inside its chat box.
    After the desktop app's tasks pane (subagents, workflows, background
    commands; open one, stop it). Forge's own design in the forge-style
    language (docs/forge-design.md).

    The card owns the summary: the activity line above the composer names only
    what the model itself is doing. Rows are one line each; finished work folds
    into a single line until asked for. Open, it shows at most four rows and
    scrolls the rest, so the chatbox stays a chatbox.

    Pointer clicks do not take focus (mousedown.prevent): a focused button
    inside the composer's fieldset would light the composer's typing ring.
    Keyboard focus is untouched.
  -->
  <section
    v-if="visible"
    class="fg-tray"
    :class="{ 'fg-tray--open': open }"
    aria-label="Background tasks"
    @mousedown.prevent
    @keydown.esc.stop.prevent="open = false"
  >
    <div class="fg-tray__head">
      <button
        type="button"
        class="fg-tray__summary"
        :aria-expanded="open"
        :aria-controls="listId"
        @click="open = !open"
      >
        <StatusDot :state="headDot" class="fg-tray__headDot" :class="{ 'fg-tray__breath': headDot === 'running' }" />
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
      <template v-for="row in shownRows" :key="row.taskId">
        <div
          class="fg-tray__item"
          :class="{ 'fg-tray__item--expanded': expanded === row.taskId }"
          :data-task-kind="row.kind"
          :data-task-status="row.status"
        >
          <button
            type="button"
            class="fg-tray__row"
            :aria-expanded="expanded === row.taskId"
            :title="`${KIND_LABELS[row.kind]}: ${row.title}`"
            @click="expanded = expanded === row.taskId ? null : row.taskId"
          >
            <span class="fg-tray__glyph" :class="{ 'fg-tray__breath': row.status === 'running' }" aria-hidden="true">
              <component :is="glyphOf(row.kind)" />
            </span>
            <span class="fg-tray__title">{{ row.title }}</span>
            <span class="fg-tray__line">
              <span v-if="statusWord(row)" class="fg-tray__state" :data-state="row.status">{{ statusWord(row) }}</span>
              <span v-if="lineOf(row)" class="fg-tray__activity">{{ lineOf(row) }}</span>
              <span v-if="elapsedOf(row)" class="fg-tray__time">{{ elapsedOf(row) }}</span>
            </span>
            <span class="fg-tray__slot" aria-hidden="true"><ChevronUpIcon class="fg-tray__rowChevron" /></span>
          </button>
          <button
            v-if="row.stoppable"
            type="button"
            class="fg-iconbutton__iconButton fg-iconbutton__iconButton16 fg-tray__stopX"
            :disabled="stopping.has(row.taskId)"
            :aria-label="`Stop ${row.title}`"
            :title="stopping.has(row.taskId) ? 'Stopping…' : 'Stop'"
            @click="stop(row.taskId)"
          >
            <CloseIcon />
          </button>

          <div v-if="expanded === row.taskId" class="fg-tray__detail">
            <!-- Only what the row line does not already say: an error, or a finished task's full summary. -->
            <p v-if="row.error" class="fg-tray__text fg-tray__text--failure">{{ row.error }}</p>
            <p v-else-if="!isLive(row.status) && row.activity" class="fg-tray__text">{{ row.activity }}</p>
            <p v-if="stopFailed === row.taskId" class="fg-tray__text fg-tray__text--failure">
              The task could not be stopped. It may have finished already.
            </p>
            <div class="fg-tray__facts">
              <span>{{ KIND_LABELS[row.kind] }}</span>
              <span>{{ STATUS_LABELS[row.status] }}</span>
              <span v-if="row.usage && row.usage.totalTokens > 0">{{ formatTokens(row.usage.totalTokens) }} tokens</span>
              <span v-if="row.usage && row.usage.toolUses > 0">{{ row.usage.toolUses }} {{ row.usage.toolUses === 1 ? 'tool call' : 'tool calls' }}</span>
            </div>
            <div v-if="(row.kind === 'agent' && row.agentKey) || (row.outputFile && !isLive(row.status))" class="fg-tray__actions">
              <button v-if="row.kind === 'agent' && row.agentKey" type="button" class="fg-tray__link" @click="emit('openAgent', row.agentKey)">
                Open transcript
              </button>
              <button v-if="row.outputFile && !isLive(row.status)" type="button" class="fg-tray__link" @click="context.fileOpener.open(row.outputFile)">
                Open output
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- Finished work folds into one line until asked for. -->
      <button
        v-if="finished.length > 0"
        type="button"
        class="fg-tray__finished"
        :aria-expanded="showFinished"
        @click="showFinished = !showFinished"
      >
        <span>{{ finishedLine }}</span>
        <ChevronUpIcon class="fg-tray__finishedChevron" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Component } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import StatusDot from '../StatusDot.vue';
import CloseIcon from '../icons/CloseIcon.vue';
import ChevronUpIcon from '../icons/ChevronUpIcon.vue';
import AgentsIcon from '../icons/AgentsIcon.vue';
import TerminalIcon from '../icons/TerminalIcon.vue';
import BoltIcon from '../icons/BoltIcon.vue';
import SignalIcon from '../icons/SignalIcon.vue';
import { agentsAwaitingPermission, formatDuration, formatTokens } from '../../../core/agentMap';
import {
  KIND_LABELS,
  STATUS_LABELS,
  isLive,
  paneRows,
  trayHeadline,
  type PaneRow,
  type TaskKind,
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
const showFinished = ref(false);
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
const finished = computed(() => rows.value.filter((r) => !isLive(r.status)));
const liveCount = computed(() => live.value.length);
/** With nothing running, the finished rows are the content: no fold. */
const shownRows = computed(() =>
  live.value.length === 0 || showFinished.value ? rows.value : live.value
);

const dismissedIds = ref<ReadonlySet<string>>(new Set());
const visible = computed(() => rows.value.some((r) => !dismissedIds.value.has(r.taskId)));
function dismiss(): void {
  dismissedIds.value = new Set(rows.value.map((r) => r.taskId));
  open.value = false;
}
watch(visible, (v) => {
  if (!v) open.value = false;
});

/** One dot for the card: waiting beats running beats how it ended. */
const headDot = computed(() => {
  if (live.value.some((r) => r.status === 'waiting')) return 'waiting' as const;
  if (live.value.length > 0) return 'running' as const;
  return rows.value.some((r) => r.status === 'failed') ? ('failed' as const) : ('idle' as const);
});

const headline = computed(() => trayHeadline(rows.value));

const totals = computed(() => {
  if (live.value.length === 0) return '';
  const tokens = live.value.reduce((n, r) => n + (r.usage?.totalTokens ?? 0), 0);
  const longest = Math.max(...live.value.map((r) => now.value - r.startTime));
  return [tokens > 0 ? `${formatTokens(tokens)} tokens` : '', longest >= 1000 ? formatDuration(longest) : '']
    .filter(Boolean)
    .join(' · ');
});

const finishedLine = computed(() => {
  const failed = finished.value.filter((r) => r.status === 'failed').length;
  const stopped = finished.value.filter((r) => r.status === 'stopped').length;
  const done = finished.value.length - failed - stopped;
  return [done && `${done} finished`, failed && `${failed} failed`, stopped && `${stopped} stopped`].filter(Boolean).join(' · ');
});

const GLYPHS: Record<TaskKind, Component> = {
  agent: AgentsIcon,
  workflow: BoltIcon,
  shell: TerminalIcon,
  mcp: SignalIcon,
  task: BoltIcon,
};
const glyphOf = (kind: TaskKind): Component => GLYPHS[kind];

/** Only states worth a word: running is said by the breathing glyph and the clock. */
function statusWord(row: PaneRow): string {
  switch (row.status) {
    case 'waiting':
      return 'Needs you';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    case 'paused':
      return 'Paused';
    default:
      return '';
  }
}

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
    expanded.value = taskId;
  });
}
</script>

<style scoped>
/*
  One tonal step into the composer (a tint of its own foreground, so the step
  is visible on any theme), inset 4px, radius concentric with the composer's
  8px, a hairline under it. No shadow.
*/
.fg-tray {
  container-type: inline-size;
  position: relative;
  z-index: 5;
  display: flex;
  flex-direction: column;
  margin: 4px 4px 0;
  overflow: hidden;
  border-radius: 6px;
  border-bottom: 1px solid var(--forge-hairline);
  background: var(--forge-surface-sunken-strong);
  color: var(--forge-text);
}

/* ---- the summary -------------------------------------------------------- */
.fg-tray__head {
  display: flex;
  align-items: center;
}
.fg-tray__summary {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 32px;
  padding: 0 10px 0 12px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.fg-tray__headDot {
  flex-shrink: 0;
}
.fg-tray__headline {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fg-tray__totals {
  overflow: hidden;
  font-size: 12px;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Narrow: the headline keeps its room; the totals go. */
@container (max-width: 440px) {
  .fg-tray__totals {
    display: none;
  }
}
.fg-tray__chevron {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-left: auto;
  color: var(--forge-text-muted);
  transition: transform 160ms ease-out, color 120ms ease-out;
}
.fg-tray__summary:hover .fg-tray__chevron {
  color: var(--forge-text);
}
.fg-tray--open .fg-tray__chevron {
  transform: rotate(180deg);
}
.fg-tray__dismiss {
  margin-right: 8px;
}

/* ---- the list: four rows, then it scrolls -------------------------------- */
.fg-tray__body {
  /* Four and a half rows: the half row says there is more. VS Code's host page
     sets scrollbar properties every element inherits, which overrides a styled
     bar, so the bar is hidden rather than left native. */
  max-height: 140px;
  overflow-y: auto;
  padding: 0 4px 4px;
  scrollbar-width: none;
}
.fg-tray__item {
  position: relative;
  border-radius: 4px;
}
.fg-tray__item--expanded {
  background: var(--forge-surface-hover);
}
.fg-tray__row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
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
.fg-tray__glyph {
  display: inline-flex;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: var(--forge-text-muted);
}
.fg-tray__glyph :deep(svg) {
  width: 16px;
  height: 16px;
}
/* The terminal glyph's paths take their fill from its official stylesheet. */
.fg-tray__glyph :deep(path:not([fill])) {
  fill: currentColor;
}
.fg-tray__item[data-task-status='running'] .fg-tray__glyph,
.fg-tray__item[data-task-status='waiting'] .fg-tray__glyph {
  color: var(--forge-text);
}
.fg-tray__title {
  flex-shrink: 1;
  max-width: 45%;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fg-tray__line {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
}
.fg-tray__state {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--forge-text-muted);
}
.fg-tray__state[data-state='waiting'] {
  color: var(--forge-warning);
}
.fg-tray__state[data-state='failed'] {
  color: var(--forge-danger);
}
.fg-tray__activity {
  overflow: hidden;
  color: var(--forge-text-muted);
  text-overflow: ellipsis;
}
.fg-tray__time {
  flex-shrink: 0;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
}
.fg-tray__activity + .fg-tray__time::before,
.fg-tray__state + .fg-tray__time::before {
  content: '·';
  padding-right: 6px;
}
.fg-tray__activity {
  flex-shrink: 1;
}
/* The row ends in one 16px slot: the expand chevron, which a stop (x) takes
   over while the pointer or the keyboard is on a stoppable row. */
.fg-tray__slot {
  display: inline-flex;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-left: auto;
}
.fg-tray__rowChevron {
  width: 16px;
  height: 16px;
  color: var(--forge-text-muted);
  opacity: 0.6;
  transform: rotate(90deg);
  transition: opacity 120ms ease-out, transform 160ms ease-out;
}
.fg-tray__row:hover .fg-tray__rowChevron,
.fg-tray__item--expanded .fg-tray__rowChevron {
  opacity: 1;
}
.fg-tray__item--expanded .fg-tray__rowChevron {
  transform: rotate(180deg);
}
.fg-tray__stopX {
  position: absolute;
  top: 7px;
  right: 8px;
  opacity: 0;
  pointer-events: none;
  background: transparent;
  color: var(--forge-text-muted);
  transition: opacity 120ms ease-out, color 120ms ease-out;
}
.fg-tray__item:hover .fg-tray__stopX,
.fg-tray__stopX:focus-visible,
.fg-tray__stopX:disabled {
  opacity: 1;
  pointer-events: auto;
}
.fg-tray__item:has(.fg-tray__stopX):hover .fg-tray__rowChevron {
  opacity: 0;
}
.fg-tray__stopX:hover:not(:disabled) {
  color: var(--forge-danger);
}

/* Running reads as a slow breath on the glyph and the card's dot. */
@media (prefers-reduced-motion: no-preference) {
  .fg-tray__breath {
    animation: fg-tray-breath 2.4s ease-in-out infinite;
  }
  .fg-tray__body {
    animation: fg-tray-open 160ms ease-out;
  }
}
@keyframes fg-tray-breath {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
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
  gap: 6px;
  padding: 0 8px 10px 32px;
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
  gap: 2px 12px;
  font-size: 11px;
  letter-spacing: -0.02em;
  color: var(--forge-text-muted);
  font-variant-numeric: tabular-nums;
}
.fg-tray__actions {
  display: flex;
  gap: 16px;
}
/* Inline links, persistently underlined, per the reference. */
.fg-tray__link {
  padding: 0;
  border: none;
  background: none;
  color: var(--forge-text);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  cursor: pointer;
}

/* ---- the fold for finished work ----------------------------------------- */
.fg-tray__finished {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 8px 0 32px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--forge-text-muted);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.fg-tray__finished:hover {
  color: var(--forge-text);
}
.fg-tray__finishedChevron {
  width: 14px;
  height: 14px;
  transform: rotate(180deg);
  transition: transform 160ms ease-out;
}
.fg-tray__finished[aria-expanded='true'] .fg-tray__finishedChevron {
  transform: none;
}

.fg-tray__summary:focus-visible,
.fg-tray__row:focus-visible,
.fg-tray__finished:focus-visible,
.fg-tray__link:focus-visible {
  outline: 1px solid var(--forge-focus-ring);
  outline-offset: -1px;
}
</style>
