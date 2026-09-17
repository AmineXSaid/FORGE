<template>
  <!--
    Forge's terminal for the Bash and PowerShell tool calls.

    The box is the official tool body (.toolBody: hairline border, 5px radius,
    8px above and below), so it sits in the timeline exactly where the official
    IN / OUT grid does. Inside, Forge draws a terminal instead of that grid:

      div.toolBody.term
        div.bashtool-inputRow.term-input     $ / PS> prompt, coloured command, copy
        div.term-output                      ANSI-coloured lines, newest at the bottom
        div.term-footer                      exit status, line count, expand, open in editor

    Everything is in Forge's faces and Pajamas colours (--forge-terminal-*).
  -->
  <div class="fg-tool__toolBody term" :data-shell="shell">
    <div class="fg-bashtool__inputRow term-input">
      <span class="term-prompt" aria-hidden="true">{{ shell === 'powershell' ? 'PS>' : '$' }}</span>
      <code class="term-command"><span v-for="(token, i) in commandTokens" :key="i" :class="`tok-${token.kind}`">{{ token.text }}</span></code>
      <CopyButton :get-text="() => command" class-name="fg-bashtool__copyButton" />
    </div>

    <template v-if="showOutput">
      <div v-if="result" class="term-output" :class="{ collapsed: canCollapse && !expanded, expanded: expanded }" aria-label="Command output">
        <div v-if="visibleLines.length === 0" class="term-line term-empty">No output</div>
        <div v-for="(line, i) in visibleLines" :key="hiddenCount + i" class="term-line">
          <span v-for="(seg, j) in line" :key="j" :class="segmentClass(seg)">{{ seg.text }}</span>
          <template v-if="line.length === 0">&#8203;</template>
        </div>
      </div>
      <div v-else-if="busy" class="term-output" aria-label="Command running">
        <div class="term-line"><span class="term-cursor" aria-hidden="true" /><span class="fg-vh__visuallyHidden">Running</span></div>
      </div>

      <div v-if="result && (exitCode !== undefined || canCollapse)" class="term-footer">
        <span v-if="exitCode !== undefined" class="term-exit" :class="{ failed: exitCode !== 0 }">exit {{ exitCode }}</span>
        <span class="term-count">{{ lines.length }} line{{ lines.length === 1 ? '' : 's' }}</span>
        <span class="term-spacer" />
        <button v-if="canCollapse" type="button" class="term-action" :aria-expanded="expanded" @click="expanded = !expanded">
          {{ expanded ? 'Show less' : `Show ${hiddenLineCount} earlier line${hiddenLineCount === 1 ? '' : 's'}` }}
        </button>
        <button
          v-if="isLong"
          type="button"
          class="term-action term-open"
          title="Open the output in an editor tab"
          aria-label="Open the output in an editor tab"
          @click="openOutput"
        >
          <span class="codicon codicon-go-to-file" aria-hidden="true" />
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import type { ToolResultBlock } from '../../../models/ContentBlock';
import { TranscriptBusyKey } from '../transcriptState';
import { CopyButton, isLongText } from './toolParts';
import { parseAnsi, type AnsiSegment } from './ansi';
import { tokenizeShell, type ShellKind } from './shellHighlight';
import type { ToolRenderContext } from './toolRegistry';

const props = withDefaults(
  defineProps<{
    shell: ShellKind;
    command: string;
    result?: ToolResultBlock;
    context: ToolRenderContext;
    toolName: string;
    /** False when the user rejected the call: the official then shows the reason, not output. */
    showOutput?: boolean;
  }>(),
  { result: undefined, showOutput: true }
);

/** Lines shown before "Show earlier lines": the tail, as a terminal keeps its newest output in view. */
const TAIL = 10;

const busy = inject(TranscriptBusyKey, ref(false));
const expanded = ref(false);

const commandTokens = computed(() => tokenizeShell(props.command, props.shell));

/** The result as text: string content, or the text blocks of array content. */
const rawOutput = computed(() => {
  const content = props.result?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.type === 'text' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
});

/** A failed command's result starts "Exit code N"; that becomes the footer badge. */
const parsed = computed(() => {
  let text = rawOutput.value.replace(/<\/?tool_use_error>/g, '');
  let code: number | undefined;
  const match = /^Exit code (-?\d+)\s*\n?/.exec(text);
  if (match) {
    code = Number(match[1]);
    text = text.slice(match[0].length);
  }
  // Blank lines at either edge (PowerShell's table formatting opens with one) are dropped.
  return { text: text.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, ''), code };
});

const exitCode = computed(() => parsed.value.code);
const lines = computed<AnsiSegment[][]>(() => (parsed.value.text === '' ? [] : parseAnsi(parsed.value.text)));
const plainOutput = computed(() => lines.value.map((line) => line.map((s) => s.text).join('')).join('\n'));

const canCollapse = computed(() => lines.value.length > TAIL);
const hiddenLineCount = computed(() => Math.max(0, lines.value.length - TAIL));
const hiddenCount = computed(() => (canCollapse.value && !expanded.value ? hiddenLineCount.value : 0));
const visibleLines = computed(() => lines.value.slice(hiddenCount.value));
const isLong = computed(() => isLongText(plainOutput.value));

function segmentClass(seg: AnsiSegment): string[] {
  const fg = seg.inverse ? seg.bg ?? 'inverse-fg' : seg.fg;
  const bg = seg.inverse ? seg.fg ?? 'inverse-bg' : seg.bg;
  const out: string[] = [];
  if (fg) out.push(`fg-${fg}`);
  if (bg) out.push(`bg-${bg}`);
  if (seg.bold) out.push('bold');
  if (seg.dim) out.push('dim');
  if (seg.italic) out.push('italic');
  if (seg.underline) out.push('underline');
  return out;
}

function openOutput(): void {
  void props.context.fileOpener.openContent(plainOutput.value, `${props.toolName} tool output`, false);
}
</script>

<style scoped>
.term {
  position: relative;
  overflow: hidden;
  background: var(--forge-terminal-background);
  color: var(--forge-terminal-foreground);
  font-family: var(--forge-font-mono);
  font-size: 12px;
  line-height: 1.55;
}

/* ---- Command line ---------------------------------------------------------- */

.term-input {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 36px 7px 10px;
}

.term-prompt {
  flex-shrink: 0;
  color: var(--forge-terminal-prompt);
  font-weight: 700;
  user-select: none;
}

.term-command {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  background: none;
  font-family: inherit;
  font-size: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--forge-terminal-foreground);
}

.tok-command { color: var(--forge-terminal-command); font-weight: 600; }
.tok-keyword { color: var(--forge-terminal-keyword); }
.tok-flag { color: var(--forge-terminal-flag); }
.tok-string { color: var(--forge-terminal-string); }
.tok-variable { color: var(--forge-terminal-variable); }
.tok-operator { color: var(--forge-terminal-operator); }
.tok-number { color: var(--forge-terminal-number); }
.tok-comment { color: var(--forge-terminal-comment); font-style: italic; }

/* ---- Output ---------------------------------------------------------------- */

.term-output {
  position: relative;
  border-top: 1px solid var(--forge-terminal-divider);
  padding: 6px 10px 7px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.term-output.expanded {
  max-height: 360px;
  overflow-y: auto;
}

/* Collapsed to the tail: fade the top edge so it reads as "more above". */
.term-output.collapsed {
  mask-image: linear-gradient(to bottom, transparent 0, var(--forge-terminal-background) 22px);
}

.term-line {
  min-height: 1.55em;
}

.term-empty {
  color: var(--forge-terminal-muted);
  font-style: italic;
}

.term-cursor {
  display: inline-block;
  width: 0.6em;
  height: 1.15em;
  vertical-align: text-bottom;
  background: var(--forge-terminal-cursor);
  animation: term-cursor-blink 1s steps(1) infinite;
}

@keyframes term-cursor-blink {
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .term-cursor { animation: none; }
}

/* ANSI colours: the sixteen terminal colours, all Pajamas stops. */
.fg-black { color: var(--forge-terminal-black); }
.fg-red { color: var(--forge-terminal-red); }
.fg-green { color: var(--forge-terminal-green); }
.fg-yellow { color: var(--forge-terminal-yellow); }
.fg-blue { color: var(--forge-terminal-blue); }
.fg-magenta { color: var(--forge-terminal-magenta); }
.fg-cyan { color: var(--forge-terminal-cyan); }
.fg-white { color: var(--forge-terminal-white); }
.fg-bright-black { color: var(--forge-terminal-bright-black); }
.fg-bright-red { color: var(--forge-terminal-bright-red); }
.fg-bright-green { color: var(--forge-terminal-bright-green); }
.fg-bright-yellow { color: var(--forge-terminal-bright-yellow); }
.fg-bright-blue { color: var(--forge-terminal-bright-blue); }
.fg-bright-magenta { color: var(--forge-terminal-bright-magenta); }
.fg-bright-cyan { color: var(--forge-terminal-bright-cyan); }
.fg-bright-white { color: var(--forge-terminal-bright-white); }
.fg-inverse-fg { color: var(--forge-terminal-background); }

.bg-black { background: color-mix(in srgb, var(--forge-terminal-black) 35%, transparent); }
.bg-red { background: color-mix(in srgb, var(--forge-terminal-red) 35%, transparent); }
.bg-green { background: color-mix(in srgb, var(--forge-terminal-green) 35%, transparent); }
.bg-yellow { background: color-mix(in srgb, var(--forge-terminal-yellow) 35%, transparent); }
.bg-blue { background: color-mix(in srgb, var(--forge-terminal-blue) 35%, transparent); }
.bg-magenta { background: color-mix(in srgb, var(--forge-terminal-magenta) 35%, transparent); }
.bg-cyan { background: color-mix(in srgb, var(--forge-terminal-cyan) 35%, transparent); }
.bg-white { background: color-mix(in srgb, var(--forge-terminal-white) 35%, transparent); }
.bg-bright-black { background: color-mix(in srgb, var(--forge-terminal-bright-black) 35%, transparent); }
.bg-bright-red { background: color-mix(in srgb, var(--forge-terminal-bright-red) 35%, transparent); }
.bg-bright-green { background: color-mix(in srgb, var(--forge-terminal-bright-green) 35%, transparent); }
.bg-bright-yellow { background: color-mix(in srgb, var(--forge-terminal-bright-yellow) 35%, transparent); }
.bg-bright-blue { background: color-mix(in srgb, var(--forge-terminal-bright-blue) 35%, transparent); }
.bg-bright-magenta { background: color-mix(in srgb, var(--forge-terminal-bright-magenta) 35%, transparent); }
.bg-bright-cyan { background: color-mix(in srgb, var(--forge-terminal-bright-cyan) 35%, transparent); }
.bg-bright-white { background: color-mix(in srgb, var(--forge-terminal-bright-white) 35%, transparent); }
.bg-inverse-bg { background: var(--forge-terminal-foreground); }

.bold { font-weight: 700; }
.dim { opacity: 0.6; }
.italic { font-style: italic; }
.underline { text-decoration: underline; }

/* ---- Footer ---------------------------------------------------------------- */

.term-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  padding: 0 4px 0 10px;
  border-top: 1px solid var(--forge-terminal-divider);
  font-family: var(--forge-font-sans);
  font-size: 11px;
  color: var(--forge-terminal-muted);
}

.term-exit {
  padding: 0 6px;
  border-radius: 3px;
  font-family: var(--forge-font-mono);
  color: var(--forge-success);
  background: var(--forge-success-surface);
}

.term-exit.failed {
  color: var(--forge-danger);
  background: var(--forge-danger-surface);
}

.term-spacer {
  flex: 1;
}

.term-action {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border: none;
  border-radius: 3px;
  background: none;
  color: var(--forge-terminal-muted);
  font: inherit;
  cursor: pointer;
}

.term-action:hover {
  color: var(--forge-terminal-foreground);
  background: var(--forge-terminal-divider);
}

.term-action:focus-visible {
  outline: 1px solid var(--forge-focus-ring);
  outline-offset: -1px;
}

.term-open .codicon {
  font-size: 14px;
}
</style>
