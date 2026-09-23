<template>
  <div class="cursor-settings-sidebar">
    <div class="cursor-settings-sidebar-header">
      <div class="cursor-settings-sidebar-avatar">
        <ForgeMark :size="18" />
      </div>
      <div class="cursor-settings-sidebar-header-content">
        <p class="cursor-settings-sidebar-header-email">Forge</p>
        <p class="cursor-settings-sidebar-header-plan">Forge CLI</p>
      </div>
    </div>

    <!-- Profile Selector -->
    <div class="px-3">
      <ProfileSelector
        :model-value="currentProfileValue"
        @update:model-value="handleProfileSwitch"
        :options="profileOptions"
        class="w-full"
      />
    </div>

    <div class="cursor-settings-sidebar-content">
      <!--
        Search matches tab names and the settings inside each tab
        (settingsSearch.ts). Enter opens the best match, Escape clears, and
        Ctrl/Cmd+F anywhere on the page comes back here.
      -->
      <div class="cursor-settings-search">
        <span class="codicon codicon-search cursor-settings-search-icon" aria-hidden="true"></span>
        <input
          ref="searchEl"
          v-model="query"
          type="search"
          class="forge-field cursor-settings-search-input"
          :placeholder="`Search settings ${isMac ? '⌘' : 'Ctrl+'}F`"
          aria-label="Search settings"
          @keydown.enter.prevent="openFirstMatch"
          @keydown.esc.prevent="query = ''"
        />
      </div>
      <div class="cursor-settings-sidebar-cells" role="tablist" aria-orientation="vertical">
        <template v-for="tab in shownTabs" :key="tab.id">
          <div
            class="cursor-settings-sidebar-cell"
            :class="{ 'cursor-settings-sidebar-cell-active': activeTab === tab.id }"
            role="tab"
            tabindex="0"
            :aria-selected="activeTab === tab.id"
            :title="tab.label"
            @click="$emit('update:activeTab', tab.id)"
            @keydown.enter.prevent="$emit('update:activeTab', tab.id)"
            @keydown.space.prevent="$emit('update:activeTab', tab.id)"
          >
            <span :class="getIconClass(tab.icon)" style="font-size: 16px"></span>
            <span class="cursor-settings-sidebar-cell-label" :title="tab.label">{{
              tab.label
            }}</span>
          </div>
          <Separator v-if="tab.divider && !query" class="sidebar-divider" />
        </template>
        <p v-if="!shownTabs.length" class="cursor-settings-search-empty">No settings match "{{ query.trim() }}".</p>
      </div>
      <Separator class="sidebar-divider" />
      <div class="cursor-settings-sidebar-footer">
        <div
          class="cursor-settings-sidebar-cell"
          role="link"
          tabindex="0"
          title="Open the Forge documentation"
          @click="openDocs"
          @keydown.enter.prevent="openDocs"
        >
          <span class="codicon codicon-book" style="font-size: 16px"></span>
          <span class="cursor-settings-sidebar-cell-label">Docs</span>
          <span class="codicon codicon-link-external cursor-settings-external" aria-hidden="true"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ForgeMark from '../forge/ForgeMark.vue';
import { searchSettings } from './settingsSearch';
import { runHostAction, transport } from '../../core/runtimeTransport';
import ProfileSelector from './SettingsProfileSelector.vue';
import Separator from '../Common/Separator.vue';
import { useSettingsStore } from '../../composables/useSettingsStore';

const props = defineProps<{
  activeTab: string;
  tabs: Array<{ id: string; label: string; icon: string; divider?: boolean }>;
}>();

const emit = defineEmits<{
  (e: 'update:activeTab', id: string): void;
}>();

const { activeProfile, profiles, switchProfile } = useSettingsStore();

const query = ref('');
const searchEl = ref<HTMLInputElement | null>(null);
const shownTabs = computed(() => searchSettings(query.value, props.tabs));
const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

function openFirstMatch(): void {
  const first = shownTabs.value[0];
  if (first) emit('update:activeTab', first.id);
}

function openDocs(): void {
  runHostAction('open the docs', () => transport.openHelp());
}

// Ctrl/Cmd+F focuses the search, as the placeholder promises.
function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    searchEl.value?.focus();
    searchEl.value?.select();
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

const currentProfileValue = computed(() => activeProfile.value || 'default');

// No longer needed here if ProfileSelector computes label internally based on options,
// BUT ProfileSelector uses options prop.
const currentProfileLabel = computed(() => {
  if (!activeProfile.value) return 'Default Profile';
  return activeProfile.value;
});

const profileOptions = computed(() => {
  const opts = [{ label: 'Default Profile', value: 'default', description: 'Standard settings' }];

  // Add custom profiles
  if (profiles.value && profiles.value.length > 0) {
    profiles.value.forEach((p) => {
      opts.push({ label: p, value: p, description: 'Custom Profile' });
    });
  }

  // Manage action
  opts.push({
    label: 'Manage Profiles...',
    value: 'manage_profiles',
    description: 'Create or edit profiles'
  });

  return opts;
});

const handleProfileSwitch = (val: string) => {
  if (val === 'manage_profiles') {
    emit('update:activeTab', 'profiles');
  } else {
    const profile = val === 'default' ? null : val;
    switchProfile(profile);
  }
};

/**
 * 根据图标名称返回对应的 class
 * 支持 codicon (codicon-xxx) 和 mdi (mdi-xxx) 两种图标
 */
const getIconClass = (icon: string): string[] => {
  if (icon.startsWith('codicon-')) {
    return ['codicon', icon];
  } else if (icon.startsWith('mdi-')) {
    return ['mdi', icon];
  }
  // 默认当作 mdi 图标
  return ['mdi', icon];
};
</script>

<style scoped>
.cursor-settings-sidebar {
    box-sizing: border-box;
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    gap: 12px;
    max-height: 100vh;
    min-width: 100px;
    overflow: hidden;
    padding-top: 48px;
    position: sticky;
    top: 0;
    width: clamp(100px, 25%, 200px);
}

.cursor-settings-sidebar-header {
    align-items: center;
    display: flex;
    flex-direction: row;
    gap: 8px;
    overflow: hidden;
    width: 100%;
}

.cursor-settings-sidebar-avatar {
    align-items: center;
    /* background: var(--cursor-bg-tertiary); */
    /* border-radius: 50%; */
    color: var(--cursor-text-tertiary);
    display: flex;
    flex-shrink: 0;
    height: 28px;
    justify-content: center;
    width: 28px;
}

.cursor-settings-sidebar-header-content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    font-size: 12px;
    font-weight: 400;
    gap: 2px;
    line-height: 16px;
    min-width: 0;
    overflow: hidden;
}

.cursor-settings-sidebar-header-email {
    color: var(--cursor-text-primary);
}

.cursor-settings-sidebar-header-email,
.cursor-settings-sidebar-header-plan {
    display: block;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
}

.cursor-settings-sidebar-header-plan {
    color: var(--cursor-text-secondary);
}

.cursor-settings-sidebar-cells {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.cursor-settings-sidebar-cell {
    align-items: center;
    border-radius: 6px;
    color: var(--cursor-text-secondary);
    cursor: pointer;
    display: flex;
    font-size: 12px;
    gap: 8px;
    line-height: 16px;
    padding: 5px 8px;
    transition: background-color 120ms cubic-bezier(0.22, 1, 0.36, 1), color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}

.cursor-settings-sidebar-cell:focus-visible {
    outline: 2px solid var(--forge-focus-ring);
    outline-offset: -2px;
}

/*
 * A narrow panel: the sidebar folds to an icon rail, so the settings keep the
 * width instead of being cut off at the right edge. Each tab keeps its name as
 * a tooltip; the header, profile picker and search return when there is room.
 */
@media (max-width: 600px) {
    .cursor-settings-sidebar {
        min-width: 40px;
        width: 40px;
    }

    .cursor-settings-sidebar-header-content,
    .cursor-settings-sidebar-cell-label,
    .cursor-settings-sidebar-content > div:first-child,
    .px-3 {
        display: none;
    }

    .cursor-settings-sidebar-header,
    .cursor-settings-sidebar-cell {
        justify-content: center;
    }

    .cursor-settings-sidebar-cell {
        padding: 6px 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .cursor-settings-sidebar-cell {
        transition: none;
    }
}

.cursor-settings-search {
    position: relative;
}

.cursor-settings-search-icon {
    color: var(--forge-field-placeholder);
    font-size: 13px;
    left: 9px;
    pointer-events: none;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
}

.cursor-settings-search-input {
    padding-left: 28px;
    width: 100%;
}

.cursor-settings-search-input::-webkit-search-cancel-button {
    display: none;
}

.cursor-settings-search-empty {
    color: var(--cursor-text-tertiary);
    font-size: 12px;
    margin: 4px 8px;
}

.cursor-settings-external {
    color: var(--cursor-text-tertiary);
    font-size: 12px;
    margin-left: auto;
}

.cursor-settings-sidebar-cell-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* The current tab: the text colour and a tonal step, not the accent. */
.cursor-settings-sidebar-cell-active {
    background-color: var(--forge-surface);
    box-shadow: inset 0 0 0 1px var(--forge-hairline);
    color: var(--forge-text);
    font-weight: 500;
}

.cursor-settings-sidebar-cell:hover {
    background-color: var(--forge-surface-hover);
    color: var(--forge-text);
}

.cursor-settings-sidebar-cell-active:hover {
    background-color: var(--forge-surface);
}

.cursor-settings-sidebar-cell-notification-badge {
    align-items: center;
    background-color: var(--vscode-editorWarning-foreground);
    border-radius: 8px;
    color: var(--vscode-editor-background);
    display: flex;
    font-size: 10px;
    font-weight: 500;
    height: 14px;
    justify-content: center;
    margin-left: auto;
    width: 14px;
}

.sidebar-divider {
    margin: 8px 0;
}

.cursor-settings-sidebar-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.px-3 {
    padding-left: 12px;
    padding-right: 12px;
}
</style>
