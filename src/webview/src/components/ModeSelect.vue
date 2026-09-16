<template>
  <ForgeFlyout
    ref="flyout"
    title="Modes"
    align-right
    :trigger-title="`${selectedMode.description}. Click to change, or press Shift+Tab to cycle.`"
  >
    <template #trigger>
      <span class="fg-modeTint" :data-mode="selectedMode.id"><ModeIcon :mode="selectedMode.id" small /></span>
      <span>{{ selectedMode.label }}</span>
    </template>

    <template #hint>
      <kbd>&#8679;</kbd> + <kbd>tab</kbd> to switch
    </template>

    <template #default="{ close }">
      <ForgeMenuItem
        v-for="mode in MODES"
        :key="mode.id"
        :label="mode.label"
        :description="mode.description"
        :selected="permissionMode === mode.id"
        @select="selectMode(mode.id, close)"
      >
        <template #icon><span class="fg-modeTint" :data-mode="mode.id"><ModeIcon :mode="mode.id" /></span></template>
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

/**
 * The permission modes, with the labels and descriptions the official extension
 * uses. The names matter: "Manual" and "Edit automatically" say what Claude will
 * do, where the SDK's own `default` / `acceptEdits` say how it is configured.
 * Only modes the SDK actually accepts are listed.
 */
const MODES = [
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
}

interface Emits {
  (e: 'modeSelect', mode: PermissionMode): void
}

const props = withDefaults(defineProps<Props>(), {
  permissionMode: 'default',
})

const emit = defineEmits<Emits>()
const flyout = ref<InstanceType<typeof ForgeFlyout> | null>(null)

const selectedMode = computed(
  () => MODES.find((m) => m.id === props.permissionMode) ?? MODES[0]
)


function selectMode(mode: PermissionMode, close: () => void): void {
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
  purple UI: editing freely reads green, planning blue, bypassing red. Manual stays
  neutral. The send button already takes the same mode colours from the official.
*/
.fg-modeTint {
  display: inline-flex;
}

.fg-modeTint[data-mode='acceptEdits'] {
  color: var(--forge-success);
}

.fg-modeTint[data-mode='plan'] {
  color: var(--forge-info);
}

.fg-modeTint[data-mode='bypassPermissions'] {
  color: var(--forge-danger);
}
.fg-menu__menuHeaderHint kbd {
  padding: 1px 4px;
  border: 1px solid var(--app-input-border);
  border-radius: 3px;
  background: var(--app-input-background);
  font-family: var(--app-monospace-font-family);
  font-size: 0.9em;
}
</style>
