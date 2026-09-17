<template>
  <!--
    The Claude Code composer, matched to the official implementation.

    Structure is not incidental. The container is a <form> wrapping a <fieldset>.
    Send is the form's submit button, so Enter works without a key handler.
    (The star-and-effort legend on the border was removed on request; effort is
    shown on the model pill instead.)

    The input is contenteditable="plaintext-only" and renders transparent text
    with a visible caret; the mirror underneath paints the same string with
    @-mentions wrapped in chips and the slash-command argument hint appended.
    Both use identical font, padding and line-height so the caret lands exactly
    on the painted glyph. That is how mentions get styled without putting markup
    inside a contenteditable, where the browser would let the user break it.
  -->
  <div class="fg-composer__inputWrapper">
    <div
      v-if="slashCompletion.isOpen.value || fileCompletion.isOpen.value"
      class="fg-composer__scrim"
      @mousedown="closeCompletions"
    />

    <form @submit.prevent="handleSubmit">
      <fieldset
        class="fg-composer__inputContainer"
        :data-permission-mode="permissionMode"
        :data-spark="isThinkingOn ? 'on' : undefined"
      >

        <div class="fg-composer__inputContainerBackground" />

        <div
          v-if="attachments && attachments.length > 0"
          class="fg-composer__attachedFilesContainer fg-composer__attachedFilesContainerAbove"
        >
          <div v-for="attachment in attachments" :key="attachment.id" class="fg-attachment">
            <FileIcon :file-name="attachment.fileName" :size="16" />
            <span class="fg-attachment__name">{{ attachment.fileName }}</span>
            <button
              class="fg-attachment__remove"
              type="button"
              :aria-label="`Remove ${attachment.fileName}`"
              @click.stop="handleRemoveAttachment(attachment.id)"
            >
              <span class="codicon codicon-close" />
            </button>
          </div>
        </div>

        <div class="fg-composer__messageInputContainer">
          <!-- plaintext-only, so a rich paste cannot inject markup the mirror
               would then fail to reproduce. -->
          <div
            ref="textareaRef"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Message input"
            aria-multiline="true"
            spellcheck="false"
            :aria-autocomplete="completionListId ? 'list' : undefined"
            :aria-controls="completionListId"
            class="fg-composer__messageInput custom-scroll-container"
            :data-placeholder="placeholderText"
            :data-has-suggestion="argumentHint ? 'true' : undefined"
            @input="handleInput"
            @keydown="handleKeydown"
            @paste="handlePaste"
            @dragover="handleDragOver"
            @drop="handleDrop"
          />

          <div class="fg-composer__mentionMirror" aria-hidden="true">
            <template v-for="(part, i) in mirrorParts" :key="i">
              <span v-if="part.mention" class="fg-composer__inputMentionChip">{{ part.text }}</span>
              <template v-else>{{ part.text }}</template>
            </template>
            <span v-if="argumentHint" class="fg-composer__argumentHint">{{ argumentHint }}</span>
          </div>
        </div>

        <ButtonArea
          ref="buttonAreaRef"
          :disabled="isSubmitDisabled"
          :loading="isLoading"
          :selected-model="selectedModel"
          :conversation-working="conversationWorking"
          :has-input-content="!!content.trim()"
          :show-progress="showProgress"
          :progress-percentage="progressPercentage"
          :context-tooltip="contextTooltip"
          :thinking-level="thinkingLevel"
          :permission-mode="permissionMode"
          :selection="currentSelection"
          :slash-commands="slashCommands"
          @stop="handleStop"
          @add-attachment="handleAddFiles"
          @mention="handleMention"
          @mention-selection="handleMentionSelection"
          @remove-selection="handleRemoveSelection"
          @insert-at-mention="insertAtCaret"
          @set-input="setInput"
          @send-command="sendCommand"
          @open-slash-commands="openCommandMenu"
          @thinking-toggle="emit('thinkingToggle')"
          @clear-conversation="emit('clearConversation')"
          @mode-select="(mode) => emit('modeSelect', mode)"
          @effort-select="handleEffortSelect"
          @model-select="(modelId) => emit('modelSelect', modelId)"
        />
      </fieldset>
    </form>

    <!-- Slash Command Dropdown -->
    <Dropdown
      v-if="slashCompletion.isOpen.value"
      :is-visible="slashCompletion.isOpen.value"
      :position="slashCompletion.position.value"
      :width="240"
      :should-auto-focus="false"
      :close-on-click-outside="false"
      :data-nav="slashCompletion.navigationMode.value"
      :selected-index="slashCompletion.activeIndex.value"
      :offset-y="-8"
      :offset-x="-8"
      :prefer-placement="'above'"
      @close="slashCompletion.close"
    >
      <template #content>
        <div @mouseleave="slashCompletion.handleMouseLeave">
          <template v-if="slashCompletion.items.value.length > 0">
            <template v-for="(item, index) in slashCompletion.items.value" :key="item.id">
              <DropdownItem
                :item="item"
                :index="index"
                :is-selected="index === slashCompletion.activeIndex.value"
                @click="slashCompletion.selectActive()"
                @mouseenter="slashCompletion.handleMouseEnter(index)"
              />
            </template>
          </template>
          <div v-else class="px-2 py-1 text-xs opacity-60">No matches</div>
        </div>
      </template>
    </Dropdown>

    <!-- @ 文件引用 Dropdown -->
    <Dropdown
      v-if="fileCompletion.isOpen.value"
      :is-visible="fileCompletion.isOpen.value"
      :position="fileCompletion.position.value"
      :width="320"
      :should-auto-focus="false"
      :close-on-click-outside="false"
      :data-nav="fileCompletion.navigationMode.value"
      :selected-index="fileCompletion.activeIndex.value"
      :offset-y="-8"
      :offset-x="-8"
      :prefer-placement="'above'"
      @close="fileCompletion.close"
    >
      <template #content>
        <div @mouseleave="fileCompletion.handleMouseLeave">
          <template v-if="fileCompletion.items.value.length > 0">
            <template v-for="(item, index) in fileCompletion.items.value" :key="item.id">
              <DropdownItem
                :item="item"
                :index="index"
                :is-selected="index === fileCompletion.activeIndex.value"
                @click="fileCompletion.selectActive()"
                @mouseenter="fileCompletion.handleMouseEnter(index)"
              >
                <template #icon v-if="'data' in item && item.data?.file">
                  <FileIcon
                    :file-name="item.data.file.name"
                    :is-directory="item.data.file.type === 'directory'"
                    :folder-path="item.data.file.path"
                    :size="16"
                  />
                </template>
              </DropdownItem>
            </template>
          </template>
          <div v-else class="px-2 py-1 text-xs opacity-60">No matches</div>
        </div>
      </template>
    </Dropdown>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, inject, onMounted, onUnmounted } from 'vue'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type { CliSlashCommand } from './forge/slashCommands'
import FileIcon from './FileIcon.vue'
import ButtonArea from './ButtonArea.vue'
import type { AttachmentItem } from '../types/attachment'
import { Dropdown, DropdownItem } from './Dropdown'
import { RuntimeKey } from '../composables/runtimeContext'
import { useCompletionDropdown } from '../composables/useCompletionDropdown'
import { getSlashCommands, commandToDropdownItem } from '../providers/slashCommandProvider'
import { firstRunBypassed, isMacPlatform } from '../utils/firstRun'
import { getFileReferences, fileToDropdownItem } from '../providers/fileReferenceProvider'

interface Props {
  showProgress?: boolean
  progressPercentage?: number
  contextTooltip?: string
  placeholder?: string
  readonly?: boolean
  showSearch?: boolean
  selectedModel?: string
  conversationWorking?: boolean
  attachments?: AttachmentItem[]
  thinkingLevel?: string
  permissionMode?: PermissionMode
  /** The CLI's init `commands`, for the command menu's Slash Commands section. */
  slashCommands?: CliSlashCommand[]
}

interface Emits {
  (e: 'submit', content: string): void
  (e: 'queueMessage', content: string): void
  (e: 'stop'): void
  (e: 'input', content: string): void
  (e: 'attach'): void
  (e: 'addAttachment', files: FileList): void
  (e: 'removeAttachment', id: string): void
  (e: 'thinkingToggle'): void
  (e: 'effortSelect', level: string): void
  (e: 'clearConversation'): void
  (e: 'modeSelect', mode: PermissionMode): void
  (e: 'modelSelect', modelId: string): void
}

const props = withDefaults(defineProps<Props>(), {
  showProgress: true,
  progressPercentage: 48.7,
  contextTooltip: '',
  placeholder: undefined,
  readonly: false,
  showSearch: false,
  selectedModel: 'default',
  conversationWorking: false,
  attachments: () => [],
  thinkingLevel: 'default_on',
  permissionMode: 'default'
})

const emit = defineEmits<Emits>()

const runtime = inject(RuntimeKey)
const buttonAreaRef = ref<InstanceType<typeof ButtonArea> | null>(null)

/**
 * The official placeholder, voiced as Forge: before the first message it invites
 * an edit; afterwards it names the focus shortcut; while a turn is running it
 * offers to queue the next message. An explicit placeholder prop wins.
 */
const placeholderText = computed(() => {
  if (props.placeholder) return props.placeholder
  if (props.conversationWorking) return 'Queue another message…'
  if (!firstRunBypassed.value) return 'Ask Forge to edit…'
  const shortcut = isMacPlatform(runtime?.appContext.platform) ? '⌘ Esc' : 'ctrl esc'
  return `${shortcut} to focus or unfocus Forge`
})

const content = ref('')
const isLoading = ref(false)
const textareaRef = ref<HTMLDivElement | null>(null)

/**
 * Split the raw input into plain runs and @-mention runs for the mirror.
 *
 * The contenteditable holds plain text only -- markup inside it would be
 * editable, and the browser would happily let the user split or delete a chip
 * halfway. Instead the chips are painted by the mirror, which re-derives them
 * from the same string on every keystroke.
 *
 * A mention is `@` plus a path: anything up to whitespace, allowing the usual
 * path punctuation plus an optional `#L1-2` line range.
 */
const MENTION_RE = /@[^\s@]+/g;

const mirrorParts = computed<Array<{ text: string; mention: boolean }>>(() => {
  const text = content.value;
  if (!text) return [];

  const parts: Array<{ text: string; mention: boolean }> = [];
  let last = 0;
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), mention: false });
    parts.push({ text: m[0], mention: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false });
  return parts;
});

/** Whether extended thinking is on, mirrored into the spark legend. */
const isThinkingOn = computed(() => props.thinkingLevel !== 'off')


/**
 * Trailing hint for a slash command whose arguments the user has not typed yet,
 * painted by the mirror after the caret. Only shown once the command name is
 * complete, so it does not flicker while the name is still being typed.
 */
const argumentHint = computed(() => {
  const text = content.value
  const match = /^\/(\S+)\s*$/.exec(text)
  if (!match) return ''
  const command = slashCompletion.items.value.find(
    (i: any) => i.label === '/' + match[1] || i.label === match[1]
  ) as any
  const hint = command?.data?.command?.argumentHint ?? command?.data?.argumentHint
  return hint && text.endsWith(' ') ? String(hint) : hint ? ' ' + String(hint) : ''
})

/**
 * The id of the open completion list, wired to aria-controls so a screen reader
 * announces the input as controlling it. Undefined when no menu is open, which
 * is also what removes aria-autocomplete.
 */
const completionListId = computed(() => {
  if (slashCompletion.isOpen.value) return 'forge-slash-completion'
  if (fileCompletion.isOpen.value) return 'forge-file-completion'
  return undefined
})

/** The editor selection, surfaced in the footer as a chip. */
const currentSelection = computed(() => runtime?.appContext.currentSelection() ?? undefined)

/** Clear the editor selection chip from the message. */
function handleRemoveSelection() {
  runtime?.appContext.currentSelection(undefined)
}

/** Open the slash-command menu, the way the footer's command button does. */
function openCommandMenu() {
  if (!textareaRef.value) return
  if (!content.value.startsWith('/')) {
    const updated = '/' + content.value
    content.value = updated
    textareaRef.value.textContent = updated
    placeCaretAtEnd(textareaRef.value)
    emit('input', updated)
  }
  slashCompletion.evaluateQuery(content.value)
  nextTick(() => textareaRef.value?.focus())
}

/**
 * Effort maps onto the session's thinking level. The menu offers a five-step
 * scale; the SDK only distinguishes off from on, so anything above off keeps
 * thinking enabled and the finer steps are carried as the level itself.
 */
function handleEffortSelect(level: string) {
  // Previously this discarded the level and toggled thinking, so choosing "High"
  // could switch thinking off. The level is the selection; pass it on.
  emit('effortSelect', level)
}

/**
 * Insert text at the end of the draft and focus it -- what the official "+"
 * menu's "Add context" ("@") and the command menu's slash rows do.
 */
function insertAtCaret(text: string) {
  if (!textareaRef.value) return
  const updated = content.value + text
  content.value = updated
  textareaRef.value.textContent = updated
  placeCaretAtEnd(textareaRef.value)
  emit('input', updated)
  if (text === '@') fileCompletion.evaluateQuery?.(updated)
  if (text.startsWith('/')) slashCompletion.evaluateQuery(updated)
  nextTick(() => textareaRef.value?.focus())
}

/** Replace the whole draft and put the caret at the end (official `D0`). */
function setInput(text: string) {
  if (!textareaRef.value) return
  content.value = text
  textareaRef.value.textContent = text
  placeCaretAtEnd(textareaRef.value)
  emit('input', text)
  nextTick(() => textareaRef.value?.focus())
}

/**
 * Send a command as its own message, leaving the draft alone (official `W5`, run
 * by a Slash Commands row). Like a normal submit, it queues while a turn runs.
 */
function sendCommand(text: string) {
  if (props.conversationWorking) emit('queueMessage', text)
  else emit('submit', text)
}

function closeCompletions() {
  slashCompletion.close()
  fileCompletion.close()
}

/** Insert an @-mention for the current editor selection. */
function handleMentionSelection() {
  const sel = currentSelection.value
  if (!sel?.filePath) return
  // Line numbers are 1-based in the mention so they match what the editor shows.
  const range = sel.startLine === sel.endLine
    ? `#L${sel.startLine + 1}`
    : `#L${sel.startLine + 1}-${sel.endLine + 1}`
  handleMention(`${sel.filePath}${range}`)
}

const isSubmitDisabled = computed(() => {
  return !content.value.trim() || isLoading.value
})

// === 使用新的 Completion Dropdown Composable ===

// Slash Command 补全
const slashCompletion = useCompletionDropdown({
  mode: 'inline',
  trigger: '/',
  provider: (query, signal) => getSlashCommands(query, runtime, signal),
  toDropdownItem: commandToDropdownItem,
  onSelect: (command, query) => {
    if (query) {
      // 替换文本
      const updated = slashCompletion.replaceText(content.value, `${command.label} `)
      content.value = updated

      // 更新 DOM
      if (textareaRef.value) {
        textareaRef.value.textContent = updated
        placeCaretAtEnd(textareaRef.value)
      }

      // 触发输入事件
      emit('input', updated)
    }
  },
  anchorElement: textareaRef
})

// @ 文件引用补全
const fileCompletion = useCompletionDropdown({
  mode: 'inline',
  trigger: '@',
  provider: (query, signal) => getFileReferences(query, runtime, signal),
  toDropdownItem: fileToDropdownItem,
  onSelect: (file, query) => {
    if (query) {
      // 替换文本，插入文件路径
      const updated = fileCompletion.replaceText(content.value, `@${file.path} `)
      content.value = updated

      // 更新 DOM
      if (textareaRef.value) {
        textareaRef.value.textContent = updated
        placeCaretAtEnd(textareaRef.value)
      }

      // 触发输入事件
      emit('input', updated)
    }
  },
  anchorElement: textareaRef
})

// 将光标移至末尾
function placeCaretAtEnd(node: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(node)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

// 获取光标的客户端矩形
function getCaretClientRect(editable: HTMLElement | null): DOMRect | undefined {
  if (!editable) return undefined

  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return undefined

  const range = sel.getRangeAt(0).cloneRange()
  if (!editable.contains(range.startContainer)) return undefined

  // collapsed range 一般有 0 宽度，但有行高；用 getClientRects 优先
  const rects = range.getClientRects()
  const rect = rects[0] || range.getBoundingClientRect()
  if (!rect) return undefined

  // 兜底行高，避免 0 高导致 Dropdown 内部计算异常
  const lh = parseFloat(getComputedStyle(editable).lineHeight || '0') || 16
  const height = rect.height || lh

  return new DOMRect(rect.left, rect.top, rect.width, height)
}

// 根据字符偏移获取矩形（用于锚定在触发词开头）
function getRectAtCharOffset(editable: HTMLElement, charOffset: number): DOMRect | undefined {
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT)
  let remaining = charOffset
  let node: Text | null = null

  while ((node = walker.nextNode() as Text | null)) {
    const len = node.textContent?.length ?? 0
    if (remaining <= len) {
      const range = document.createRange()
      range.setStart(node, Math.max(0, remaining))
      range.collapse(true)
      const rects = range.getClientRects()
      const rect = rects[0] || range.getBoundingClientRect()
      const lh = parseFloat(getComputedStyle(editable).lineHeight || '0') || 16
      const height = rect.height || lh
      return new DOMRect(rect.left, rect.top, rect.width, height)
    }
    remaining -= len
  }

  return undefined
}

// 更新 dropdown 位置
function updateDropdownPosition(
  completion: typeof slashCompletion | typeof fileCompletion,
  anchor: 'caret' | 'queryStart' = 'queryStart'
) {
  const el = textareaRef.value
  if (!el) return

  let rect: DOMRect | undefined

  // 优先锚定在触发词开头
  if (anchor === 'queryStart' && completion.triggerQuery.value) {
    rect = getRectAtCharOffset(el, completion.triggerQuery.value.start)
  }

  // 兜底：锚定在光标位置
  if (!rect && anchor === 'caret') {
    rect = getCaretClientRect(el)
  }

  // 最终兜底：使用输入框自身矩形
  if (!rect) {
    const r = el.getBoundingClientRect()
    rect = new DOMRect(r.left, r.top, r.width, r.height)
  }

  completion.updatePosition({
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height
  })
}

function handleInput(event: Event) {
  const target = event.target as HTMLDivElement
  const textContent = target.textContent || ''

  // 只有在完全没有内容时才清理 div
  if (textContent.length === 0) {
    target.innerHTML = ''
  }

  content.value = textContent
  emit('input', textContent)

  // 评估补全（slash 和 @）
  slashCompletion.evaluateQuery(textContent)
  fileCompletion.evaluateQuery(textContent)

  // 更新 dropdown 位置（锚定在触发词开头）
  if (slashCompletion.isOpen.value) {
    nextTick(() => {
      updateDropdownPosition(slashCompletion, 'queryStart')
    })
  }
  if (fileCompletion.isOpen.value) {
    nextTick(() => {
      updateDropdownPosition(fileCompletion, 'queryStart')
    })
  }

  // 自适应高度
  autoResizeTextarea()
}

function autoResizeTextarea() {
  if (!textareaRef.value) return

  // The official sizes the input with CSS alone -- min-height 1.5em, max-height
  // 200px, scrolling past that -- so an empty composer is one line tall. The inline
  // height this used to set came from scrollHeight, which already includes the
  // input's padding, and so held the empty box a padding's height too tall.
  const divElement = textareaRef.value
  divElement.style.height = ''
  divElement.style.overflowY = ''
}

function handleKeydown(event: KeyboardEvent) {
  // 优先处理补全菜单的键盘事件
  if (slashCompletion.isOpen.value) {
    slashCompletion.handleKeydown(event)
    return
  }

  // 处理文件引用补全的键盘事件
  if (fileCompletion.isOpen.value) {
    fileCompletion.handleKeydown(event)
    return
  }

  // 其他按键处理
  if (event.key === 'Enter' && !event.shiftKey) {
    // 检查是否正在输入法组合状态(中文输入法等)
    if (event.isComposing) {
      return
    }
    event.preventDefault()
    handleSubmit()
  }

  // 延迟检查内容是否为空（在按键处理后）
  if (event.key === 'Backspace' || event.key === 'Delete') {
    setTimeout(() => {
      const target = event.target as HTMLDivElement
      const textContent = target.textContent || ''
      if (textContent.length === 0) {
        target.innerHTML = ''
        content.value = ''
      }
    }, 0)
  }
}

function handlePaste(event: ClipboardEvent) {
  const clipboard = event.clipboardData
  if (!clipboard) {
    return
  }

  const items = clipboard.items
  if (!items || items.length === 0) {
    return
  }

  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) {
        files.push(file)
      }
    }
  }

  if (files.length > 0) {
    event.preventDefault()
    // 创建 FileList-like 对象
    const dataTransfer = new DataTransfer()
    for (const file of files) {
      dataTransfer.items.add(file)
    }
    // 触发附件添加
    handleAddFiles(dataTransfer.files)
  }
}

function getWorkspaceRoot(): string | undefined {
  const r = runtime as any
  if (!r) return undefined

  try {
    const sessionStore = r.sessionStore
    const activeSession = sessionStore?.activeSession?.()
    const cwdFromSession = activeSession?.cwd?.()
    if (typeof cwdFromSession === 'string' && cwdFromSession) {
      return cwdFromSession
    }
  } catch {
    // ignore
  }

  try {
    const connection = r.connectionManager?.connection?.()
    const config = connection?.config?.()
    if (config?.defaultCwd && typeof config.defaultCwd === 'string') {
      return config.defaultCwd
    }
  } catch {
    // ignore
  }

  return undefined
}

function toWorkspaceRelativePath(absoluteOrMixedPath: string): string {
  const root = getWorkspaceRoot()
  if (!root) return absoluteOrMixedPath

  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  let normPath = absoluteOrMixedPath.replace(/\\/g, '/')

  // 处理 Windows 上 file:// URI 转换后形如 /C:/ 的情况
  if (normPath.startsWith('/') && /^[A-Za-z]:\//.test(normPath.slice(1))) {
    normPath = normPath.slice(1)
  }

  if (normPath === normRoot) {
    return ''
  }

  if (normPath.startsWith(normRoot + '/')) {
    return normPath.slice(normRoot.length + 1)
  }

  return absoluteOrMixedPath
}

function isFileDrop(event: DragEvent): boolean {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return false

  const types = Array.from(dataTransfer.types || [])
  if (types.includes('Files')) return true
  if (types.includes('text/uri-list')) return true

  return false
}

function extractFilePathsFromDataTransfer(dataTransfer: DataTransfer): string[] {
  const paths: string[] = []

  const uriList = dataTransfer.getData('text/uri-list')
  if (uriList) {
    const lines = uriList
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))

    for (const line of lines) {
      try {
        const url = new URL(line)
        if (url.protocol === 'file:') {
          const decodedPath = decodeURIComponent(url.pathname)
          paths.push(toWorkspaceRelativePath(decodedPath))
        } else {
          paths.push(toWorkspaceRelativePath(line))
        }
      } catch {
        paths.push(toWorkspaceRelativePath(line))
      }
    }
  }

  if (paths.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
    for (const file of Array.from(dataTransfer.files)) {
      const fileWithPath = file as File & { path?: string }
      if (fileWithPath.path) {
        paths.push(toWorkspaceRelativePath(fileWithPath.path))
      } else {
        paths.push(toWorkspaceRelativePath(file.name))
      }
    }
  }

  return paths
}

async function statPaths(
  paths: string[]
): Promise<Record<string, 'file' | 'directory' | 'other' | 'not_found'>> {
  const result: Record<string, 'file' | 'directory' | 'other' | 'not_found'> = {}
  if (!paths.length) return result

  const r = runtime as any
  if (!r) return result

  try {
    const connection = await r.connectionManager.get()
    const response = await connection.statPaths(paths)
    const entries = (response?.entries ?? []) as Array<{ path: string; type: any }>
    for (const entry of entries) {
      if (!entry || typeof entry.path !== 'string') continue
      const t = entry.type
      if (t === 'file' || t === 'directory' || t === 'other' || t === 'not_found') {
        result[entry.path] = t
      }
    }
  } catch (error) {
    console.warn('[ChatInputBox] statPaths failed:', error)
  }

  return result
}

function handleDragOver(event: DragEvent) {
  // 仅在按住 Shift 且为文件/URI 拖拽时拦截，避免干扰普通文本拖拽
  if (!event.shiftKey) return
  if (!isFileDrop(event)) return

  event.preventDefault()
}

async function handleDrop(event: DragEvent) {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return

  // 按住 Shift 时，将资源管理器文件拖入视为“插入路径”
  if (!event.shiftKey) return
  if (!isFileDrop(event)) return

  event.preventDefault()

  const paths = extractFilePathsFromDataTransfer(dataTransfer)
  if (paths.length === 0) return

  const types = await statPaths(paths)

  const mentionText = paths
    .map(p => {
      const t = types[p]
      const isDir = t === 'directory'
      const normalized = isDir && !p.endsWith('/') ? `${p}/` : p
      return `@${normalized}`
    })
    .join(' ')

  const baseContent = content.value.trimEnd()
  const updatedContent = baseContent ? `${baseContent} ${mentionText} ` : `${mentionText} `

  content.value = updatedContent

  if (textareaRef.value) {
    textareaRef.value.textContent = updatedContent
    placeCaretAtEnd(textareaRef.value)
  }

  emit('input', updatedContent)
  autoResizeTextarea()

  nextTick(() => {
    textareaRef.value?.focus()
  })
}

function handleSubmit() {
  if (!content.value.trim()) return

  if (props.conversationWorking) {
    // 对话工作中，添加到队列
    emit('queueMessage', content.value)
  } else {
    // 对话未工作，直接发送
    emit('submit', content.value)
  }

  // 清空输入框
  content.value = ''
  if (textareaRef.value) {
    textareaRef.value.textContent = ''
  }

  // 等待 DOM 更新后重置输入框高度
  nextTick(() => {
    autoResizeTextarea()
  })
}

function handleStop() {
  emit('stop')
}

function handleMention(filePath?: string) {
  if (!filePath) return

  // 在光标位置插入 @文件路径
  const updatedContent = content.value + `@${filePath} `
  content.value = updatedContent

  // 更新 DOM
  if (textareaRef.value) {
    textareaRef.value.textContent = updatedContent
    placeCaretAtEnd(textareaRef.value)
  }

  // 触发输入事件
  emit('input', updatedContent)

  // 自动聚焦到输入框
  nextTick(() => {
    textareaRef.value?.focus()
  })
}

function handleAddFiles(files: FileList) {
  emit('addAttachment', files)
}

function handleRemoveAttachment(id: string) {
  emit('removeAttachment', id)
}

// 监听光标位置变化（仅在下拉菜单已打开时更新位置，避免重复触发请求）
function handleSelectionChange() {
  if (!content.value || !textareaRef.value) return

  // 仅在下拉菜单已打开时更新位置
  // 避免重复调用 evaluateQuery（已在 handleInput 中调用）
  if (slashCompletion.isOpen.value) {
    nextTick(() => {
      updateDropdownPosition(slashCompletion, 'queryStart')
    })
  }
  if (fileCompletion.isOpen.value) {
    nextTick(() => {
      updateDropdownPosition(fileCompletion, 'queryStart')
    })
  }
}

// 添加/移除 selectionchange 监听
onMounted(() => {
  document.addEventListener('selectionchange', handleSelectionChange)
})

onUnmounted(() => {
  document.removeEventListener('selectionchange', handleSelectionChange)
})

// 暴露方法：供父组件设置内容与聚焦
defineExpose({
  /** 设置输入框内容并同步内部状态 */
  setContent(text: string) {
    content.value = text || ''
    if (textareaRef.value) {
      textareaRef.value.textContent = content.value
    }
    autoResizeTextarea()
  },
  /** 聚焦到输入框 */
  focus() {
    nextTick(() => textareaRef.value?.focus())
  },
  /** 取消输入框聚焦，把焦点交还给编辑器 */
  blur() {
    textareaRef.value?.blur()
  },
  /** Focus the input and type text at the caret, so triggers like @ open their menus. */
  insertText(text: string) {
    nextTick(() => {
      textareaRef.value?.focus()
      insertAtCaret(text)
    })
  },
  /** Open the / menu. */
  openActionsMenu() {
    buttonAreaRef.value?.openCommandMenu()
  }
})

</script>

<style scoped>
/*
  Layout, spacing and states for the composer come from the ported official
  stylesheet (styles/official/composer.css), so nothing is restated here. What
  remains is only the attachment row, which the official build renders from a
  separate module.
*/
.fg-composer__attachedFilesContainer {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 6px 0;
}

.fg-attachment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  padding: 2px 4px 2px 6px;
  border: 1px solid var(--app-input-border);
  border-radius: var(--corner-radius-small);
  background: var(--app-input-background);
  font-size: 0.85em;
}

.fg-attachment__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fg-attachment__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--corner-radius-small);
  background: transparent;
  color: var(--app-secondary-foreground);
  cursor: pointer;
}

.fg-attachment__remove:hover {
  background: var(--app-ghost-button-hover-background);
  color: var(--app-primary-foreground);
}

.fg-attachment__remove .codicon {
  font-size: 12px;
}
</style>
