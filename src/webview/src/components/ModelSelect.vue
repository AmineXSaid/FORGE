<template>
  <!--
    The official model picker (reference modules G8AMvA + G_S7FQ).

    Two roots on purpose, matching the official markup: the pill and the popup
    are siblings inside the footer, not a trigger wrapped in a positioned
    container. That is load bearing -- `.fg-commandmenu__menuPopup` is
    `position:absolute; left:0; right:0; bottom:100%`, so it resolves against
    `.fg-composer__inputContainer` and spans the whole composer above it. Wrap it
    in a `position:relative` container and the popup collapses to the pill's
    width instead.

    The rows are a `role="listbox"` of `role="option"` items, which is what the
    official uses -- not the mode menu's `menuItem` buttons this component was
    previously built from.
  -->
  <button
    ref="pillEl"
    type="button"
    class="fg-footer__modelPill"
    :title="`Switch model (${selectedModelLabel})`"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="open ? listboxId : undefined"
    :aria-activedescendant="open && activeModel ? optionId(activeModel) : undefined"
    @click="open = !open"
  >
    <span class="fg-footer__modelPillLabel">{{ pillModelName }}</span>
    <span class="fg-footer__modelPillEffort"> <span :class="effortTone">{{ pillEffortLabel }}</span></span>
  </button>

  <div v-if="open" ref="popupEl" class="fg-commandmenu__menuPopup">
    <!-- The official reserves 4px here, where the command palette puts its filter row. -->
    <div style="height: 4px"></div>
    <div class="fg-commandmenu__commandList">
      <div v-if="!availableModels.length" class="fg-modelmenu__emptyState">No models available</div>
      <div v-else :id="headerId" class="fg-commandmenu__sectionHeader">Select a model</div>
      <div
        :id="listboxId"
        role="listbox"
        class="fg-modelmenu__listbox"
        :aria-labelledby="availableModels.length ? headerId : undefined"
        :aria-label="availableModels.length ? undefined : 'Select a model'"
      >
        <div
          v-for="model in availableModels"
          :key="model.id"
          :id="optionId(model.id)"
          class="fg-modelmenu__modelItem"
          :class="{ 'fg-modelmenu__activeModelItem': activeModel === model.id }"
          role="option"
          :aria-selected="selectedModel === model.id"
          @mousemove="activeModel = model.id"
          @click="selectModel(model.id)"
        >
          <div class="fg-modelmenu__modelContent">
            <span class="fg-modelmenu__modelLabel">{{ model.label }}</span>
            <span v-if="model.description" class="fg-modelmenu__modelDescription">{{
              model.description
            }}</span>
          </div>
          <div class="fg-modelmenu__checkIcon">
            <CheckIcon v-if="selectedModel === model.id" />
          </div>
        </div>
      </div>
    </div>
    <div class="fg-modelmenu__effortSection">
      <!-- A rule separates the models from the effort that applies to them. -->
      <div class="fg-menu__menuDivider"></div>
      <div
        class="fg-commandmenu__commandItem"
        title="Set how hard the model tries"
        @click="cycleEffort"
      >
        <div class="fg-commandmenu__commandContent">
          <span class="fg-commandmenu__commandLabel fg-menu__effortLabel"
            ><EffortIcon />Effort<span style="color: var(--app-secondary-foreground); margin-left: 4px"
              >(<span :class="effortTone">{{ pillEffortLabel }}</span>)</span
            ></span
          >
        </div>
        <EffortSlider
          :level="currentEffort"
          :levels="EFFORT_LEVELS"
          @select="(level) => emit('effortSelect', level)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import CheckIcon from './forge/icons/CheckIcon.vue'
import EffortSlider from './forge/EffortSlider.vue'
import EffortIcon from './forge/icons/EffortIcon.vue'
import { EFFORT_LEVELS, effortLabel, effortToneClass, levelFromThinking } from './forge/effort'
import { transport } from '../core/runtimeTransport'

interface Props {
  selectedModel?: string
  /** Thinking level, shown beside the model name as the official effort badge. */
  thinkingLevel?: string
}

interface Emits {
  (e: 'modelSelect', modelId: string): void
  (e: 'effortSelect', level: string): void
  /** The selected model's display name, for the command menu's "Switch model..." row. */
  (e: 'modelLabel', label: string): void
}

const props = withDefaults(defineProps<Props>(), {
  selectedModel: 'default',
  thinkingLevel: 'default_on'
})

/**
 * Effort badge text. The official pill shows the level only when thinking is
 * actually on, so the pill stays quiet in the common case.
 */
/**
 * Effort shown beside the model name. The official pill always carries it --
 * "Sonnet 5 Extra high" -- because effort is half of what a turn will cost, so
 * hiding it at the common setting is exactly when you would want to see it.
 */
const pillEffortLabel = computed(() => effortLabel(levelFromThinking(props.thinkingLevel)))
const effortTone = computed(() => effortToneClass(levelFromThinking(props.thinkingLevel)))

const emit = defineEmits<Emits>()

// ── Data sources (all loaded via transport, no SettingsStore dependency) ──

interface CustomModel {
  id: string
  name?: string
}

interface SdkModel {
  value: string
  displayName: string
  description?: string
}

const sdkModels = ref<SdkModel[]>([])
const customModels = ref<CustomModel[]>([])
const disabledModels = ref<string[]>([])

onMounted(async () => {
  try {
    // Load extension config and SDK models in parallel
    const [configRes, sdkRes] = await Promise.all([
      transport.getExtensionConfig(),
      transport.sdkProbe(['supportedModels'], 10000).catch(() => null),
    ])

    if (configRes?.config) {
      customModels.value = configRes.config.customModels ?? []
      disabledModels.value = configRes.config.disabledModels ?? []
    }

    if (sdkRes?.data?.supportedModels) {
      // Filter out the 'Custom model' pseudo-entry from SDK results
      sdkModels.value = sdkRes.data.supportedModels.filter(
        (m: SdkModel) => m.description !== 'Custom model'
      )
    }
  } catch (e) {
    console.error('Failed to load model config:', e)
  }
})

// ── Listen for config changes from settings page ──

const unsubConfigChanged = transport.extensionConfigChanged.add(({ key, value }) => {
  if (key === 'customModels') {
    customModels.value = value ?? []
  } else if (key === 'disabledModels') {
    disabledModels.value = value ?? []
  }
})

onUnmounted(() => {
  unsubConfigChanged()
})

// ── Static aliases ──

const MODEL_ALIASES: Array<{ id: string; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
]

// ── Available models: aliases + SDK + custom, minus disabled ──

const availableModels = computed(() => {
  const disabledSet = new Set(disabledModels.value)
  const seenIds = new Set<string>()
  const result: Array<{ id: string; label: string; description?: string }> = []

  // 0. When the SDK reports its models, list them in the SDK's order -- that is
  //    the list and order the official picker shows (Default, Sonnet, Fable,
  //    Opus, Haiku). The static aliases below are only the offline fallback.
  if (sdkModels.value.length) {
    for (const m of sdkModels.value) {
      if (disabledSet.has(m.value) || seenIds.has(m.value)) continue
      result.push({ id: m.value, label: m.displayName, description: m.description })
      seenIds.add(m.value)
    }
  }

  // 1. Static aliases. The description comes from the SDK entry for the same
  //    id when we have one, so an alias row reads like its concrete model.
  for (const alias of MODEL_ALIASES) {
    if (!disabledSet.has(alias.id) && !seenIds.has(alias.id)) {
      const sdk = sdkModels.value.find((m) => m.value === alias.id)
      result.push({ ...alias, label: sdk?.displayName ?? alias.label, description: sdk?.description })
      seenIds.add(alias.id)
    }
  }

  // 2. SDK probed models
  for (const m of sdkModels.value) {
    if (!seenIds.has(m.value) && !disabledSet.has(m.value)) {
      result.push({ id: m.value, label: m.displayName, description: m.description })
      seenIds.add(m.value)
    }
  }

  // 3. Custom models
  for (const cm of customModels.value) {
    if (!seenIds.has(cm.id) && !disabledSet.has(cm.id)) {
      result.push({ id: cm.id, label: cm.name || cm.id })
      seenIds.add(cm.id)
    }
  }

  return result
})

// ── Label for trigger display ──

const selectedModelLabel = computed(() => {
  const found = availableModels.value.find((m) => m.id === props.selectedModel)
  if (found) return found.label

  // Fallback: check all sources even if disabled
  const alias = MODEL_ALIASES.find((a) => a.id === props.selectedModel)
  if (alias) return alias.label

  const sdk = sdkModels.value.find((m) => m.value === props.selectedModel)
  if (sdk) return sdk.displayName.replace(/\s*\(recommended\)\s*$/i, '')

  const custom = customModels.value.find((m) => m.id === props.selectedModel)
  if (custom) return custom.name || custom.id

  // Last resort: show raw id
  return props.selectedModel || 'Select model'
})

// ---- Pill and effort, matching the official footer ----

/**
 * The official pill names the model that will serve the turn ("Sonnet 5"), not
 * the alias ("Default"). The SDK description carries it as its first segment:
 * "Sonnet 5 · Efficient for routine tasks".
 */
const pillModelName = computed(() => {
  const sdk = sdkModels.value.find((m) => m.value === props.selectedModel)
  const head = sdk?.description?.split(/\s+[·-]\s+/)[0]?.trim()
  return head || selectedModelLabel.value.replace(/\s*\(recommended\)\s*$/i, '')
})

const currentEffort = computed(() => levelFromThinking(props.thinkingLevel))

/** Clicking the Effort row (not the slider) steps to the next level, like the official. */
function cycleEffort(): void {
  const at = (EFFORT_LEVELS as readonly string[]).indexOf(currentEffort.value ?? 'medium')
  emit('effortSelect', EFFORT_LEVELS[(at + 1) % EFFORT_LEVELS.length])
}

watch(selectedModelLabel, (label) => emit('modelLabel', label), { immediate: true })

// ---- Open / close and keyboard, matching the official popup ----

const open = ref(false)
const pillEl = ref<HTMLButtonElement | null>(null)
const popupEl = ref<HTMLElement | null>(null)
/** The row under the cursor or arrow keys; the official calls this the active option. */
const activeModel = ref<string | null>(null)

/**
 * Ids the listbox needs for `aria-labelledby` / `aria-activedescendant`. They
 * must be unique per instance, because more than one composer can be mounted.
 */
const uid = Math.random().toString(36).slice(2, 8)
const headerId = `forge-model-header-${uid}`
const listboxId = `forge-model-listbox-${uid}`
const optionId = (modelId: string) => `forge-model-option-${uid}-${modelId}`

function close(): void {
  if (!open.value) return
  open.value = false
  // Put focus back on the pill rather than dropping it at the top of the
  // document when the popup unmounts.
  void nextTick(() => pillEl.value?.focus())
}

function selectModel(modelId: string): void {
  close()
  emit('modelSelect', modelId)
}

/** Opening starts on the current model, the way the official popup does. */
watch(open, (isOpen) => {
  if (isOpen) activeModel.value = props.selectedModel ?? null
})

function onPointerDown(event: MouseEvent): void {
  const target = event.target as Node
  if (popupEl.value?.contains(target) || pillEl.value?.contains(target)) return
  open.value = false
}

function onKeyDown(event: KeyboardEvent): void {
  if (!open.value) return
  const rows = availableModels.value
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'Enter') {
    if (!activeModel.value) return
    event.preventDefault()
    selectModel(activeModel.value)
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  if (!rows.length) return
  const at = rows.findIndex((m) => m.id === activeModel.value)
  const step = event.key === 'ArrowDown' ? 1 : -1
  const next = at === -1 ? 0 : (at + step + rows.length) % rows.length
  activeModel.value = rows[next].id
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeyDown)
})

/** Lets the command menu's "Switch model..." row open this picker. */
defineExpose({ openMenu: () => { open.value = true } })

</script>
