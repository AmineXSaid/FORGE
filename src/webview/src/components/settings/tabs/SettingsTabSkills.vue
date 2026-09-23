<template>
  <SettingsTab title="Skills">
    <ForgeItemsList
      kind="skills"
      intro="A skill is a folder with a SKILL.md: instructions the model loads on its own when a task matches the description. Create one here, or add a folder you already have."
      empty-title="No skills yet"
      empty-text="Your first skill takes a name and one sentence about when to use it. Forge writes the SKILL.md and opens it."
      empty-icon="codicon-wand"
      :actions="[
        { id: 'create-skill', label: 'Create skill', icon: 'codicon-add' },
        { id: 'add-skill', label: 'Add from folder…', icon: 'codicon-folder-opened' },
      ]"
    />
  </SettingsTab>
</template>

<script setup lang="ts">
import SettingsTab from '../SettingsTab.vue';
import ForgeItemsList from '../ForgeItemsList.vue';
</script>
