<template>
  <SettingsTab title="Agents">
    <ForgeItemsList
      kind="agents"
      intro="Two kinds. A Claude Code agent is a helper the conversation hands tasks to, with its own instructions and tools. A Hermes agent is who Forge runs as for a whole conversation: its persona, model, memory and tools, chosen with Forge: Select Agent."
      empty-title="No agents yet"
      empty-text="Create agent asks which kind, then its name, when to use it and what it may touch. Forge writes the file and opens it."
      empty-icon="codicon-hubot"
      :actions="[{ id: 'create-agent', label: 'Create agent', icon: 'codicon-add' }]"
    />
  </SettingsTab>
</template>

<script setup lang="ts">
import SettingsTab from '../SettingsTab.vue';
import ForgeItemsList from '../ForgeItemsList.vue';
</script>
