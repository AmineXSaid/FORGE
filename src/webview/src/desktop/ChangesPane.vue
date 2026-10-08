<template>
  <!--
    The working tree against HEAD, for the project the window is on: the files
    the agent (or anyone) changed, with their line counts, and the selected
    file's diff drawn by the transcript's own diff renderer.
  -->
  <aside class="fd-changes" aria-label="Changes">
    <div class="fd-changes__header">
      <span class="fd-changes__title">Changes</span>
      <span v-if="status?.isRepo && status.files.length" class="fd-changes__count">{{ status.files.length }}</span>
      <span class="fd-changes__spacer" />
      <span v-if="totals.additions || totals.deletions" class="fd-changes__totals">
        <span class="fd-changes__added">+{{ totals.additions }}</span>
        <span class="fd-changes__deleted">−{{ totals.deletions }}</span>
      </span>
      <button type="button" class="fd-changes__iconButton" title="Refresh" aria-label="Refresh" @click="emit('refresh')">
        <span class="codicon codicon-refresh" aria-hidden="true" />
      </button>
      <button type="button" class="fd-changes__iconButton" title="Close (Ctrl+Shift+D)" aria-label="Close" @click="emit('close')">
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
          <span class="fd-changes__dir">{{ dirName(f.path) }}</span>
          <span v-if="f.binary" class="fd-changes__dir">binary</span>
          <template v-else>
            <span v-if="f.additions" class="fd-changes__added">+{{ f.additions }}</span>
            <span v-if="f.deletions" class="fd-changes__deleted">−{{ f.deletions }}</span>
          </template>
        </li>
      </ul>

      <div class="fd-changes__diff">
        <div v-if="!selected" class="fd-changes__empty">Select a file to see its diff.</div>
        <div v-else-if="diffError" class="fd-changes__empty">{{ diffError }}</div>
        <div v-else-if="!diff" class="fd-changes__empty">Loading…</div>
        <div v-else-if="diff.tooLargeOrBinary" class="fd-changes__empty">This file is binary or too large to show.</div>
        <template v-else>
          <div class="fd-changes__diffHeader">
            <span class="fd-changes__diffPath">{{ diff.path }}</span>
            <button
              type="button"
              class="fd-changes__iconButton"
              :class="{ 'fd-changes__iconButtonOn': sideBySide }"
              :title="sideBySide ? 'Inline view' : 'Side-by-side view'"
              aria-label="Toggle side-by-side view"
              @click="sideBySide = !sideBySide"
            >
              <span class="codicon codicon-split-horizontal" aria-hidden="true" />
            </button>
          </div>
          <DiffLines :rows="rows" :side-by-side="sideBySide" scrollable class="fd-changes__diffBody" />
        </template>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import DiffLines from '../components/Messages/tools/DiffLines.vue';
import { changeTotals, desktopHost, fileDiffRows, type ChangeStatus, type FileDiff, type GitStatus } from './desktopHost';

const props = defineProps<{ status: GitStatus | undefined }>();
const emit = defineEmits<{ refresh: []; close: [] }>();

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
const sideBySide = ref(false);

const totals = computed(() => changeTotals(props.status?.files ?? []));
const rows = computed(() => (diff.value ? fileDiffRows(diff.value.original, diff.value.modified) : []));

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
  },
  { immediate: true }
);
</script>

<style scoped>
.fd-changes {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--app-secondary-background);
}

.fd-changes__header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  flex: none;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--app-widget-border);
}

.fd-changes__title {
  font-weight: 600;
}

.fd-changes__count {
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  background: var(--app-badge-background);
  color: var(--app-badge-foreground);
}

.fd-changes__spacer {
  flex: 1;
}

.fd-changes__totals {
  display: inline-flex;
  gap: 6px;
  font-size: 12px;
}

.fd-changes__added {
  color: var(--app-diff-addition-foreground);
  font-size: 12px;
}

.fd-changes__deleted {
  color: var(--app-diff-deletion-foreground);
  font-size: 12px;
}

.fd-changes__iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  border: 0;
  border-radius: var(--corner-radius-small);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.fd-changes__iconButton:hover {
  background: var(--app-list-hover-background);
}

.fd-changes__iconButtonOn {
  background: var(--app-list-active-background);
}

.fd-changes__empty {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 16px 12px;
  color: var(--vscode-descriptionForeground);
}

.fd-changes__list {
  flex: none;
  max-height: 40%;
  overflow: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  border-bottom: 1px solid var(--app-widget-border);
}

.fd-changes__file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-radius: var(--corner-radius-small);
  cursor: pointer;
  white-space: nowrap;
}

.fd-changes__file:hover {
  background: var(--app-list-hover-background);
}

.fd-changes__fileSelected,
.fd-changes__fileSelected:hover {
  background: var(--app-list-active-background);
}

.fd-changes__badge {
  width: 14px;
  flex: none;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  color: var(--vscode-descriptionForeground);
}

.fd-changes__badge--added,
.fd-changes__badge--untracked {
  color: var(--app-diff-addition-foreground);
}

.fd-changes__badge--deleted,
.fd-changes__badge--conflicted {
  color: var(--app-diff-deletion-foreground);
}

.fd-changes__badge--modified,
.fd-changes__badge--renamed {
  color: var(--vscode-editorWarning-foreground);
}

.fd-changes__name {
  flex: none;
}

.fd-changes__dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.fd-changes__diff {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.fd-changes__diffHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  flex: none;
  padding: 0 6px 0 12px;
  font-family: var(--app-monospace-font-family);
  font-size: 12px;
}

.fd-changes__diffPath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fd-changes__diffBody {
  flex: 1;
  min-height: 0;
}
</style>
