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
    title="Switch model"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="open ? listboxId : undefined"
    :aria-activedescendant="open && activeModel ? optionId(activeModel) : undefined"
    @click="open = !open"
  >
    <span class="fg-footer__modelPillLabel">{{ pillModelName }}</span>
    <!-- The official `HF1`: a plain " " text node, then the effort -- only when
         the model has effort and a level is known (`Xq0`). -->
    <template v-if="pillEffort !== undefined">{{ ' ' }}<span class="fg-footer__modelPillEffort"
        ><span :class="effortTone">{{ pillEffort }}</span></span
      ></template
    >
  </button>

  <div v-if="open" ref="popupEl" class="fg-commandmenu__menuPopup">
    <!--
      The official reserves 4px here and leaves it empty; its model list is
      five Claude tiers and never needs filtering. Forge's can be every model a
      gateway serves, which is routinely dozens, so the slot the official
      reserves for a filter actually carries one. The input is the command
      palette's own (`fg-filter__filterInput`), not a new control.
    -->
    <input
      v-if="filterable"
      ref="filterEl"
      v-model="filter"
      type="text"
      class="fg-filter__filterInput"
      placeholder="Search models…"
      aria-label="Search models"
      autocomplete="off"
      spellcheck="false"
      @keydown="onFilterKeydown"
    >
    <div v-else style="height: 4px"></div>
    <div class="fg-commandmenu__commandList">
      <!-- The official `aV0`: loading, empty, or the header over the rows. -->
      <div v-if="models === undefined" class="fg-modelmenu__emptyState">Loading models…</div>
      <div v-else-if="!hasRows" class="fg-modelmenu__emptyState">No models available</div>
      <div v-if="hasRows" :id="headerId" class="fg-commandmenu__sectionHeader">Select a model</div>
      <div
        :id="listboxId"
        role="listbox"
        class="fg-modelmenu__listbox"
        :aria-labelledby="hasRows ? headerId : undefined"
        :aria-label="hasRows ? undefined : 'Select a model'"
      >
        <!-- The official `H75`: an unavailable row is greyed, aria-disabled and not clickable. -->
        <div
          v-for="model in pickerRows"
          :key="model.value"
          :id="optionId(model.value)"
          :class="[
            'fg-modelmenu__modelItem',
            unavailableValues.has(model.value) ? 'fg-modelmenu__unavailableModelItem' : '',
            activeModel === model.value ? 'fg-modelmenu__activeModelItem' : '',
          ]"
          role="option"
          :aria-selected="currentValue === model.value"
          :aria-disabled="unavailableValues.has(model.value) ? 'true' : undefined"
          @mousemove="activeModel = model.value"
          @click="pick(model)"
        >
          <div class="fg-modelmenu__modelContent">
            <span class="fg-modelmenu__modelLabel"
              >{{ model.displayName
              }}<span v-if="modelCapabilities(model).length" class="forge-model-chips"
                ><span
                  v-for="chip in modelCapabilities(model)"
                  :key="chip.id"
                  :class="['forge-model-chip', `forge-model-chip--${chip.id}`]"
                  :title="chip.title"
                  ><span :class="chip.id === 'ultracode' ? 'fg-ultracode-text' : undefined">{{ chip.label }}</span></span
                ></span
              ></span
            >
            <span v-if="model.description" class="fg-modelmenu__modelDescription"
              ><template v-if="promoParts(model)"
                >{{ promoParts(model)!.before }}<s style="opacity: 0.7">{{ promoParts(model)!.listPrice }}</s>{{ ' ' + promoParts(model)!.price + promoParts(model)!.after }}</template
              ><template v-else>{{ model.description }}</template></span
            >
          </div>
          <div class="fg-modelmenu__checkIcon">
            <CheckIcon v-if="currentValue === model.value" />
          </div>
        </div>
      </div>
    </div>
    <!--
      The official `aV0` renders this only while the "effort-level" command is
      registered -- i.e. the model supports effort -- and fills it with `QF1`:
      that command's label, suffix and trailing slider, and its handler on click.
    -->
    <div v-if="effort.supported" class="fg-modelmenu__effortSection">
      <!-- Forge (the user's request, 2026-09-19): a rule between the models and
           their effort, and the effort glyph, as the official Modes menu's effort
           row has them (`menuDivider`, `iV0`). The official model menu has neither. -->
      <div class="fg-menu__menuDivider"></div>
      <div
        :id="effortOptionId"
        :class="['fg-commandmenu__commandItem', activeModel === EFFORT_ROW ? 'fg-commandmenu__activeCommandItem' : '']"
        title="Set how hard the model tries"
        @mousemove="activeModel = EFFORT_ROW"
        @click="cycleEffort"
      >
        <div class="fg-commandmenu__commandContent">
          <span class="fg-commandmenu__commandLabel fg-menu__effortLabel"
            ><EffortIcon /><span
              >Effort<span style="color: var(--app-secondary-foreground); margin-left: 4px"
                >(<span :class="effortTone">{{ effortSuffix }}</span>)</span
              ></span
            ></span
          >
        </div>
        <EffortSlider
          :level="effort.level"
          :levels="effort.levels"
          :show-ultracode="effort.ultracodeAvailable"
          :ultracode-selected="effort.ultracodeSelected"
          @select="(level) => emit('effortSelect', level)"
          @select-ultracode="emit('ultracodeSelect')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import CheckIcon from './forge/icons/CheckIcon.vue'
import EffortSlider from './forge/EffortSlider.vue'
import {
  NO_EFFORT,
  effortRowSuffix,
  effortToneClass,
  nextEffortPick,
  pillEffortLabel,
  modelCapabilities as capabilitiesOf,
  type EffortState,
} from './forge/effort'
import EffortIcon from './forge/icons/EffortIcon.vue'
import {
  findModelRow,
  modelPillLabel,
  orderAliasRowsLast,
  pickerCurrentValue,
  promoDescriptionParts,
  selectedModelLabel as officialSelectedModelLabel,
  type ModelRow,
} from './forge/modelCatalog'
import { transport } from '../core/runtimeTransport'

/** The chips on a row, from what the CLI reports (Forge's model menu, the user's request). */
function modelCapabilities(model: ModelRow) {
  return capabilitiesOf(model, transport.claudeConfig()?.claudeSettings)
}

interface Props {
  selectedModel?: string
  /** The effort controls' state (the session's `effortState`). */
  effort?: EffortState
  /**
   * The CLI's selectable models (`claudeConfig.models`), in its order.
   * `undefined` until the initialize response arrives -- the official shows
   * "Loading models…" then, not an empty list.
   */
  models?: ModelRow[]
  /** The CLI's greyed rows (`claudeConfig.unavailable_models`). */
  unavailableModels?: ModelRow[]
  /** The official `lastServedModel`, which the pill names when it differs. */
  lastServedModel?: string
  /** The persisted model setting, which ticks a row before anything is picked. */
  modelSetting?: string
}

interface Emits {
  (e: 'modelSelect', model: ModelRow): void
  (e: 'effortSelect', level: string): void
  /** The Ultracode notch was picked (the official `enableUltracode`). */
  (e: 'ultracodeSelect'): void
  /** The selected model's display name, for the command menu's "Switch model..." row. */
  (e: 'modelLabel', label: string): void
}

const props = withDefaults(defineProps<Props>(), {
  selectedModel: 'default',
  effort: () => NO_EFFORT
})

/** The official `Xq0`: "Extra high", "Ultracode", or nothing for a model without effort. */
const pillEffort = computed(() =>
  pillEffortLabel(props.effort.supported, props.effort.level, props.effort.ultracodeSelected)
)
/** The row's suffix: the level's name, or "Ultracode - xhigh + workflows". */
const effortSuffix = computed(() => effortRowSuffix(props.effort.level, props.effort.ultracodeSelected))
/** Forge's heat tint on the level's name (colour only). */
const effortTone = computed(() => effortToneClass(props.effort.level, props.effort.ultracodeSelected))

const emit = defineEmits<Emits>()

// ── Forge's own model config (~/.forge.json): custom models and hidden ones ──

interface CustomModel {
  id: string
  name?: string
}

const customModels = ref<CustomModel[]>([])
const disabledModels = ref<string[]>([])

onMounted(async () => {
  try {
    const configRes = await transport.getExtensionConfig()
    if (configRes?.config) {
      customModels.value = configRes.config.customModels ?? []
      disabledModels.value = configRes.config.disabledModels ?? []
    }
  } catch (e) {
    console.error('Failed to load model config:', e)
  }
})

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

// ── The rows: the official `aV0` list, plus Forge's custom models ──

/** Forge custom models, as rows in the CLI's shape. They carry no capabilities. */
const customRows = computed<ModelRow[]>(() =>
  customModels.value.map((cm) => ({ value: cm.id, displayName: cm.name || cm.id, description: '' }))
)

/**
 * Every row the picker shows, in the official order: the CLI's selectable
 * models with alias rows last (`PK1`), then Forge's custom models, then the
 * CLI's unavailable rows. Models hidden in Forge's settings are left out.
 */
const allRows = computed<ModelRow[]>(() => {
  const hidden = new Set(disabledModels.value)
  const seen = new Set<string>()
  const keep = (row: ModelRow) => {
    if (hidden.has(row.value) || seen.has(row.value)) return false
    seen.add(row.value)
    return true
  }
  return [
    ...orderAliasRowsLast(props.models ?? []).filter(keep),
    ...customRows.value.filter(keep),
    ...(props.unavailableModels ?? []).filter(keep),
  ]
})

/**
 * The search box appears only when there is enough to search.
 *
 * Below the threshold it is furniture in front of a list you can already read,
 * and the official's menu has none at all -- so the row it would occupy stays
 * the 4px spacer the official reserves.
 */
const FILTER_THRESHOLD = 8
const filterable = computed(() => allRows.value.length >= FILTER_THRESHOLD)
const filter = ref('')
const filterEl = ref<HTMLInputElement | null>(null)

/** Case-insensitive across the id and the display name, which is what people type. */
const pickerRows = computed<ModelRow[]>(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return allRows.value
  return allRows.value.filter((row) =>
    row.value.toLowerCase().includes(q)
    || (row.displayName ?? '').toLowerCase().includes(q)
    || (row.description ?? '').toLowerCase().includes(q)
  )
})

const hasRows = computed(() => pickerRows.value.length > 0)

/**
 * Escape clears the query before it closes the menu, as a filter row should.
 *
 * Everything else is left to bubble: arrow navigation lives on a document
 * listener, so swallowing keys here would make the list unreachable from the
 * box you type into.
 */
function onFilterKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && filter.value) {
    event.stopPropagation()
    filter.value = ''
  }
}

/** The official `i`: which rows are greyed. */
const unavailableValues = computed(() => new Set((props.unavailableModels ?? []).map((m) => m.value)))

/** Rows the labels are computed from: the CLI's (`IH`), then Forge's custom ones. */
const labelRows = computed<ModelRow[]>(() => [
  ...(props.models ?? []),
  ...(props.unavailableModels ?? []),
  ...customRows.value,
])

/** The official `z0` (`Xz0`): the ticked row, mapping a full id onto its alias row. */
const currentValue = computed(() =>
  pickerCurrentValue(labelRows.value, props.selectedModel || props.modelSetting)
)

/** The official `V75`, as parts so the struck-through price needs no v-html. */
const promoParts = (model: ModelRow) => promoDescriptionParts(model)

// ── Labels, matching the official footer ──

/** The pill: the model that will serve the turn ("Sonnet 5"), or "Model". */
const pillModelName = computed(
  () => modelPillLabel(labelRows.value, props.selectedModel, props.lastServedModel) ?? 'Model'
)

/** The official "Switch model…" trailing text: `wC(bK(rows, selection)?.value ?? selection, …)`. */
const selectedModelLabel = computed(() => {
  const selection = props.selectedModel
  const value = findModelRow(labelRows.value, selection)?.value ?? selection
  return officialSelectedModelLabel(value, props.lastServedModel, labelRows.value) ?? ''
})

/** The official `Cy`: the effort row's slot in the popup's keyboard order. */
const EFFORT_ROW = '\u0000effort'

/**
 * Clicking the Effort row (not the slider) runs the "effort-level" command:
 * the next notch, wrapping, with Ultracode as the last one when offered.
 */
function cycleEffort(): void {
  const e = props.effort
  const pick = nextEffortPick(e.levels, e.level, e.ultracodeAvailable, e.ultracodeSelected)
  if (pick.kind === 'ultracode') emit('ultracodeSelect')
  else emit('effortSelect', pick.level)
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
const optionId = (modelId: string) =>
  modelId === EFFORT_ROW ? effortOptionId : `forge-model-option-${uid}-${modelId}`
const effortOptionId = `forge-model-option-${uid}-effort`

function close(): void {
  if (!open.value) return
  open.value = false
  // Put focus back on the pill rather than dropping it at the top of the
  // document when the popup unmounts.
  void nextTick(() => pillEl.value?.focus())
}

/**
 * The official `onModelSelected`: picking the row that is already ticked only
 * because it covers the persisted full id keeps that id, rather than widening
 * the choice back to the alias.
 */
function selectModel(model: ModelRow): void {
  close()
  const selection = props.selectedModel
  const keepExplicit =
    model.value !== 'default' && model.value === currentValue.value && !!selection && selection !== model.value
  emit('modelSelect', keepExplicit ? { ...model, value: selection } : model)
}

/** A greyed row has no click handler in the official (`onClick: Z ? void 0 : z`). */
function pick(model: ModelRow): void {
  if (unavailableValues.value.has(model.value)) return
  selectModel(model)
}

/** Opening starts on the current model, the way the official popup does. */
watch(open, (isOpen) => {
  // A stale query would hide the current model behind a filter nobody typed.
  filter.value = ''
  if (!isOpen) return
  activeModel.value = pickerRows.value.find((m) => m.value === currentValue.value)?.value ?? null
  // Focus the box, but only when it is there: stealing focus on a five-row
  // menu would take the arrow keys away from the list for no gain.
  if (filterable.value) void nextTick(() => filterEl.value?.focus())
})

function onPointerDown(event: MouseEvent): void {
  const target = event.target as Node
  if (popupEl.value?.contains(target) || pillEl.value?.contains(target)) return
  open.value = false
}

function onKeyDown(event: KeyboardEvent): void {
  if (!open.value) return
  const rows = [...pickerRows.value.map((m) => m.value), ...(props.effort.supported ? [EFFORT_ROW] : [])]
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'Enter') {
    if (!activeModel.value) return
    event.preventDefault()
    if (activeModel.value === EFFORT_ROW) {
      cycleEffort()
      return
    }
    // The official picks only from the selectable rows (`Z.find(...)`), so
    // Enter on a greyed row does nothing.
    const row = pickerRows.value.find((m) => m.value === activeModel.value)
    if (row && !unavailableValues.value.has(row.value)) selectModel(row)
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  if (!rows.length) return
  const at = rows.indexOf(activeModel.value ?? '')
  const step = event.key === 'ArrowDown' ? 1 : -1
  const next = at === -1 ? 0 : (at + step + rows.length) % rows.length
  activeModel.value = rows[next]
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
