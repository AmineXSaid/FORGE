<template>
  <SettingsTab title="Slash Commands">
    <ForgeItemsList
      kind="commands"
      intro="A slash command is a saved prompt. Type /name in the chat and the prompt is sent, with anything after the name in place of $ARGUMENTS. Each one is a Markdown file the CLI reads."
      empty-title="No custom commands yet"
      empty-text="Give it a name and a sentence about what it does. Forge writes the file and opens it for the prompt."
      empty-icon="codicon-symbol-event"
      :actions="[{ id: 'create-command', label: 'Create command', icon: 'codicon-add' }]"
    />

    <!--
      What the CLI itself reports it can run here: its built-ins, plus the
      custom commands and skills it found. Read from the same probe the Models
      and MCP tabs use, so this is the CLI's list rather than a copy of it.
    -->
    <SettingsSection title="Available in the chat">
      <SettingsSubSection>
        <div class="commands__filter">
          <span class="codicon codicon-filter commands__filterIcon" aria-hidden="true" />
          <TextInput v-model="filter" class="commands__filterInput" placeholder="Filter commands" aria-label="Filter commands" />
        </div>

        <div v-if="sdkCapabilitiesLoading && !commands.length" class="commands__state" role="status">
          <span class="codicon codicon-loading commands__spin" aria-hidden="true" />
          Asking the CLI…
        </div>
        <div v-else-if="!commands.length" class="commands__state">
          <span>The CLI did not report any commands.</span>
          <Button variant="tertiary" size="small" @click="refreshSdkCapabilities">Ask again</Button>
        </div>
        <p v-else-if="!shown.length" class="commands__state">No command matches "{{ filter.trim() }}".</p>
        <ul v-else class="commands__list">
          <li v-for="command in shown" :key="command.name + command.argumentHint" class="commands__row">
            <span class="commands__name">
              /{{ command.name }}<span v-if="command.argumentHint" class="commands__hint">{{ command.argumentHint }}</span>
            </span>
            <span class="commands__description">{{ command.description }}</span>
          </li>
        </ul>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import ForgeItemsList from '../ForgeItemsList.vue';
import TextInput from '../../Common/TextInput.vue';
import Button from '../../Common/Button.vue';
import { useSettingsStore } from '../../../composables/useSettingsStore';

const { sdkCapabilities, sdkCapabilitiesLoading, refreshSdkCapabilities } = useSettingsStore();

const filter = ref('');

const commands = computed(() =>
  [...(sdkCapabilities.value.supportedCommands ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
);

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase().replace(/^\//, '');
  if (!q) return commands.value;
  return commands.value.filter(
    (c) => c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q),
  );
});
</script>

<style scoped>
.commands__filter {
  padding: 12px 14px 8px;
  position: relative;
}

.commands__filterIcon {
  color: var(--forge-field-placeholder);
  font-size: 13px;
  left: 23px;
  pointer-events: none;
  position: absolute;
  top: calc(50% + 2px);
  transform: translateY(-50%);
  z-index: 1;
}

.commands__filterInput {
  padding-left: 28px;
  width: 100%;
}

.commands__state {
  align-items: center;
  color: var(--cursor-text-secondary);
  display: flex;
  font-size: 12px;
  gap: 10px;
  margin: 0;
  padding: 10px 14px 14px;
}

.commands__list {
  list-style: none;
  margin: 0;
  max-height: 420px;
  overflow-y: auto;
  padding: 0 14px 6px;
}

.commands__row {
  border-top: 1px solid var(--forge-hairline);
  display: grid;
  gap: 2px 16px;
  grid-template-columns: minmax(120px, 34%) 1fr;
  padding: 8px 0;
}

.commands__row:first-child {
  border-top: none;
}

.commands__name {
  color: var(--forge-text);
  font-family: var(--app-monospace-font-family);
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commands__hint {
  color: var(--forge-text-subtle);
  font-weight: 400;
  margin-left: 6px;
}

.commands__description {
  color: var(--forge-text-muted);
  font-size: 12px;
  line-height: 17px;
}

.commands__spin {
  animation: commands-spin 900ms linear infinite;
}

@keyframes commands-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 520px) {
  .commands__row {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .commands__spin {
    animation-duration: 2.4s;
  }
}
</style>
