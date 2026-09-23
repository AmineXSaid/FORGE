<template>
  <SettingsTab title="Hooks">
    <SettingsSection>
      <SettingsSubSection caption="A hook runs a shell command at a set point in Claude's work: before a tool runs, after it, when you send a prompt, when a session starts or ends. The command gets the event as JSON on stdin; a non-zero exit can block the step.">
        <SettingsCell
          label="Disable All Hooks"
          description="Stops every hook from running, including hooks from other settings files and plugins."
        >
          <template #trailing>
            <Switch :model-value="!!settings.disableAllHooks" aria-label="Disable all hooks" @update:model-value="setDisabled" />
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection title="Add a Hook">
      <SettingsSubSection>
        <form class="hooks__form" @submit.prevent="add">
          <label class="hooks__field hooks__field--event">
            <span class="hooks__label">Event</span>
            <Dropdown v-model="draft.event" :options="eventOptions" class="hooks__control" />
          </label>
          <label v-if="draftEvent?.matcher" class="hooks__field hooks__field--matcher">
            <span class="hooks__label">Matches {{ draftEvent.matcher.field }}</span>
            <TextInput v-model="draft.matcher" monospace :placeholder="draftEvent.matcher.placeholder" aria-label="Matcher" class="hooks__control" />
          </label>
          <label class="hooks__field hooks__field--command">
            <span class="hooks__label">Command</span>
            <TextInput
              v-model="draft.command"
              monospace
              placeholder="e.g. npx prettier --write &quot;$CLAUDE_PROJECT_DIR&quot;"
              aria-label="Command"
              :invalid="!!error"
              class="hooks__control"
            />
          </label>
          <label class="hooks__field hooks__field--timeout">
            <span class="hooks__label">Timeout</span>
            <NumberInput v-model="draft.timeout" :min="1" :max="3600" empty-when-zero suffix="sec" width="100%" aria-label="Timeout in seconds" />
          </label>
          <div class="hooks__submit">
            <Button type="submit" variant="primary">
              <template #icon><span class="codicon codicon-add" aria-hidden="true" /></template>
              Add hook
            </Button>
          </div>
        </form>
        <p class="hooks__hint" :class="{ 'hooks__hint--error': !!error }" :role="error ? 'alert' : undefined">
          {{ error || eventHint }}
        </p>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection :title="`Hooks in ${scopeName}`">
      <SettingsSubSection>
        <p v-if="!ownRows.length" class="hooks__empty">
          No hooks in {{ scopeName.toLowerCase() }} yet. Add one above; it runs from the next conversation.
        </p>
        <TransitionGroup v-else tag="ul" name="hooks-row" class="hooks__list">
          <li v-for="row in ownRows" :key="rowKey(row)" class="hooks__row">
            <div class="hooks__rowMain">
              <div class="hooks__rowHead">
                <span class="hooks__event">{{ row.event }}</span>
                <span v-if="row.matcher" class="hooks__matcher">{{ row.matcher }}</span>
                <span v-if="row.timeout" class="hooks__meta">{{ row.timeout }}s</span>
                <span v-if="row.type !== 'command'" class="hooks__meta">{{ row.type }}</span>
              </div>
              <code class="hooks__command" :title="row.command">{{ row.command || '(no command)' }}</code>
            </div>
            <button type="button" class="hooks__remove" :aria-label="`Remove ${row.event} hook`" :title="'Remove this hook'" @click="remove(row)">
              <span class="codicon codicon-trash" aria-hidden="true" />
            </button>
          </li>
        </TransitionGroup>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection v-if="otherRows.length" title="From Other Settings Files">
      <SettingsSubSection caption="These apply too. Change them in the scope they come from.">
        <ul class="hooks__list">
          <li v-for="row in otherRows" :key="row.from + rowKey(row)" class="hooks__row hooks__row--locked">
            <div class="hooks__rowMain">
              <div class="hooks__rowHead">
                <span class="hooks__event">{{ row.event }}</span>
                <span v-if="row.matcher" class="hooks__matcher">{{ row.matcher }}</span>
                <span class="hooks__meta">{{ row.from }}</span>
              </div>
              <code class="hooks__command" :title="row.command">{{ row.command || `(${row.type} hook)` }}</code>
            </div>
            <span class="codicon codicon-lock hooks__lock" aria-hidden="true" />
          </li>
        </ul>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Switch from '../../Common/Switch.vue';
import Dropdown from '../../Common/Dropdown.vue';
import TextInput from '../../Common/TextInput.vue';
import NumberInput from '../../Common/NumberInput.vue';
import Button from '../../Common/Button.vue';
import { useSettingsStore } from '../../../composables/useSettingsStore';
import { useSettingsScope } from '../../../composables/useSettingsScope';
import { HOOK_EVENTS, addHook, asHooksConfig, hookEvent, hookRows, removeHook, validateHook, type HookRow } from '../hooks';

const { settings, activeProfile, inspect, updateSetting, resetSetting } = useSettingsStore();
const scope = useSettingsScope();

const SCOPE_NAMES: Record<string, string> = {
  global: 'User Settings',
  profile: 'This Profile',
  shared: 'Project Settings',
  local: 'Local Settings',
  managed: 'Managed Policy',
};

/** The layer an edit lands in: the active profile stands in for user settings. */
const layer = computed(() => (activeProfile.value && scope.value === 'global' ? 'profile' : scope.value));
const scopeName = computed(() => SCOPE_NAMES[layer.value] ?? 'This Scope');

const values = computed<Record<string, unknown>>(() => {
  void settings.value;
  return inspect('hooks')?.values ?? {};
});

const ownConfig = computed(() => asHooksConfig(values.value[layer.value]));
const ownRows = computed(() => hookRows(ownConfig.value));

/** Hooks from every other layer, labelled with where they come from. */
const otherRows = computed(() =>
  Object.entries(values.value)
    .filter(([name]) => name !== layer.value && name !== 'default' && SCOPE_NAMES[name])
    .flatMap(([name, value]) => hookRows(asHooksConfig(value)).map((row) => ({ ...row, from: SCOPE_NAMES[name] }))),
);

const eventOptions = HOOK_EVENTS.map((e) => ({ label: e.id, value: e.id, description: e.summary }));

const draft = reactive({ event: 'PreToolUse', matcher: '', command: '', timeout: 0 });
const error = ref('');
const draftEvent = computed(() => hookEvent(draft.event));
const eventHint = computed(() => {
  const event = draftEvent.value;
  if (!event) return '';
  return event.matcher
    ? `${event.summary}. Leave the matcher empty to run on every ${event.matcher.field}.`
    : `${event.summary}.`;
});

watch(() => [draft.event, draft.matcher, draft.command, draft.timeout], () => {
  error.value = '';
});

function save(next: ReturnType<typeof asHooksConfig>): void {
  if (Object.keys(next).length) {
    updateSetting('hooks', next, scope.value);
  } else {
    void resetSetting('hooks', scope.value).catch(() => {});
  }
}

function add(): void {
  const hook = { event: draft.event, matcher: draft.matcher, command: draft.command, timeout: draft.timeout || undefined };
  const problem = validateHook(hook);
  if (problem) {
    error.value = problem;
    return;
  }
  save(addHook(ownConfig.value, hook));
  draft.matcher = '';
  draft.command = '';
  draft.timeout = 0;
}

function remove(row: HookRow): void {
  save(removeHook(ownConfig.value, row));
}

function setDisabled(value: boolean): void {
  if (value) updateSetting('disableAllHooks', true, scope.value);
  else void resetSetting('disableAllHooks', scope.value).catch(() => {});
}

function rowKey(row: HookRow): string {
  return `${row.event}/${row.group}/${row.index}/${row.matcher}/${row.command}`;
}
</script>

<style scoped>
.hooks__form {
  align-items: end;
  display: grid;
  gap: 10px 12px;
  grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr);
  margin: 0;
  padding: 14px 14px 6px;
}

.hooks__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.hooks__field--command {
  grid-column: 1 / -1;
}

.hooks__label {
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 500;
}

.hooks__control {
  width: 100%;
}

.hooks__submit {
  display: flex;
  justify-content: flex-end;
}

.hooks__hint {
  color: var(--forge-text-subtle);
  font-size: 11.5px;
  line-height: 16px;
  margin: 0;
  min-height: 16px;
  padding: 2px 14px 14px;
}

.hooks__hint--error {
  color: var(--forge-field-invalid);
}

.hooks__empty {
  color: var(--forge-text-muted);
  font-size: 12px;
  margin: 0;
  padding: 14px;
}

.hooks__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hooks__row {
  align-items: center;
  border-top: 1px solid var(--forge-hairline);
  display: flex;
  gap: 12px;
  padding: 10px 14px;
}

.hooks__row:first-child {
  border-top: none;
}

.hooks__rowMain {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.hooks__rowHead {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.hooks__event {
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 600;
}

.hooks__matcher {
  color: var(--forge-text-muted);
  font-family: var(--app-monospace-font-family);
  font-size: 11.5px;
}

.hooks__meta {
  color: var(--forge-text-subtle);
  font-size: 11px;
  font-weight: 600;
}

.hooks__command {
  color: var(--forge-text-muted);
  font-family: var(--app-monospace-font-family);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hooks__remove {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: var(--corner-radius-small);
  color: var(--forge-text-subtle);
  cursor: pointer;
  display: inline-flex;
  flex: none;
  height: 24px;
  justify-content: center;
  padding: 0;
  transition: background-color 120ms cubic-bezier(0.22, 1, 0.36, 1), color 120ms cubic-bezier(0.22, 1, 0.36, 1);
  width: 24px;
}

.hooks__remove:hover {
  background: var(--forge-surface-hover);
  color: var(--forge-danger);
}

.hooks__remove:focus-visible {
  outline: 2px solid var(--forge-focus-ring);
  outline-offset: 1px;
}

.hooks__lock {
  color: var(--forge-text-subtle);
  flex: none;
  font-size: 12px;
}

.hooks-row-enter-active,
.hooks-row-leave-active {
  transition: opacity 160ms cubic-bezier(0.22, 1, 0.36, 1), transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.hooks-row-enter-from,
.hooks-row-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (max-width: 520px) {
  .hooks__form {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hooks__remove,
  .hooks-row-enter-active,
  .hooks-row-leave-active {
    transition: none;
  }
}
</style>
