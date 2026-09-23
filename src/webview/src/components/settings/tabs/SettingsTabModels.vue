<template>
  <SettingsTab title="Models">
    <!--
      An endpoint and its model are one entry (2026-09-23). This list is the
      chat's model menu: the pairs set up here, and nothing else. There are no
      Anthropic default models, no free-standing custom models and no alias
      routing: a model is added by adding it with the endpoint that serves it.
    -->
    <SettingsSection title="Endpoints and Models">
      <SettingsSubSection caption="Each entry is an endpoint with the model it runs. The chat's model menu lists these; the switch hides one from it without deleting it.">
        <div v-if="sdkCapabilitiesLoading && !pairs.length" class="models__state" role="status">
          <span class="codicon codicon-loading models__spin" aria-hidden="true" />
          Loading your endpoints…
        </div>

        <div v-else-if="!pairs.length" class="models__empty">
          <span class="codicon codicon-plug models__emptyIcon" aria-hidden="true" />
          <p class="models__emptyTitle">No endpoint yet</p>
          <p class="models__emptyText">Add one with the model you want to use: a model server on this machine, a gateway, or a hosted API.</p>
          <Button variant="primary" @click="addEndpoint">
            <template #icon><span class="codicon codicon-add" aria-hidden="true" /></template>
            Add an endpoint
          </Button>
        </div>

        <template v-else>
          <SettingsCell
            v-for="(pair, index) in pairs"
            :key="pair.value"
            :divider="index > 0"
            class="models__pair"
          >
            <template #label>
              <span class="models__model">{{ pair.displayName }}</span>
              <span v-if="pair.active" class="models__inUse">In use</span>
            </template>
            <template #description>{{ pair.description }}</template>
            <template #trailing>
              <div class="models__actions">
                <Button
                  v-if="!pair.active"
                  variant="secondary"
                  size="small"
                  :aria-busy="switching === pair.value"
                  @click="usePair(pair.value)"
                >
                  Use
                </Button>
                <span :title="isShown(pair.value) ? 'Shown in the chat’s model menu' : 'Hidden from the chat’s model menu'">
                  <Switch
                    :model-value="isShown(pair.value)"
                    :aria-label="`Show ${pair.displayName} in the model menu`"
                    @update:model-value="setShown(pair.value, $event)"
                  />
                </span>
              </div>
            </template>
          </SettingsCell>

          <SettingsCell :divider="true" label="Add an endpoint or a model" description="Another endpoint, or another model from one you already have. Forge checks it answers before saving it.">
            <template #trailing>
              <Button variant="secondary" size="small" @click="addEndpoint">
                <template #icon><span class="codicon codicon-add" aria-hidden="true" /></template>
                Add
              </Button>
            </template>
          </SettingsCell>
        </template>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection title="Thinking & Effort">
      <SettingsSubSection>
        <SettingsItem
          setting-key="alwaysThinkingEnabled"
          label="Always Thinking"
          description="Enable extended thinking for all requests"
        >
          <template #default="{ effectiveValue, update }">
            <div class="cursor-settings-cell-switch-container">
              <Switch
                :model-value="effectiveValue ?? false"
                @update:model-value="update"
                title="Always Thinking"
              />
            </div>
          </template>
        </SettingsItem>
        <!--
          Only when the model in use takes effort (B4: the official unregisters
          its effort row for models without it), with that model's own levels.
        -->
        <SettingsItem
          v-if="effortModel.supported"
          setting-key="effortLevel"
          label="Effort Level"
          :description="`How hard ${effortModel.name} works on each request. Higher is slower and more thorough.`"
          :divider="true"
        >
          <template #default="{ effectiveValue, update }">
            <Dropdown
              :model-value="effectiveValue ?? EFFORT_AUTO"
              @update:model-value="(val: string) => val === EFFORT_AUTO ? resetSetting('effortLevel', scope) : update(val)"
              :options="effortLevelOptions"
              menu-align="right"
            >
              <template #trigger="{ selected }">
                {{ selected?.label || effortLabel(effectiveValue) }}
              </template>
            </Dropdown>
          </template>
        </SettingsItem>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection title="Limits">
      <SettingsSubSection caption="Leave a limit empty to use the model's own default. Written to the env block of your settings file.">
        <SettingsCell label="Max thinking tokens" description="The most tokens a request may spend thinking.">
          <template #trailing>
            <NumberInput
              :model-value="getEnvVarNumber('MAX_THINKING_TOKENS')"
              @update:model-value="setEnvVarNumber('MAX_THINKING_TOKENS', $event)"
              :min="1"
              width="112px"
              empty-when-zero
              placeholder="Default"
              aria-label="Max thinking tokens"
            />
          </template>
        </SettingsCell>
        <SettingsCell label="Max output tokens" description="The most tokens one response may contain." :divider="true">
          <template #trailing>
            <NumberInput
              :model-value="getEnvVarNumber('CLAUDE_CODE_MAX_OUTPUT_TOKENS')"
              @update:model-value="setEnvVarNumber('CLAUDE_CODE_MAX_OUTPUT_TOKENS', $event)"
              :min="1"
              width="112px"
              empty-when-zero
              placeholder="Default"
              aria-label="Max output tokens"
            />
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import SettingsTab from '../SettingsTab.vue'
import SettingsSection from '../SettingsSection.vue'
import SettingsSubSection from '../SettingsSubSection.vue'
import SettingsCell from '../SettingsCell.vue'
import SettingsItem from '../SettingsItem.vue'
import Switch from '../../Common/Switch.vue'
import Dropdown from '../../Common/Dropdown.vue'
import NumberInput from '../../Common/NumberInput.vue'
import Button from '../../Common/Button.vue'
import { DEFAULT_EFFORT_LEVELS, EFFORT_LABEL, effortLabel } from '../../forge/effort'
import { useSettingsStore } from '../../../composables/useSettingsStore'
import { useSettingsScope } from '../../../composables/useSettingsScope'
import { runHostAction, transport } from '../../../core/runtimeTransport'

const {
  settings, activeProfile, sdkCapabilities, sdkCapabilitiesLoading,
  inspect, updateSetting, resetSetting, refreshSdkCapabilities,
} = useSettingsStore()
const scope = useSettingsScope()

// ── The pairs: the host's `pairRow`s, the same rows the chat's picker reads ──

const pairs = computed(() => sdkCapabilities.value.supportedModels)

const switching = ref<string | null>(null)

/** Make a pair the one in use: the same request the chat's model menu sends. */
function usePair(value: string): void {
  if (switching.value) return
  switching.value = value
  runHostAction('switch the endpoint', async () => {
    try {
      await transport.setModel('', { value })
      await refreshSdkCapabilities()
    } finally {
      switching.value = null
    }
  })
}

function addEndpoint(): void {
  runHostAction('add an endpoint', async () => {
    await transport.runEndpointAction('add')
    await refreshSdkCapabilities()
  })
}

// ── Shown in the chat's menu or hidden (Forge's ~/.forge.json `disabledModels`) ──

const disabledModels = ref<string[]>([])

onMounted(async () => {
  try {
    const response = await transport.getExtensionConfig()
    disabledModels.value = response?.config?.disabledModels ?? []
  } catch (e) {
    console.error('Failed to load extension config:', e)
  }
})

const unsubConfigChanged = transport.extensionConfigChanged.add(({ key, value }) => {
  if (key === 'disabledModels') disabledModels.value = value ?? []
})
onUnmounted(() => unsubConfigChanged())

function isShown(value: string): boolean {
  return !disabledModels.value.includes(value)
}

function setShown(value: string, shown: boolean): void {
  const updated = shown ? disabledModels.value.filter((m) => m !== value) : [...disabledModels.value, value]
  disabledModels.value = updated
  runHostAction('save the model menu', () => transport.updateExtensionConfig('disabledModels', updated))
}

// ── Effort, for the pair in use ──

const EFFORT_AUTO = '__auto__'

const effortModel = computed(() => {
  const inUse = pairs.value.find((p) => p.active) ?? pairs.value[0]
  if (!inUse) return { supported: false, levels: [] as string[], name: 'the model' }
  const levels = inUse.supportedEffortLevels?.length ? inUse.supportedEffortLevels : [...DEFAULT_EFFORT_LEVELS]
  return { supported: inUse.supportsEffort === true, levels, name: inUse.displayName }
})

const effortLevelOptions = computed(() => [
  { label: 'Auto', value: EFFORT_AUTO, description: "The model's own default" },
  ...effortModel.value.levels.map((level) => ({ label: EFFORT_LABEL[level] ?? level, value: level })),
])

// ── Limits, as env vars in the edited scope ──

const effectiveEnv = computed<Record<string, string>>(() => {
  const val = settings.value.env
  return (val && typeof val === 'object' ? val : {}) as Record<string, string>
})

const scopeEnv = computed<Record<string, string>>(() => {
  // Touch settings.value so Vue tracks it: inspect() reads alien-signals directly.
  void settings.value
  const values = inspect('env')?.values || {}
  if (activeProfile.value && scope.value === 'global') {
    return (values.profile as Record<string, string>) || {}
  }
  return (values[scope.value] as Record<string, string>) || {}
})

function getEnvVarNumber(key: string): number {
  const num = parseInt(effectiveEnv.value[key] ?? '', 10)
  return Number.isNaN(num) ? 0 : num
}

function setEnvVarNumber(key: string, value: number) {
  const next = { ...scopeEnv.value }
  if (value > 0) next[key] = String(value)
  else delete next[key]
  updateSetting('env', next, scope.value)
}
</script>

<style scoped>
.models__state {
  align-items: center;
  color: var(--forge-text-muted);
  display: flex;
  font-size: 12px;
  gap: 10px;
  padding: 14px;
}

.models__empty {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 28px 16px 30px;
  text-align: center;
}

.models__emptyIcon {
  color: var(--forge-text-subtle);
  font-size: 22px;
}

.models__emptyTitle {
  color: var(--forge-text);
  font-size: 13px;
  font-weight: 500;
  margin: 0;
}

.models__emptyText {
  color: var(--forge-text-muted);
  font-size: 12px;
  line-height: 17px;
  margin: 0 0 6px;
  max-width: 44ch;
}

.models__model {
  font-family: var(--app-monospace-font-family);
  font-size: 12px;
}

/* A badge is weighted text, not a box (forge-style). */
.models__inUse {
  color: var(--forge-success);
  font-size: 11px;
  font-weight: 600;
  margin-left: 8px;
}

.models__actions {
  align-items: center;
  display: flex;
  gap: 10px;
}

.models__spin {
  animation: models-spin 900ms linear infinite;
}

@keyframes models-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .models__spin {
    animation-duration: 2.4s;
  }
}
</style>
