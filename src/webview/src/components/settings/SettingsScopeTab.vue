<template>
  <!--
    Where a change is written. With no workspace there is only one place --
    the user settings file -- so the control collapses to a note saying so,
    instead of a switch with two greyed-out segments that can never be picked.
  -->
  <p v-if="!hasWorkspace" class="scope-note">
    <span class="codicon codicon-account" aria-hidden="true" />
    Saved to your user settings{{ activeProfile ? ` (${activeProfile})` : '' }}
  </p>
  <TabsRoot
    v-else
    v-model="model"
    class="scope-tabs"
  >
    <TabsList class="scope-tabs-list" aria-label="Where changes are saved">
      <TabsTrigger value="global" class="scope-tab-trigger" title="Your user settings, for every project">
        <span class="codicon codicon-account" />
        <span>{{ activeProfile ? `User (${activeProfile})` : 'User' }}</span>
      </TabsTrigger>
      <TabsTrigger value="shared" class="scope-tab-trigger" title="This workspace, shared with the team (.claude/settings.json)">
        <span class="codicon codicon-folder" />
        <span>Workspace</span>
      </TabsTrigger>
      <TabsTrigger value="local" class="scope-tab-trigger" title="This workspace, just you (.claude/settings.local.json)">
        <span class="codicon codicon-lock" />
        <span>Local</span>
      </TabsTrigger>
      <TabsIndicator class="scope-tabs-indicator" />
    </TabsList>
  </TabsRoot>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsIndicator
} from 'reka-ui';
import type { SettingsScope } from '../../composables/useSettingsStore';

const props = defineProps<{
  modelValue: SettingsScope;
  hasWorkspace: boolean;
  activeProfile?: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: SettingsScope): void;
}>();

const model = computed({
  get: () => props.modelValue,
  set: (val: string) => emit('update:modelValue', val as SettingsScope)
});
</script>

<style scoped>
.scope-note {
  align-items: center;
  color: var(--cursor-text-secondary);
  display: inline-flex;
  font-size: 11px;
  gap: 6px;
  margin: 0;
}

.scope-note .codicon {
  font-size: 12px;
}

.scope-tabs {
  align-items: center;
  display: flex;
}

/* A segmented control on the surface tokens: hairline, one tonal step. */
.scope-tabs-list {
  align-items: center;
  background: var(--forge-surface);
  border: 1px solid var(--forge-hairline);
  border-radius: 8px;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  position: relative;
}

.scope-tab-trigger {
  all: unset;
  align-items: center;
  border-radius: 6px;
  color: var(--cursor-text-secondary);
  cursor: pointer;
  display: inline-flex;
  font-size: 11px;
  font-weight: 500;
  gap: 5px;
  line-height: 1;
  padding: 5px 10px;
  position: relative;
  transition: color 120ms cubic-bezier(0.22, 1, 0.36, 1);
  user-select: none;
  white-space: nowrap;
  z-index: 1;
}

.scope-tab-trigger .codicon {
  font-size: 12px;
}

.scope-tab-trigger:hover {
  color: var(--cursor-text-primary);
}

.scope-tab-trigger[data-state='active'] {
  color: var(--cursor-text-primary);
}

.scope-tab-trigger:focus-visible {
  outline: 2px solid var(--forge-focus-ring);
  outline-offset: 1px;
}

.scope-tabs-indicator {
  background: var(--forge-surface-deep);
  border-radius: 6px;
  height: calc(100% - 4px);
  left: 0;
  position: absolute;
  top: 2px;
  transform: translateX(var(--reka-tabs-indicator-position));
  transition: width 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  width: var(--reka-tabs-indicator-size);
}

@media (prefers-reduced-motion: reduce) {
  .scope-tab-trigger,
  .scope-tabs-indicator {
    transition: none;
  }
}
</style>
