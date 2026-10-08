<template>
  <!--
    The Changes pane (forge-desktop docs/DESIGN.md §4): the working tree
    against HEAD for the window's project.
    - The files, with a mono status letter and their line counts.
    - The selected file's diff as GI's framed figure, captioned "Fig. N".
    - Review: click a line to comment on it; Ctrl+Enter (or "Send review")
      sends every comment to the agent as one message. "Discard" throws a
      file's changes away, after a confirmation.
  -->
  <aside class="fd-changes" aria-label="Changes">
    <div class="fd-changes__header">
      <span class="fd-serif fd-changes__title">Changes</span>
      <span v-if="status?.isRepo && status.files.length" class="fd-tag">{{ status.files.length }} files</span>
      <span class="fd-changes__spacer" />
      <span v-if="totals.additions || totals.deletions" class="fd-label">
        <span class="fd-changes__added">+{{ totals.additions }}</span>
        <span class="fd-changes__deleted">−{{ totals.deletions }}</span>
      </span>
      <button type="button" class="fd-changes__icon" title="Refresh" aria-label="Refresh" @click="emit('refresh')">
        <span class="codicon codicon-refresh" aria-hidden="true" />
      </button>
      <button type="button" class="fd-changes__icon" title="Close (Ctrl+Shift+D)" aria-label="Close" @click="emit('close')">
        <span class="codicon codicon-close" aria-hidden="true" />
      </button>
    </div>

    <div v-if="!status" class="fd-changes__empty">Reading the working tree…</div>
    <div v-else-if="!status.isRepo" class="fd-changes__empty">
      This folder is not a git repository, so there is nothing to compare against.
    </div>
    <div v-else-if="!status.files.length" class="fd-changes__empty">
      <span class="codicon codicon-check" aria-hidden="true" />
      No changes on {{ status.branch ?? 'this branch' }}.
    </div>

    <template v-else>
      <ul class="fd-changes__list" role="listbox" aria-label="Changed files">
        <li
          v-for="f in status.files"
          :key="f.path"
          role="option"
          :aria-selected="f.path === selected"
          class="fd-changes__file"
          :class="{ 'fd-changes__fileSelected': f.path === selected }"
          :title="f.originalPath ? `${f.originalPath} → ${f.path}` : f.path"
          @click="select(f.path)"
        >
          <span class="fd-changes__badge" :class="`fd-changes__badge--${f.status}`">{{ LETTER[f.status] }}</span>
          <span class="fd-changes__name">{{ baseName(f.path) }}</span>
          <span class="fd-caption fd-changes__dir">{{ dirName(f.path) }}</span>
          <span v-if="commentCount(f.path)" class="fd-tag fd-changes__commentTag">
            <span class="codicon codicon-comment" aria-hidden="true" />{{ commentCount(f.path) }}
          </span>
          <span v-if="f.binary" class="fd-caption">binary</span>
          <template v-else>
            <span v-if="f.additions" class="fd-changes__added fd-changes__count">+{{ f.additions }}</span>
            <span v-if="f.deletions" class="fd-changes__deleted fd-changes__count">−{{ f.deletions }}</span>
          </template>
        </li>
      </ul>

      <div class="fd-changes__diff">
        <div v-if="!selected" class="fd-changes__empty">Select a file to see its diff.</div>
        <div v-else-if="diffError" class="fd-changes__empty">{{ diffError }}</div>
        <div v-else-if="!diff" class="fd-changes__empty">Loading…</div>
        <template v-else>
          <div class="fd-changes__diffBar">
            <span class="fd-caption">Fig. {{ figureNumber }} · {{ diff.path }}</span>
            <span class="fd-changes__spacer" />
            <template v-if="confirming">
              <span class="fd-caption">Discard all changes to this file?</span>
              <button type="button" class="fd-pill fd-pill--dark fd-changes__smallPill" @click="discard">Discard</button>
              <button type="button" class="fd-pill fd-pill--ghost fd-changes__smallPill" @click="confirming = false">Cancel</button>
            </template>
            <button
              v-else-if="selectedFile && selectedFile.status !== 'conflicted'"
              type="button"
              class="fd-pill fd-pill--outline fd-changes__smallPill"
              title="Throw away this file's changes"
              @click="confirming = true"
            >
              Discard
            </button>
          </div>

          <div v-if="diff.tooLargeOrBinary" class="fd-changes__empty">This file is binary or too large to show.</div>
          <div v-else class="fd-figure fd-changes__figure">
            <div class="fd-figure__inner fd-changes__code" role="table" aria-label="Diff">
              <template v-for="(row, i) in rows" :key="i">
                <div
                  class="fd-changes__line"
                  :class="[`fd-changes__line--${row.kind}`, { 'fd-changes__line--commented': hasComment(row) }]"
                  role="row"
                  title="Click to comment on this line"
                  @click="startComment(row)"
                >
                  <span class="fd-changes__num">{{ row.before ?? '' }}</span>
                  <span class="fd-changes__num">{{ row.after ?? '' }}</span>
                  <span class="fd-changes__sign">{{ row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : '' }}</span>
                  <span class="fd-changes__text">{{ row.text }}</span>
                </div>
                <div v-for="c in commentsOn(row)" :key="c.id" class="fd-changes__comment">
                  <span class="fd-label fd-changes__commentWho">Note</span>
                  <span class="fd-changes__commentBody">{{ c.body }}</span>
                  <button type="button" class="fd-changes__icon" aria-label="Delete comment" @click="removeComment(c.id)">
                    <span class="codicon codicon-trash" aria-hidden="true" />
                  </button>
                </div>
                <div v-if="draftOn(row)" class="fd-changes__draft">
                  <textarea
                    ref="draftInput"
                    v-model="draft!.body"
                    class="fd-changes__draftInput"
                    rows="2"
                    placeholder="What should change here?  Enter adds · Ctrl+Enter sends the review"
                    @keydown.enter.exact.prevent="commitDraft"
                    @keydown.esc.prevent="draft = undefined"
                  />
                  <div class="fd-changes__draftButtons">
                    <button type="button" class="fd-pill fd-pill--ghost fd-changes__smallPill" @click="draft = undefined">Cancel</button>
                    <button type="button" class="fd-pill fd-pill--dark fd-changes__smallPill" :disabled="!draft!.body.trim()" @click="commitDraft">Add comment</button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>

      <div v-if="comments.length" class="fd-changes__review">
        <span class="fd-label">{{ comments.length }} {{ comments.length === 1 ? 'comment' : 'comments' }}</span>
        <span class="fd-changes__spacer" />
        <button type="button" class="fd-pill fd-pill--ghost fd-changes__smallPill" @click="comments = []">Clear</button>
        <button type="button" class="fd-pill fd-pill--primary" title="Ctrl+Enter" @click="sendReview">
          Send review <span class="fd-chevron" aria-hidden="true">›</span>
        </button>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  changeTotals,
  desktopHost,
  fileDiffRows,
  numberRows,
  reviewMessage,
  type ChangeStatus,
  type FileDiff,
  type GitStatus,
  type NumberedRow,
  type ReviewComment,
} from './desktopHost';

const props = defineProps<{ status: GitStatus | undefined }>();
const emit = defineEmits<{ refresh: []; close: []; sendReview: [text: string] }>();

const LETTER: Record<ChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: '!',
};

const selected = ref<string>();
const diff = ref<FileDiff>();
const diffError = ref<string>();
const confirming = ref(false);

const totals = computed(() => changeTotals(props.status?.files ?? []));
const rows = computed(() => (diff.value ? numberRows(fileDiffRows(diff.value.original, diff.value.modified)) : []));
const selectedFile = computed(() => props.status?.files.find((f) => f.path === selected.value));
const figureNumber = computed(() => Math.max(1, (props.status?.files.findIndex((f) => f.path === selected.value) ?? 0) + 1));

const baseName = (p: string) => p.split('/').pop() ?? p;
const dirName = (p: string) => p.split('/').slice(0, -1).join('/');

let request = 0;
async function load(path: string): Promise<void> {
  const mine = ++request;
  diffError.value = undefined;
  try {
    const result = await desktopHost()?.gitDiff(path);
    if (mine === request) diff.value = result;
  } catch (error) {
    if (mine === request) diffError.value = error instanceof Error ? error.message : String(error);
  }
}

function select(path: string): void {
  if (selected.value === path) return;
  selected.value = path;
  diff.value = undefined;
  confirming.value = false;
  draft.value = undefined;
  void load(path);
}

// A new status: keep the selection while the file is still changed (and
// re-read its diff, which may have moved), else take the first file.
watch(
  () => props.status,
  (status) => {
    const files = status?.files ?? [];
    if (selected.value && files.some((f) => f.path === selected.value)) {
      void load(selected.value);
    } else {
      selected.value = undefined;
      diff.value = undefined;
      if (files[0]) select(files[0].path);
    }
    // Comments on files that are no longer changed have nothing to point at.
    comments.value = comments.value.filter((c) => files.some((f) => f.path === c.path));
  },
  { immediate: true }
);

/* -------------------------------------------------------------- review */

const comments = ref<ReviewComment[]>([]);
const draft = ref<{ key: string; row: NumberedRow; body: string }>();
const draftInput = ref<HTMLTextAreaElement[]>();
let seq = 0;

const rowKey = (row: NumberedRow) => `${selected.value}:${row.before ?? ''}:${row.after ?? ''}`;
const anchor = (row: NumberedRow) =>
  row.after !== undefined ? { line: row.after, side: 'after' as const } : { line: row.before ?? 0, side: 'before' as const };

function commentsOn(row: NumberedRow): ReviewComment[] {
  const { line, side } = anchor(row);
  return comments.value.filter((c) => c.path === selected.value && c.line === line && c.side === side);
}
const hasComment = (row: NumberedRow) => commentsOn(row).length > 0;
const draftOn = (row: NumberedRow) => draft.value?.key === rowKey(row);
const commentCount = (path: string) => comments.value.filter((c) => c.path === path).length;

async function startComment(row: NumberedRow): Promise<void> {
  if (draftOn(row)) return;
  draft.value = { key: rowKey(row), row, body: '' };
  await nextTick();
  draftInput.value?.[0]?.focus();
}

function commitDraft(): void {
  const d = draft.value;
  if (!d || !d.body.trim() || !selected.value) return;
  comments.value = [...comments.value, { id: `c${++seq}`, path: selected.value, ...anchor(d.row), code: d.row.text, body: d.body.trim() }];
  draft.value = undefined;
}

function removeComment(id: string): void {
  comments.value = comments.value.filter((c) => c.id !== id);
}

function sendReview(): void {
  if (draft.value?.body.trim()) commitDraft();
  const text = reviewMessage(comments.value);
  if (!text) return;
  emit('sendReview', text);
  comments.value = [];
}

/**
 * Ctrl+Enter sends the review from anywhere in the window except the chat's
 * composer, whose own keys win there. Adding a comment removes its text box,
 * so focus is often back on the page by the time the review is sent.
 */
function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
  if (!comments.value.length && !draft.value?.body.trim()) return;
  if ((event.target as Element | null)?.closest?.('.fg-composer__inputContainer')) return;
  event.preventDefault();
  event.stopPropagation();
  sendReview();
}
onMounted(() => window.addEventListener('keydown', onKey, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));

/* ------------------------------------------------------------- discard */

async function discard(): Promise<void> {
  const path = selected.value;
  confirming.value = false;
  if (!path) return;
  try {
    await desktopHost()?.gitDiscard(path);
    comments.value = comments.value.filter((c) => c.path !== path);
  } catch (error) {
    diffError.value = error instanceof Error ? error.message : String(error);
  }
  emit('refresh');
}
</script>

<style scoped>
.fd-changes {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--fd-chrome);
}

.fd-changes__header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  flex: none;
  padding: 0 8px 0 18px;
}

.fd-changes__title {
  font-size: 20px;
}

.fd-changes__spacer {
  flex: 1;
}

.fd-changes__added {
  color: var(--fd-good);
}

.fd-changes__deleted {
  color: var(--fd-bad);
  margin-left: 6px;
}

.fd-changes__count {
  font-family: var(--fd-mono);
  font-size: 11px;
}

.fd-changes__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--fd-pill);
  background: transparent;
  color: var(--fd-muted);
  cursor: pointer;
}

.fd-changes__icon:hover {
  background: var(--fd-hover);
  color: var(--fd-ink);
}

.fd-changes__empty {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 16px 18px;
  color: var(--fd-muted);
}

.fd-changes__list {
  flex: none;
  max-height: 34%;
  overflow: auto;
  margin: 0 10px;
  padding: 4px 0;
  list-style: none;
  border-top: 1px solid var(--fd-edge-chrome);
  border-bottom: 1px solid var(--fd-edge-chrome);
}

.fd-changes__file {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
}

.fd-changes__file:hover {
  background: var(--fd-hover);
}

.fd-changes__fileSelected,
.fd-changes__fileSelected:hover {
  background: var(--fd-selected);
}

.fd-changes__badge {
  width: 12px;
  flex: none;
  font-family: var(--fd-mono);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  color: var(--fd-muted);
}

.fd-changes__badge--added,
.fd-changes__badge--untracked {
  color: var(--fd-good);
}

.fd-changes__badge--deleted,
.fd-changes__badge--conflicted {
  color: var(--fd-bad);
}

.fd-changes__badge--modified,
.fd-changes__badge--renamed {
  color: var(--fd-primary);
}

.fd-changes__name {
  flex: none;
}

.fd-changes__dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fd-changes__commentTag {
  height: 18px;
  background: var(--fd-paper);
}

.fd-changes__diff {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.fd-changes__diffBar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  flex: none;
  padding: 0 12px 0 18px;
}

.fd-changes__smallPill {
  height: 24px;
  padding: 0 10px;
}

.fd-changes__figure {
  flex: 1;
  min-height: 0;
  display: flex;
  margin: 0 10px 10px;
}

.fd-changes__code {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 0;
  font-family: var(--fd-mono);
  font-size: 12px;
  line-height: 19px;
  color: var(--fd-graphite);
}

.fd-changes__line {
  display: grid;
  grid-template-columns: 34px 34px 14px 1fr;
  cursor: pointer;
}

.fd-changes__line:hover {
  box-shadow: inset 2px 0 0 var(--fd-signal);
}

.fd-changes__line--added {
  background: var(--forge-diff-added-surface);
}

.fd-changes__line--removed {
  background: var(--forge-diff-removed-surface);
}

.fd-changes__line--commented {
  box-shadow: inset 2px 0 0 var(--fd-primary);
}

.fd-changes__num {
  padding-right: 8px;
  text-align: right;
  color: var(--fd-faint);
  user-select: none;
}

.fd-changes__sign {
  color: var(--fd-muted);
  user-select: none;
}

.fd-changes__line--added .fd-changes__sign {
  color: var(--fd-good);
}

.fd-changes__line--removed .fd-changes__sign {
  color: var(--fd-bad);
}

.fd-changes__text {
  white-space: pre-wrap;
  word-break: break-word;
  padding-right: 12px;
}

.fd-changes__comment,
.fd-changes__draft {
  margin: 4px 12px 6px 82px;
  padding: 8px 10px;
  border: 1px solid var(--fd-edge-paper);
  border-radius: 10px;
  background: var(--fd-linen);
  font-family: var(--fd-sans);
  font-size: 13px;
  line-height: 1.5;
  color: var(--fd-body);
}

.fd-changes__comment {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.fd-changes__commentWho {
  padding-top: 2px;
  color: var(--fd-primary);
}

.fd-changes__commentBody {
  flex: 1;
  white-space: pre-wrap;
}

.fd-changes__draftInput {
  display: block;
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 0;
  border-bottom: 1px solid var(--fd-body);
  background: transparent;
  color: var(--fd-ink);
  font: inherit;
  outline: none;
}

.fd-changes__draftButtons {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

/* The review bar: GI's quiet bottom banner, holding Monad's primary pill. */
.fd-changes__review {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  margin: 0 10px 10px;
  padding: 8px 8px 8px 14px;
  border: 1px solid var(--fd-edge-paper);
  border-radius: var(--fd-pill);
  background: var(--fd-paper);
  box-shadow: var(--fd-shadow-soft);
}
</style>
