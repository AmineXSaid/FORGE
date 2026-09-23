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
      :browser-integration-supported="browserIntegrationSupported"
      @attach-file="handleAttachClick"
      @insert-at-mention="(text) => emit('insertAtMention', text)"
    />
    <input ref="fileInputRef" type="file" multiple style="display: none" @change="handleFileUpload" />

    <button
      type="button"
      class="fg-footer__menuButton"
      title="Show command menu (/)"
      aria-haspopup="listbox"
      :aria-expanded="commandMenuOpen"
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

    <Transition name="forge-pop">
      <CommandMenu
        v-if="commandMenuOpen"
        :commands="menuCommands"
        :version="FORGE_VERSION"
        @run="runCommand"
        @effort="(level) => emit('effortSelect', level)"
        @ultracode="emit('ultracodeSelect')"
        @close="commandMenuOpen = false"
      />
    </Transition>

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
        <ForgeSendIcon v-else />
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
import ForgeSendIcon from './forge/icons/ForgeSendIcon.vue'
import SelectionIcon from './forge/icons/SelectionIcon.vue'
import ModelSelect from './ModelSelect.vue'
import AddMenu from './forge/AddMenu.vue'
import CommandMenu, { type MenuCommand } from './forge/CommandMenu.vue'
import { NO_EFFORT, effortRowSuffix, nextEffortPick, type EffortState } from './forge/effort'
import { slashCommandRows, slashCommandSelection, type CliSlashCommand } from './forge/slashCommands'
import type { ModelRow } from './forge/modelCatalog'
import { FAST_MODE_LAUNCH, fastModeRows } from './forge/fastMode'
import { transport, runHostAction } from '../core/runtimeTransport'
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
  /** The official `currentModelSupportsFastMode`: gates "Toggle fast mode". */
  supportsFastMode?: boolean
  /** The official `browserIntegrationSupported`: gates "Browse the web" (step 28). */
  browserIntegrationSupported?: boolean
  /** The official `focusViewEnabled`: the Focus view row's toggle state (step 30). */
  focusViewEnabled?: boolean
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
  /** "/" → Output styles: open the picker and refresh it from the CLI (step 29). */
  (e: 'openOutputStyles'): void
  /** "/" → Focus view: `setFocusView(!enabled)`, menu stays open (step 30). */
  (e: 'focusViewToggle'): void
  /** "/" → Permissions: the official opens the "Permission rules" dialog (`kU0`). */
  (e: 'openPermissionRules'): void
  /** "/" → Rewind: the official mounts the "Rewind to…" picker (`yH0`), step 25. */
  (e: 'openRewind'): void
  /** "/" → Resume conversation: the same state the header clock toggles, step 26. */
  (e: 'openSessions'): void
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
  supportsFastMode: false,
  browserIntegrationSupported: false,
  focusViewEnabled: false,
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
 * what Forge can actually do. Official rows Forge has no backend for (Account &
 * usage, Switch account, Remote Control, flagged-message model switching) are
 * not registered, exactly as the official skips rows its host cannot serve.
 * Effort and "Toggle fast mode" come and go with the model.
 */
const menuCommands = computed<MenuCommand[]>(() => {
  const effort = props.effort
  const rows: MenuCommand[] = [
    { id: 'attach-file', label: 'Attach file…', description: 'Upload a file to include in conversation', section: 'Context' },
    { id: 'mention-file', label: 'Mention file from this project…', description: 'Reference a project file with @mention', section: 'Context' },
    // Registered right after `mention-file`, as the official does: its own
    // effect (the composer's) registers attach / mention / rewind into Context,
    // and the chat page's later effect adds clear / new / resume after them.
    { id: 'rewind', label: 'Rewind', description: 'Restore code and conversation to an earlier point', section: 'Context' },
    { id: 'clear-conversation', label: 'Clear conversation', description: 'Start a new conversation', section: 'Context' },
    { id: 'new-conversation', label: 'New conversation', description: 'Open a new conversation in a new tab', section: 'Context', filterOnly: true },
    // Verbatim from the registry (step 26):
    //   registerAction({id:"resume-conversation",label:"Resume conversation",
    //     description:"Continue a previous conversation",filterOnly:!0},"Context",()=>{z(!0)})
    // `z(!0)` is the same state the header's history button toggles, so the row
    // opens the existing dropdown rather than a second surface.
    { id: 'resume-conversation', label: 'Resume conversation', description: 'Continue a previous conversation', section: 'Context', filterOnly: true },
    { id: 'model', label: 'Switch model…', description: 'Change the AI model', section: 'Model', trailing: modelLabel.value ? 'text' : undefined, trailingText: modelLabel.value },
    // The official unregisters "effort-level" for a model without effort.
    ...(effort.supported
      ? [{ id: 'effort-level', label: 'Effort', labelSuffix: effortRowSuffix(effort.level, effort.ultracodeSelected), description: 'Set how hard the model tries', section: 'Model', trailing: 'effort', effortLevel: effort.level, effortLevels: effort.levels, showUltracode: effort.ultracodeAvailable, ultracodeSelected: effort.ultracodeSelected, keepMenuOpen: true } satisfies MenuCommand]
      : []),
    { id: 'toggle-thinking', label: 'Thinking', description: 'Toggle extended thinking mode', section: 'Model', trailing: 'toggle', isOn: props.thinkingLevel !== 'off', keepMenuOpen: true },
    // After the ids the official Model-section sort knows, as its registry puts it.
    ...fastModeRows(props.supportsFastMode),
    // Registered by the composer's own effect (`RH0`), so it comes before the
    // chat page's Customize rows, exactly as `attach-file` precedes `clear-
    // conversation` in Context:
    //   $.commandRegistry.registerAction({id:"output-style",label:"Output styles",
    //     description:"Change response formatting style"},"Customize",Z)
    // and `Z` is `()=>{Y1(!0),J.refreshOutputStyleForPicker()}` -- open the
    // picker, then ask the CLI what it has. The menu closes (no keepMenuOpen).
    { id: 'output-style', label: 'Output styles', description: 'Change response formatting style', section: 'Customize' },
    { id: 'mcp-config', label: 'MCP servers', description: 'Configure Model Context Protocol servers', section: 'Customize' },
    { id: 'hooks-config', label: 'Hooks', description: 'View and edit hooks', section: 'Customize' },
    { id: 'permission-rules', label: 'Permissions', description: 'View and edit permission rules', section: 'Customize' },
    // Forge-only: the official has no endpoint concept, so there is no row to
    // match. It sits in Customize beside MCP and Hooks because it is the same
    // kind of thing -- where the session's capabilities come from.
    { id: 'endpoints', label: 'Endpoints', description: 'Use a custom or self-hosted model endpoint', section: 'Customize' },
    { id: 'browse-slash-commands', label: 'Slash commands', description: 'Browse slash commands', section: 'Customize' },
    { id: 'plugins', label: 'Manage plugins', description: 'Install, enable, or disable plugins', section: 'Customize' },
    { id: 'terminal', label: 'Open Forge in Terminal', description: 'Open a new Forge instance in the Terminal', section: 'Customize', trailing: 'terminal' },
    // Verbatim from the registry (step 30):
    //   registerAction({id:"toggle-focus-view",label:"Focus view",
    //     description:"Show only your prompts and Claude's responses",
    //     trailingComponent:F(Xj,{isOn:q1}),keepMenuOpen:!0},"Settings",
    //     ()=>{J.setFocusView(!q1)…})
    { id: 'toggle-focus-view', label: 'Focus view', description: 'Show only your prompts and Forge’s responses', section: 'Settings', trailing: 'toggle', isOn: props.focusViewEnabled, keepMenuOpen: true },
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
    // The official row's action is `z0(!0)`, which mounts the `yH0` picker.
    case 'rewind': return emit('openRewind')
    case 'clear-conversation': return emit('clearConversation')
    case 'new-conversation': return runHostAction('open a new conversation', () => transport.startNewConversationTab())
    // The official row's action is `z(!0)`: open past conversations.
    case 'resume-conversation': return emit('openSessions')
    case 'model': return modelSelectRef.value?.openMenu()
    case 'effort-level': {
      // Clicking the row (not the slider) cycles, like the official registry row.
      const e = props.effort
      const pick = nextEffortPick(e.levels, e.level, e.ultracodeAvailable, e.ultracodeSelected)
      return pick.kind === 'ultracode' ? emit('ultracodeSelect') : emit('effortSelect', pick.level)
    }
    case 'toggle-thinking': return emit('thinkingToggle')
    // The official row: `claude /fast` in a bottom terminal (step 09's request).
    case 'fast': return runHostAction('open Forge in the terminal', () => transport.openClaudeInTerminal(FAST_MODE_LAUNCH.prompt, [...FAST_MODE_LAUNCH.args], FAST_MODE_LAUNCH.location))
    // The official row opens the "Permission rules" dialog (step 16).
    case 'permission-rules': return emit('openPermissionRules')
    // Forge keeps MCP, hooks, plugins, endpoints and the slash-command browser
    // on its own Settings page. Step 31 gave each row the tab it actually means,
    // through a typed request: the webview names a tab, never a VS Code command.
    // A row that opens Settings on General is the "live but unfinished" defect
    // CLAUDE.md names -- it opens something, just not the thing it says.
    //
    // Every one goes through `runHostAction`, because a row whose request the
    // host rejects used to close the menu and do nothing visible at all.
    case 'mcp-config': return runHostAction('open MCP Servers', () => transport.openForgeSettings('mcp-servers'))
    case 'hooks-config': return runHostAction('open Hooks', () => transport.openForgeSettings('hooks'))
    case 'plugins': return runHostAction('open Plugins', () => transport.openForgeSettings('plugins'))
    case 'endpoints': return runHostAction('open Endpoints', () => transport.openForgeSettings('endpoints'))
    case 'browse-slash-commands': return runHostAction('open Slash Commands', () => transport.openForgeSettings('slash-commands'))
    case 'output-style': return emit('openOutputStyles')
    // The row toggles and the menu stays open, as `keepMenuOpen` says.
    case 'toggle-focus-view': return emit('focusViewToggle')
    // The official row passes exactly this: no prompt, no args, the panel.
    case 'terminal': return runHostAction('open Forge in the terminal', () => transport.openClaudeInTerminal(undefined, undefined, 'bottom'))
    // Step 32: typed, so the webview names neither a VS Code command nor a URL.
    // Both official rows call these with no argument, and so do these.
    case 'config': return runHostAction('open the Forge configuration', () => transport.openConfig())
    case 'help': return runHostAction('open the help docs', () => transport.openHelp())
  }
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
