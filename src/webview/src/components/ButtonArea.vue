<template>
  <!--
    The Claude Code composer footer.

    Six elements, in the order the real extension uses: an actions button, the
    command-menu button, the model pill (model name plus effort), a flexible
    spacer, the permission-mode selector, and send. Mode sits beside send because
    those two together are what you check before committing a turn -- and the
    send button takes its colour from data-permission-mode, so the mode is
    legible even without reading its label.

    Deliberately absent: the official build also carries a microphone and a usage
    meter here. Forge has no speech backend, and a button that does nothing is
    worse than no button.

    Send is the enclosing form's submit button, so Enter submits natively.
  -->
  <div class="fg-footer__inputFooter fg-footer__inputFooterV2">
    <!-- Official order: + menu, command menu button, (usage meter), model pill. -->
    <AddMenu
      @attach-file="handleAttachClick"
      @insert-at-mention="(text) => emit('insertAtMention', text)"
    />
    <input ref="fileInputRef" type="file" multiple style="display: none" @change="handleFileUpload" />

    <button
      type="button"
      class="fg-footer__menuButton"
      title="Show command menu (/)"
      @click="commandMenuOpen = !commandMenuOpen"
    >
      <CommandMenuIcon />
    </button>

    <ModelSelect
      ref="modelSelectRef"
      :selected-model="selectedModel"
      :effort="effort"
      :models="models"
      :unavailable-models="unavailableModels"
      :last-served-model="lastServedModel"
      :model-setting="modelSetting"
      @model-select="(model) => emit('modelSelect', model)"
      @effort-select="(level) => emit('effortSelect', level)"
      @ultracode-select="emit('ultracodeSelect')"
      @model-label="(label) => (modelLabel = label)"
    />

    <CommandMenu
      v-if="commandMenuOpen"
      :commands="menuCommands"
      :version="FORGE_VERSION"
      @run="runCommand"
      @effort="(level) => emit('effortSelect', level)"
      @ultracode="emit('ultracodeSelect')"
      @report-problem="reportProblem"
      @close="commandMenuOpen = false"
    />

    <!--
      The divider exists only alongside a selection, so the footer never carries
      a stray rule with nothing to separate.
    -->
    <div v-if="selectionLabel" class="fg-footer__divider" />
    <span v-if="selectionLabel" class="fg-footer__selectionChip">
      <span
        class="fg-footer__footerButton fg-footer__footerButtonStatic"
        :title="`Showing Forge your current file selection (${selectionLabel})`"
      >
        <SelectionIcon />
        <span>{{ selectionLabel }}</span>
      </span>
      <button
        type="button"
        class="fg-footer__footerButton"
        aria-label="Remove from message"
        @click="emit('removeSelection')"
      >
        <span class="codicon codicon-close" />
      </button>
    </span>

    <div class="fg-footer__spacer" />

    <ModeSelect
      :permission-mode="permissionMode"
      @mode-select="(mode) => emit('modeSelect', mode)"
    />

    <Tooltip :content="submitVariant === 'stop' ? 'Stop' : 'Send'">
      <button
        type="submit"
        class="fg-footer__sendButton"
        :data-permission-mode="permissionMode"
        :disabled="submitVariant === 'disabled'"
        :aria-label="submitVariant === 'stop' ? 'Stop' : 'Send'"
        @click="handleSendClick"
      >
        <svg
          v-if="submitVariant === 'stop'"
          class="fg-footer__stopIcon"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
        <svg v-else class="fg-footer__sendIcon" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 15.5V5m0 0L5.5 9.5M10 5l4.5 4.5"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
        </svg>
      </button>
    </Tooltip>
  </div>
</template>

<script setup lang="ts">
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { ref, computed } from 'vue'
import Tooltip from './Common/Tooltip.vue'
import ModeSelect from './ModeSelect.vue'
import { forgeVoice } from '../utils/forgeVoice'
import CommandMenuIcon from './forge/icons/CommandMenuIcon.vue'
import SelectionIcon from './forge/icons/SelectionIcon.vue'
import ModelSelect from './ModelSelect.vue'
import AddMenu from './forge/AddMenu.vue'
import CommandMenu, { type MenuCommand } from './forge/CommandMenu.vue'
import { NO_EFFORT, effortRowSuffix, nextEffortPick, type EffortState } from './forge/effort'
import { slashCommandRows, slashCommandSelection, type CliSlashCommand } from './forge/slashCommands'
import type { ModelRow } from './forge/modelCatalog'
import { transport } from '../core/runtimeTransport'
import { version as FORGE_VERSION } from '../../../../package.json'

interface Props {
  disabled?: boolean
  loading?: boolean
  selectedModel?: string
  conversationWorking?: boolean
  hasInputContent?: boolean
  showProgress?: boolean
  progressPercentage?: number
  contextTooltip?: string
  thinkingLevel?: string
  /** The effort controls' state (the session's `effortState`). */
  effort?: EffortState
  permissionMode?: PermissionMode
  /** Current editor selection, surfaced as a chip beside the model pill. */
  selection?: { filePath: string; startLine: number; endLine: number; selectedText?: string } | undefined
  /** The CLI's init `commands` (official `claudeConfig.commands`), shown in "Slash Commands". */
  slashCommands?: CliSlashCommand[]
  /** The CLI's model lists (official `claudeConfig.models` / `unavailable_models`). */
  models?: ModelRow[]
  unavailableModels?: ModelRow[]
  /** The official `lastServedModel`. */
  lastServedModel?: string
  /** The persisted model setting (official `config.modelSetting`). */
  modelSetting?: string
}

interface Emits {
  (e: 'stop'): void
  (e: 'addAttachment', files: FileList): void
  (e: 'mention', filePath?: string): void
  (e: 'mentionSelection'): void
  (e: 'removeSelection'): void
  (e: 'commandMenu'): void
  (e: 'modeSelect', mode: PermissionMode): void
  (e: 'modelSelect', model: ModelRow): void
  (e: 'effortSelect', level: string): void
  /** The official `enableUltracode`: the slider's last notch, or the row's cycle reaching it. */
  (e: 'ultracodeSelect'): void
  (e: 'insertAtMention', text: string): void
  /** Replace the draft with this text, caret at the end (official `D0`). */
  (e: 'setInput', text: string): void
  /** Send this text as a message without touching the draft (official `W5`). */
  (e: 'sendCommand', text: string): void
  (e: 'thinkingToggle'): void
  (e: 'clearConversation'): void
  (e: 'openSlashCommands'): void
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  loading: false,
  selectedModel: 'default',
  conversationWorking: false,
  hasInputContent: false,
  showProgress: true,
  progressPercentage: 48.7,
  contextTooltip: '',
  thinkingLevel: 'default_on',
  effort: () => NO_EFFORT,
  permissionMode: 'default'
})

const emit = defineEmits<Emits>()

const fileInputRef = ref<HTMLInputElement>()
const modelSelectRef = ref<InstanceType<typeof ModelSelect> | null>(null)
const commandMenuOpen = ref(false)

defineExpose({
  /** Open the / menu, as its footer button does. */
  openCommandMenu() {
    commandMenuOpen.value = true
  },
})
const modelLabel = ref('')

/**
 * The command menu's rows, built the way the official registry builds them --
 * same ids, labels, descriptions, sections and trailing controls -- limited to
 * what Forge can actually do. Official rows Forge has no backend for (Rewind,
 * Account & usage, Switch account, Remote Control, Focus view, flagged-message
 * model switching, fast mode) are not registered, exactly as the official skips
 * rows its host cannot serve.
 */
const menuCommands = computed<MenuCommand[]>(() => {
  const effort = props.effort
  const rows: MenuCommand[] = [
    { id: 'attach-file', label: 'Attach file…', description: 'Upload a file to include in conversation', section: 'Context' },
    { id: 'mention-file', label: 'Mention file from this project…', description: 'Reference a project file with @mention', section: 'Context' },
    { id: 'clear-conversation', label: 'Clear conversation', description: 'Start a new conversation', section: 'Context' },
    { id: 'new-conversation', label: 'New conversation', description: 'Open a new conversation in a new tab', section: 'Context', filterOnly: true },
    { id: 'model', label: 'Switch model…', description: 'Change the AI model', section: 'Model', trailing: modelLabel.value ? 'text' : undefined, trailingText: modelLabel.value },
    // The official unregisters "effort-level" for a model without effort.
    ...(effort.supported
      ? [{ id: 'effort-level', label: 'Effort', labelSuffix: effortRowSuffix(effort.level, effort.ultracodeSelected), description: 'Set how hard the model tries', section: 'Model', trailing: 'effort', effortLevel: effort.level, effortLevels: effort.levels, showUltracode: effort.ultracodeAvailable, ultracodeSelected: effort.ultracodeSelected, keepMenuOpen: true } satisfies MenuCommand]
      : []),
    { id: 'toggle-thinking', label: 'Thinking', description: 'Toggle extended thinking mode', section: 'Model', trailing: 'toggle', isOn: props.thinkingLevel !== 'off', keepMenuOpen: true },
    { id: 'mcp-config', label: 'MCP servers', description: 'Configure Model Context Protocol servers', section: 'Customize' },
    { id: 'hooks-config', label: 'Hooks', description: 'View and edit hooks', section: 'Customize' },
    { id: 'permission-rules', label: 'Permissions', description: 'View and edit permission rules', section: 'Customize' },
    { id: 'browse-slash-commands', label: 'Slash commands', description: 'Browse slash commands', section: 'Customize' },
    { id: 'plugins', label: 'Manage plugins', description: 'Install, enable, or disable plugins', section: 'Customize' },
    { id: 'terminal', label: 'Open Forge in Terminal', description: 'Open a new Forge instance in the Terminal', section: 'Customize', trailing: 'terminal' },
    { id: 'config', label: 'General config…', description: 'Open Forge Extension configuration', section: 'Settings' },
    { id: 'help', label: 'View help docs', description: 'Open help documentation', section: 'Support' },
  ]
  return [...rows, ...slashCommandRows(props.slashCommands, forgeVoice)]
})

function runCommand(id: string, viaTab = false) {
  const slash = slashCommandSelection(id, viaTab)
  if (slash) return slash.kind === 'insert' ? emit('setInput', slash.text) : emit('sendCommand', slash.text)
  switch (id) {
    case 'attach-file': return handleAttachClick()
    case 'mention-file': return emit('insertAtMention', '@')
    case 'clear-conversation': return emit('clearConversation')
    case 'new-conversation': return void transport.startNewConversationTab()
    case 'model': return modelSelectRef.value?.openMenu()
    case 'effort-level': {
      // Clicking the row (not the slider) cycles, like the official registry row.
      const e = props.effort
      const pick = nextEffortPick(e.levels, e.level, e.ultracodeAvailable, e.ultracodeSelected)
      return pick.kind === 'ultracode' ? emit('ultracodeSelect') : emit('effortSelect', pick.level)
    }
    case 'toggle-thinking': return emit('thinkingToggle')
    // Forge keeps MCP, hooks, permissions and plugins on its own Settings page.
    case 'mcp-config':
    case 'hooks-config':
    case 'permission-rules':
    case 'plugins': return void transport.openConfigFile('command:forge.openSettings')
    case 'browse-slash-commands': return emit('openSlashCommands')
    // The official row passes exactly this: no prompt, no args, the panel.
    case 'terminal': return void transport.openClaudeInTerminal(undefined, undefined, 'bottom')
    case 'config': return void transport.openConfigFile('vscode')
    case 'help': return void transport.openURL('https://code.claude.com/docs/en/vs-code')
  }
}

/** Forge has no feedback dialog; its logs are where a problem report starts. */
function reportProblem() {
  commandMenuOpen.value = false
  void transport.openConfigFile('command:forge.showLogs')
}

/**
 * Selection chip label. With text selected the official chip counts lines,
 * because the line count is what tells you how much context you are attaching;
 * with only a cursor position it falls back to the file name.
 */
const selectionLabel = computed(() => {
  const sel = props.selection
  if (!sel?.filePath) return ''
  if (sel.selectedText) {
    const lines = sel.endLine - sel.startLine + 1
    return `${lines} ${lines === 1 ? 'line' : 'lines'} selected`
  }
  return sel.filePath.split(/[/\\]/).pop() ?? sel.filePath
})

const submitVariant = computed(() => {
  // While the conversation is working the button is always Stop, even with a
  // draft in the box -- matching the official behaviour.
  if (props.conversationWorking) return 'stop'
  if (!props.hasInputContent) return 'disabled'
  return 'enabled'
})

/**
 * Stop is not a submit: interrupt the run and leave the draft alone. Sending is
 * left to the form's native submit, so Enter and the button take the same path.
 */
function handleSendClick(event: MouseEvent) {
  if (submitVariant.value === 'stop') {
    event.preventDefault()
    emit('stop')
  }
}

function handleAttachClick() {
  fileInputRef.value?.click()
}

function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    emit('addAttachment', target.files)
    // Reset so picking the same file twice still fires a change event.
    target.value = ''
  }
}
</script>

<style scoped>
/*
  The footer's layout and states come from the ported official stylesheet
  (styles/official/footer.css). Only the icon sizing for codicon glyphs, which
  the official build renders as inline SVG, is set here.
*/
.fg-footer__footerButton .codicon,
.fg-footer__menuButton .codicon {
  font-size: 16px;
}

.fg-footer__selectionChip .codicon-close {
  font-size: 12px;
}
</style>
