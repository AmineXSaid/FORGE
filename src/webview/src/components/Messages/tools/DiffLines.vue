<template>
  <!--
    Stands in for the Monaco diff editor the official mounts in its diff
    container, at the options it passes: 12px editor font, no line numbers,
    word wrap, +/- indicators, side by side when wide and inline otherwise.
    These rules draw Monaco's internals, so they live here rather than in the
    ported stylesheets, which have no equivalent.
  -->
  <div class="diff" :class="{ scrollable }">
    <template v-if="sideBySide">
      <div class="side">
        <div v-for="(row, i) in pairs" :key="`l${i}`" class="line" :class="{ removed: row.left?.removed, filler: !row.left }">
          <span class="indicator"><span v-if="row.left?.removed" class="codicon codicon-diff-remove" /></span>
          <span class="text">{{ row.left?.text }}</span>
        </div>
      </div>
      <div class="side">
        <div v-for="(row, i) in pairs" :key="`r${i}`" class="line" :class="{ added: row.right?.added, filler: !row.right }">
          <span class="indicator"><span v-if="row.right?.added" class="codicon codicon-diff-insert" /></span>
          <span class="text">{{ row.right?.text }}</span>
        </div>
      </div>
    </template>
    <div v-else class="side">
      <div v-for="(row, i) in rows" :key="i" class="line" :class="row.kind">
        <span class="indicator">
          <span v-if="row.kind === 'removed'" class="codicon codicon-diff-remove" />
          <span v-else-if="row.kind === 'added'" class="codicon codicon-diff-insert" />
        </span>
        <span class="text">{{ row.kind === 'added' ? row.modified : row.original }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { toSideBySide, type DiffRow } from './lineDiff';

const props = defineProps<{
  rows: DiffRow[];
  sideBySide: boolean;
  scrollable?: boolean;
}>();

const pairs = computed(() => (props.sideBySide ? toSideBySide(props.rows) : []));
</script>

<style scoped>
.diff {
  display: flex;
  height: 100%;
  background: var(--app-diff-editor-background);
  color: var(--vscode-editor-foreground, var(--app-primary-foreground));
  font-family: var(--app-monospace-font-family);
  font-size: 12px;
  line-height: 19px;
  overflow: hidden;
}

.diff.scrollable {
  overflow: auto;
}

.side {
  flex: 1;
  min-width: 0;
}

.side + .side {
  border-left: 1px solid var(--app-input-border);
}

.line {
  display: flex;
  min-height: 19px;
}

/* Diff colours are Forge's Pajamas semantics, not the host theme's diff colours. */
.line.removed {
  background: var(--forge-danger-surface);
}

.line.added {
  background: var(--forge-success-surface);
}

.line.removed .codicon {
  color: var(--forge-danger);
}

.line.added .codicon {
  color: var(--forge-success);
}

.line.filler {
  background-image: linear-gradient(
    -45deg,
    var(--app-input-border) 12.5%,
    transparent 12.5%,
    transparent 50%,
    var(--app-input-border) 50%,
    var(--app-input-border) 62.5%,
    transparent 62.5%,
    transparent 100%
  );
  background-size: 8px 8px;
}

.indicator {
  display: inline-flex;
  flex-shrink: 0;
  justify-content: center;
  align-items: center;
  width: 20px;
  height: 19px;
}

.indicator .codicon {
  font-size: 16px;
  transform: scale(0.7);
}

.text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
