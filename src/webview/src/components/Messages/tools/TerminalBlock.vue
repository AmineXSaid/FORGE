<template>
  <!--
    Forge's terminal for the Bash and PowerShell tool calls, on the shared
    terminal surface (styles/forge-terminal.css):

      div.toolBody.fterm
        div.fterm-section.fterm-input    $ / PS> prompt, coloured command, copy on hover
        div.fterm-section.fterm-output   ANSI-coloured lines, newest in view
        div.fterm-footer                 exit status, line count, earlier lines, open in editor
  -->
  <div class="fg-tool__toolBody fterm" :data-shell="shell">
    <div class="fterm-section fterm-input">
      <span class="fterm-prompt" aria-hidden="true">{{ shell === 'powershell' ? 'PS>' : '$' }}</span>
      <code class="fterm-command"><template v-for="(line, i) in commandLines" :key="i"><template v-if="i > 0">{{ '\n' }}</template><span v-for="(seg, j) in line" :key="j" :class="seg.cls">{{ seg.text }}</span></template></code>
      <CopyButton :get-text="() => command" />
    </div>

    <template v-if="showOutput">
      <div v-if="result" class="fterm-section fterm-output" aria-label="Command output">
        <TerminalLines
          :lines="collapse.visible.value"
          :key-offset="collapse.offset.value"
          :class="collapse.stateClass.value"
          empty-text="No output"
        />
      </div>
      <div v-else-if="busy" class="fterm-section fterm-output" aria-label="Command running">
        <div class="fterm-line"><span class="fterm-cursor" aria-hidden="true" /><span class="fg-vh__visuallyHidden">Running</span></div>
      </div>

      <TerminalFooter
        v-if="result && (exitCode !== undefined || collapse.canCollapse.value)"
        :line-count="lines.length"
        :can-collapse="collapse.canCollapse.value"
        :expanded="collapse.expanded.value"
        :toggle-label="collapse.toggleLabel.value"
        :openable="isLong"
        open-label="Open the output in an editor tab"
        @toggle="collapse.toggle"
        @open="openOutput"
      >
        <span v-if="exitCode !== undefined" class="fterm-badge" :class="{ 'fterm-failed': exitCode !== 0 }">exit {{ exitCode }}</span>
      </TerminalFooter>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import type { ToolResultBlock } from '../../../models/ContentBlock';
import { TranscriptBusyKey } from '../transcriptState';
import { CopyButton, isLongText } from './toolParts';
import TerminalLines from './TerminalLines.vue';
import TerminalFooter from './TerminalFooter.vue';
import { ansiLines, linesText, resultText, shellLines, stripToolUseError, trimBlankEdges } from './terminalText';
import { useLineCollapse } from './useLineCollapse';
import type { ShellKind } from './shellHighlight';
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

const commandLines = computed(() => shellLines(props.command, props.shell));

/** A failed command's result starts "Exit code N"; that becomes the footer badge. */
const parsed = computed(() => {
  let text = stripToolUseError(resultText(props.result).text);
  let code: number | undefined;
  const match = /^Exit code (-?\d+)\s*\n?/.exec(text);
  if (match) {
    code = Number(match[1]);
    text = text.slice(match[0].length);
  }
  // Blank lines at either edge (PowerShell's table formatting opens with one) are dropped.
  return { text: trimBlankEdges(text), code };
});

const exitCode = computed(() => parsed.value.code);
const lines = computed(() => (parsed.value.text === '' ? [] : ansiLines(parsed.value.text)));
const plainOutput = computed(() => linesText(lines.value));
const isLong = computed(() => isLongText(plainOutput.value));

const collapse = useLineCollapse(lines, 'tail', TAIL);

function openOutput(): void {
  void props.context.fileOpener.openContent(plainOutput.value, `${props.toolName} tool output`, false);
}
</script>
