<template>
  <!--
    `/btw`: a side question, answered from this conversation's context without
    adding to it. What it holds and how it asks follow the official panel
    (index.js `X25`: header, thread, "Answering…", a two-row input; Enter sends,
    Esc hides). Where it lives is Forge's: a floating card -- drag it by its
    header, "–" folds it to a pill, × closes it -- in the Monad register
    (docs/forge-design.md): hairlines, a soft wash, mono small caps, no fills
    on hover, one inverted pill for the one action.
  -->
  <Teleport to="body">
    <Transition name="fg-btw">
      <section
        v-if="state.visible"
        ref="cardEl"
        class="fg-btw"
        :class="{ 'fg-btw--min': state.minimized, 'fg-btw--dragging': dragging }"
        :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
        role="dialog"
        aria-modal="false"
        :aria-label="SIDE_COPY.title"
        @keydown.esc.stop.prevent="hide"
      >
        <header
          class="fg-btw__head"
          title="Drag to move · double-click to put it back"
          @pointerdown="startDrag"
          @pointermove="moveDrag"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @dblclick="goHome"
        >
          <OrbitMark :live="!!state.pending" :size="14" />
          <span class="fg-btw__title">{{ SIDE_COPY.title }}</span>
          <span v-if="state.minimized && state.pending" class="fg-btw__status fg-live__shimmer">{{ SIDE_COPY.pending }}</span>
          <span v-else-if="state.minimized && answered > 0" class="fg-btw__status">{{ answered }} {{ answered === 1 ? 'answer' : 'answers' }}</span>
          <span class="fg-btw__spacer"></span>
          <button
            v-if="!state.minimized"
            type="button"
            class="fg-btw__icon"
            :disabled="empty"
            :aria-label="SIDE_COPY.clear"
            :title="SIDE_COPY.clear"
            @click="clear"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5" /></svg>
          </button>
          <button
            type="button"
            class="fg-btw__icon"
            :aria-label="state.minimized ? 'Expand side question' : 'Minimise side question'"
            :title="state.minimized ? 'Expand' : 'Minimise'"
            :aria-expanded="!state.minimized"
            @click="toggleMin"
          >
            <svg v-if="state.minimized" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
            <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg>
          </button>
          <button type="button" class="fg-btw__icon" aria-label="Close side question" title="Close (Esc)" @click="hide">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
          </button>
        </header>

        <template v-if="!state.minimized">
          <div ref="threadEl" class="fg-btw__thread" aria-live="polite">
            <p v-if="empty" class="fg-btw__empty">{{ SIDE_COPY.empty }}</p>
            <article v-for="entry in state.thread" :key="entry.id" class="fg-btw__exchange">
              <p class="fg-btw__question" :title="entry.item.question">{{ entry.item.question }}</p>
              <div v-if="entry.item.kind === 'answer'" class="fg-btw__answer">
                <p v-if="entry.item.fallbackNotice" class="fg-btw__note">⚠ {{ entry.item.fallbackNotice }}</p>
                <TextBlock :block="{ type: 'text', text: entry.item.response }" :context="context" />
              </div>
              <p v-else class="fg-btw__note" :data-kind="entry.item.kind">{{ noteOf(entry.item) }}</p>
            </article>
            <article v-if="state.pending" class="fg-btw__exchange">
              <p class="fg-btw__question" :title="state.pending.question">{{ state.pending.question }}</p>
              <p class="fg-btw__note fg-btw__pending">
                <span class="fg-btw__glyph" aria-hidden="true">✻</span>
                <span class="fg-live__shimmer">{{ SIDE_COPY.pending }}</span>
              </p>
            </article>
          </div>

          <form class="fg-btw__input" @submit.prevent="send">
            <textarea
              ref="inputEl"
              v-model="draft"
              rows="2"
              :placeholder="SIDE_COPY.placeholder"
              :aria-label="SIDE_COPY.placeholder"
              @keydown="onKey"
            ></textarea>
            <button
              type="submit"
              class="fg-btw__send"
              :disabled="!draft.trim()"
              :aria-label="SIDE_COPY.send"
              :title="SIDE_COPY.send"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" /></svg>
            </button>
          </form>
        </template>
      </section>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import OrbitMark from '../agentmap/OrbitMark.vue';
import TextBlock from '../../Messages/blocks/TextBlock.vue';
import { SIDE_COPY, type SideItem } from '../../../core/sideQuestions';
import { DRAG_SLOP, STORAGE_KEY, clampPosition, homePosition, keepBottom, readSaved, type Point } from './sideChatPlacement';
import type { Session } from '../../../core/Session';
import type { ToolContext } from '../../../types/tool';

const props = defineProps<{
  session: Session;
  context: ToolContext;
  /** The composer's height: the fallback for where its top edge is. */
  composerHeight: number;
}>();

const state = useSignal(props.session.sideQuestions);
const draft = ref('');
const cardEl = ref<HTMLElement | null>(null);
const threadEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);

const empty = computed(() => state.value.thread.length === 0 && !state.value.pending);
const answered = computed(() => state.value.thread.filter((t) => t.item.kind === 'answer').length);

function noteOf(item: SideItem): string {
  switch (item.kind) {
    case 'synthetic': return item.notice;
    case 'no-answer': return SIDE_COPY.noAnswer;
    case 'error': return SIDE_COPY.failed(item.message);
    case 'cancelled': return SIDE_COPY.cancelled;
    default: return '';
  }
}

// ---- asking ---------------------------------------------------------------

function send(): void {
  const question = draft.value.trim();
  if (!question) return;
  draft.value = '';
  void props.session.askSideQuestion(question);
}

/** The official `oG0`: Enter sends; Shift+Enter, and an IME mid-word, do not. */
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

function clear(): void {
  props.session.clearSideQuestions();
  inputEl.value?.focus();
}

function hide(): void {
  props.session.hideSideQuestions();
}

function toggleMin(): void {
  props.session.toggleSideMinimized();
}

// ---- placement and dragging ----------------------------------------------

const view = () => ({ width: window.innerWidth, height: window.innerHeight });
const cardSize = () => {
  const r = cardEl.value?.getBoundingClientRect();
  return { width: r?.width ?? 360, height: r?.height ?? 300 };
};

function loadSaved(): Point | undefined {
  try {
    return readSaved(localStorage.getItem(STORAGE_KEY));
  } catch {
    return undefined;
  }
}
function save(p: Point): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* per-viewer convenience only */
  }
}
function forget(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* per-viewer convenience only */
  }
}

const pos = ref<Point>({ x: -9999, y: -9999 });

/** Measure, then place: the remembered spot, else home -- always on screen. */
async function place(): Promise<void> {
  await nextTick();
  const saved = loadSaved();
  pos.value = saved
    ? clampPosition(saved, cardSize(), view())
    : homePosition(cardSize(), view(), composerTop());
}

/** The composer's real top edge (its outer margin included), measured. */
function composerTop(): number {
  const top = document.querySelector('.fg-composer__inputContainer')?.getBoundingClientRect().top;
  return typeof top === 'number' && top > 0 ? top : window.innerHeight - props.composerHeight;
}

function goHome(event: MouseEvent): void {
  if ((event.target as Element).closest('button')) return;
  forget();
  pos.value = homePosition(cardSize(), view(), composerTop());
}

let drag: { pointerId: number; startX: number; startY: number; from: Point; moved: boolean } | null = null;
const dragging = ref(false);

function startDrag(event: PointerEvent): void {
  if (event.button !== 0 || (event.target as Element).closest('button')) return;
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
  drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: { ...pos.value }, moved: false };
}

function moveDrag(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
  drag.moved = true;
  dragging.value = true;
  pos.value = clampPosition({ x: drag.from.x + dx, y: drag.from.y + dy }, cardSize(), view());
}

function endDrag(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.moved) save(pos.value);
  drag = null;
  dragging.value = false;
}

/**
 * Anchored by its bottom edge: an answer arriving, folding or unfolding
 * grows or shrinks the card upward, and it never runs off screen.
 */
let lastHeight = 0;
const sizeWatch = new ResizeObserver(() => {
  const size = cardSize();
  if (lastHeight > 0 && size.height !== lastHeight && !dragging.value) {
    pos.value = keepBottom(pos.value, lastHeight, size, view());
  }
  lastHeight = size.height;
});
watch(cardEl, (el, old) => {
  if (old) sizeWatch.unobserve(old);
  lastHeight = 0;
  if (el) sizeWatch.observe(el);
});
onBeforeUnmount(() => sizeWatch.disconnect());

watch(
  () => state.value.visible,
  (visible) => {
    if (visible) void place();
  },
  { immediate: true },
);

function onResize(): void {
  if (state.value.visible) pos.value = clampPosition(pos.value, cardSize(), view());
}
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

// ---- focus and the thread's scroll ---------------------------------------

/** The official `sG0`: a one-shot request to focus the input. */
watch(
  () => state.value.focusRequested,
  async (requested) => {
    if (!requested) return;
    await nextTick();
    if (props.session.consumeSideFocus()) inputEl.value?.focus();
  },
  { immediate: true },
);

watch(
  () => [state.value.thread.length, state.value.pending, state.value.minimized],
  async () => {
    await nextTick();
    const el = threadEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<style scoped>
.fg-btw {
  position: fixed;
  z-index: 900;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(360px, calc(100vw - 16px));
  max-height: min(460px, calc(100vh - 16px));
  color: var(--app-primary-foreground);
  font-size: 13px;
  background-color: var(--app-primary-background);
  /* Monad's atmospheric wash: sky over mint, diffused, never a fill. */
  background-image:
    radial-gradient(110% 55% at 0% 0%, color-mix(in srgb, var(--forge-diagram-1) 11%, transparent), transparent 62%),
    radial-gradient(80% 45% at 100% 0%, color-mix(in srgb, var(--forge-diagram-2) 7%, transparent), transparent 60%);
  border: 1px solid color-mix(in srgb, var(--app-primary-foreground) 16%, transparent);
  border-radius: 16px;
  /* Monad's one elevation: a soft ambient, no drop. */
  box-shadow: 0 0 10px var(--vscode-widget-shadow, transparent);
  overflow: hidden;
}
.fg-btw--min {
  width: auto;
  max-width: calc(100vw - 16px);
  border-radius: 9999px;
}
.fg-btw--dragging {
  user-select: none;
}

/* ---- header: the drag handle ---- */
.fg-btw__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--app-primary-foreground) 10%, transparent);
  cursor: grab;
  touch-action: none;
}
.fg-btw--dragging .fg-btw__head {
  cursor: grabbing;
}
.fg-btw--min .fg-btw__head {
  border-bottom: 0;
  padding-right: 4px;
}
.fg-btw__title,
.fg-btw__status {
  font-family: var(--app-monospace-font-family);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}
.fg-btw__title {
  font-weight: 500;
  color: var(--app-primary-foreground);
}
.fg-btw__status {
  color: var(--forge-text-muted);
}
.fg-btw__spacer {
  flex: 1 1 auto;
  min-width: 8px;
}
.fg-btw__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--forge-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 9999px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.fg-btw__icon:hover:not(:disabled) {
  color: var(--app-primary-foreground);
  border-color: color-mix(in srgb, var(--app-primary-foreground) 22%, transparent);
}
.fg-btw__icon:focus-visible,
.fg-btw__send:focus-visible {
  outline: 1px solid var(--forge-running);
  outline-offset: 2px;
}
.fg-btw__icon:disabled {
  opacity: 0.35;
  cursor: default;
}
.fg-btw svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---- thread: exchanges on hairlines, like Monad's FAQ rows ---- */
.fg-btw__thread {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 16px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.fg-btw__empty {
  margin: 0;
  padding: 18px 0 14px;
  color: var(--forge-text-muted);
  line-height: 1.5;
}
.fg-btw__exchange {
  padding: 12px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--app-primary-foreground) 9%, transparent);
}
.fg-btw__exchange:last-child {
  border-bottom: 0;
}
.fg-btw__question {
  display: -webkit-box;
  margin: 0 0 6px;
  overflow: hidden;
  font-weight: 500;
  line-height: 1.4;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.fg-btw__answer {
  color: color-mix(in srgb, var(--app-primary-foreground) 88%, transparent);
}
.fg-btw__answer :deep(p:first-child) {
  margin-top: 0;
}
.fg-btw__answer :deep(p:last-child) {
  margin-bottom: 0;
}
.fg-btw__note {
  margin: 0;
  color: var(--forge-text-muted);
  line-height: 1.45;
}
.fg-btw__note[data-kind='error'] {
  color: var(--forge-danger);
}
.fg-btw__pending {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fg-btw__glyph {
  color: var(--forge-running);
}

/* ---- input: a hairline field and one inverted pill ---- */
.fg-btw__input {
  display: flex;
  flex: none;
  align-items: flex-end;
  gap: 8px;
  margin: 8px 10px 10px;
  padding: 8px 6px 6px 12px;
  border: 1px solid color-mix(in srgb, var(--app-primary-foreground) 16%, transparent);
  border-radius: 14px;
  transition: border-color 140ms ease;
}
.fg-btw__input:focus-within {
  border-color: color-mix(in srgb, var(--forge-running) 60%, transparent);
}
.fg-btw__input textarea {
  flex: 1 1 auto;
  min-width: 0;
  max-height: 120px;
  padding: 0;
  color: inherit;
  font: inherit;
  line-height: 1.4;
  background: transparent;
  border: 0;
  outline: none;
  resize: none;
}
.fg-btw__input textarea::placeholder {
  color: var(--forge-text-muted);
}
.fg-btw__send {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--app-primary-background);
  background: var(--app-primary-foreground);
  border: 0;
  border-radius: 9999px;
  cursor: pointer;
  transition: opacity 120ms ease;
}
.fg-btw__send:disabled {
  opacity: 0.3;
  cursor: default;
}

/* ---- motion: arrives from just below, settles; none when asked not to ---- */
@media (prefers-reduced-motion: no-preference) {
  .fg-btw-enter-active,
  .fg-btw-leave-active {
    transition: opacity 180ms var(--forge-ease-out), transform 180ms var(--forge-ease-out);
  }
  .fg-btw-enter-from,
  .fg-btw-leave-to {
    opacity: 0;
    transform: translateY(8px) scale(0.985);
  }
}
</style>
