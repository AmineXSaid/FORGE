<template>
  <ForgeFlyout
    ref="flyout"
    title="Modes"
    align-right
    :trigger-title="`${selectedMode.description}. Click to change, or press Shift+Tab to cycle.`"
  >
    <template #trigger>
      <ModeIcon class="fg-modeTint" :data-mode="selectedMode.id" :mode="selectedMode.id" small />
      <span>{{ selectedMode.label }}</span>
    </template>

    <template #hint>
      <kbd>&#8679;</kbd> + <kbd>tab</kbd> to switch
    </template>

    <template #default="{ close }">
      <ForgeMenuItem
        v-for="mode in shownModes"
        :key="mode.id"
        :label="mode.label"
        :description="mode.description"
        :selected="selectedId === mode.id"
        @select="selectMode(mode.id, close)"
      >
        <template #icon><ModeIcon class="fg-modeTint" :data-mode="mode.id" :mode="mode.id" /></template>
      </ForgeMenuItem>

      <!-- Effort lives in the model menu, beside the model it applies to. -->
    </template>
  </ForgeFlyout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import ForgeFlyout from './forge/ForgeFlyout.vue'
import ForgeMenuItem from './forge/ForgeMenuItem.vue'
import ModeIcon from './forge/ModeIcon.vue'
import type { ModeId } from './forge/modeId'

/**
 * The permission modes, with the labels and descriptions the official extension
 * uses. The names matter: "Manual" and "Edit automatically" say what Claude will
 * do, where the SDK's own `default` / `acceptEdits` say how it is configured.
 * Only modes the SDK actually accepts are listed.
 */
const MODES: Array<{ id: ModeId; label: string; description: string }> = [
  // Forge-only (production audit, Phase 6): first, in gold.
  {
    id: 'expert',
    label: 'Expert',
    description: 'Forge teaches step by step, from the basics up, and asks before each edit',
  },
  {
    id: 'default' as PermissionMode,
    label: 'Manual',
    description: 'Forge will ask for approval before making each edit',
  },
  {
    id: 'acceptEdits' as PermissionMode,
    label: 'Edit automatically',
    description: 'Forge will edit your selected text or the whole file',
  },
  {
    id: 'plan' as PermissionMode,
    label: 'Plan',
    description: 'Forge will explore the code and present a plan before editing',
  },
  {
    id: 'bypassPermissions' as PermissionMode,
    label: 'Bypass permissions',
    description: 'Forge will not ask for approval before running potentially dangerous commands',
  },
]

interface Props {
  permissionMode?: PermissionMode
  /**
   * A managed policy disables bypass permissions: the row is left out, as the
   * official leaves it out (`disableBypassPermissionsMode === "disable"`).
   * Otherwise it is always offered; choosing it while the setting is off asks
   * to turn it on (see `handleModeSelect` in ChatPage).
   */
  bypassHidden?: boolean
  /** The session is in Expert (the row is then the selected one). */
  expertMode?: boolean
}

interface Emits {
  (e: 'modeSelect', mode: ModeId): void
}

const props = withDefaults(defineProps<Props>(), {
  permissionMode: 'default',
})

const emit = defineEmits<Emits>()
const flyout = ref<InstanceType<typeof ForgeFlyout> | null>(null)

const shownModes = computed(() =>
  props.bypassHidden ? MODES.filter((m) => m.id !== 'bypassPermissions') : MODES
)

const selectedId = computed<ModeId>(() => (props.expertMode ? 'expert' : props.permissionMode))

const selectedMode = computed(
  () => MODES.find((m) => m.id === selectedId.value) ?? MODES[1]
)


function selectMode(mode: ModeId, close: () => void): void {
  close()
  emit('modeSelect', mode)
}

</script>

<style scoped>
/*
  The menu's layout comes from the ported official stylesheet
  (styles/official/menu.css).
*/

/*
  Each mode's glyph carries a Pajamas hue, the palette showing at the edges of a
  purple UI: editing freely reads green, planning blue, bypassing deep red, Expert
  gold. Manual stays
  neutral. The send button already takes the same mode colours from the official.
*/
.fg-modeTint[data-mode='acceptEdits'] {
  color: var(--forge-success);
}

.fg-modeTint[data-mode='plan'] {
  color: var(--forge-info);
}

.fg-modeTint[data-mode='bypassPermissions'] {
  color: var(--forge-bypass);
}

.fg-modeTint[data-mode='expert'] {
  color: var(--forge-expert);
}

/*
  The hint's <kbd> is styled by the ported official rule
  (.fg-menu__menuHeaderHint kbd in styles/official/menu.css: font-family and
  font-size inherit, --app-code-background). A scoped copy here used to override
  it with mono at 0.9em, which measured 8.775px against the official 9.75px.
*/
</style>
