<template>
  <SettingsTab title="Memory and Rules">
    <!--
      The CLI's memory files. "Edit" opens the file the CLI reads and creates it
      empty when it does not exist yet, as `/memory` does. The two project
      files need a folder, so they only appear when one is open.
    -->
    <SettingsSection title="Memory Files">
      <SettingsSubSection>
        <SettingsCell
          label="User Memory"
          description="Personal instructions loaded in every project."
        >
          <template #trailing>
            <Button variant="secondary" size="small" @click="openMemory('user-claude-md')">
              <template #icon><span class="codicon codicon-edit" aria-hidden="true" /></template>
              Edit
            </Button>
          </template>
          <template #bottom>
            <code class="memory__path">~/.claude/CLAUDE.md</code>
          </template>
        </SettingsCell>

        <template v-if="hasWorkspace">
          <SettingsCell
            label="Project Memory"
            description="Instructions for this project, shared with everyone who works on it."
            :divider="true"
          >
            <template #trailing>
              <Button variant="secondary" size="small" @click="openMemory('project-claude-md')">
                <template #icon><span class="codicon codicon-edit" aria-hidden="true" /></template>
                Edit
              </Button>
            </template>
            <template #bottom>
              <code class="memory__path">CLAUDE.md</code>
            </template>
          </SettingsCell>

          <SettingsCell
            label="Local Project Memory"
            description="Your own instructions for this project. Not committed."
            :divider="true"
          >
            <template #trailing>
              <Button variant="secondary" size="small" @click="openMemory('local-claude-md')">
                <template #icon><span class="codicon codicon-edit" aria-hidden="true" /></template>
                Edit
              </Button>
            </template>
            <template #bottom>
              <code class="memory__path">CLAUDE.local.md</code>
            </template>
          </SettingsCell>
        </template>
      </SettingsSubSection>
    </SettingsSection>

    <!-- Subagents have their own tab, which lists and creates them. -->
    <SettingsSection title="Custom Agents">
      <SettingsSubSection>
        <SettingsCell
          label="Agents"
          description="Focused helpers the conversation can hand work to. List them, and create new ones, in the Agents tab."
        >
          <template #trailing>
            <Button variant="secondary" size="small" @click="openAgentsTab">
              <template #icon><span class="codicon codicon-arrow-right" aria-hidden="true" /></template>
              Open Agents
            </Button>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection title="Company Announcements">
      <SettingsSubSection>
        <SettingsCell
          label="Announcements"
          description="Messages shown at startup, one per line in the list."
        >
          <template #bottom>
            <ListEditor
              label="Announcements"
              placeholder="e.g. Deploy freeze until Friday"
              :items="announcements"
              @add="updateSetting('companyAnnouncements', [...announcements, $event], 'global')"
              @remove="updateSetting('companyAnnouncements', announcements.filter((_, i) => i !== $event), 'global')"
            />
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Button from '../../Common/Button.vue';
import ListEditor from '../../Common/ListEditor.vue';
import { useSettingsStore } from '../../../composables/useSettingsStore';
import { runHostAction, transport } from '../../../core/runtimeTransport';

const { settings, hasWorkspace, updateSetting } = useSettingsStore();

const announcements = computed<string[]>(() => {
  const value = settings.value?.companyAnnouncements;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
});

function openMemory(configType: 'user-claude-md' | 'project-claude-md' | 'local-claude-md'): void {
  runHostAction('open the memory file', () => transport.openConfigFile(configType));
}

function openAgentsTab(): void {
  runHostAction('open the Agents tab', () => transport.openForgeSettings('agents'));
}
</script>

<style scoped>
.memory__path {
  color: var(--forge-text-subtle);
  font-family: var(--app-monospace-font-family);
  font-size: 11px;
}
</style>
