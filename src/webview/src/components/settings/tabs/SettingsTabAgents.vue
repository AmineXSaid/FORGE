<template>
  <SettingsTab title="Agents">
    <ForgeItemsList
      kind="agents"
      intro="An agent is a focused helper the conversation can hand work to, with its own instructions and its own set of tools. Each one is a Markdown file the CLI reads."
      empty-title="No agents yet"
      empty-text="Name it, say when to use it, pick what it may touch. Forge writes the file and opens it for its instructions."
      empty-icon="codicon-hubot"
      :actions="[{ id: 'create-agent', label: 'Create agent', icon: 'codicon-add' }]"
    />
  </SettingsTab>
</template>

<script setup lang="ts">
import SettingsTab from '../SettingsTab.vue';
import ForgeItemsList from '../ForgeItemsList.vue';
</script>
