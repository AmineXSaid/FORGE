<template>
  <!--
    The desktop window's title bar (the window has no native frame): the
    project switcher on the left, the pane toggles and the window buttons on
    the right. Empty space drags the window; a double click maximises it.
  -->
  <header class="fd-titlebar" data-tauri-drag-region @dblclick.self="act('toggleMaximize')">
    <div class="fd-titlebar__brand" data-tauri-drag-region>
      <ForgeCubeMark :size="16" />
    </div>

    <div class="fd-titlebar__project">
      <button
        ref="projectButton"
        type="button"
        class="fd-titlebar__projectButton"
        :title="info?.workspace ?? 'Open a project'"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <span class="codicon codicon-folder" aria-hidden="true" />
        <span class="fd-titlebar__projectName">{{ info?.name ?? 'No project' }}</span>
        <span class="codicon codicon-chevron-down fd-titlebar__chevron" aria-hidden="true" />
      </button>
      <span v-if="branch" class="fd-titlebar__branch" :title="`Branch ${branch}`">
        <span class="codicon codicon-git-branch" aria-hidden="true" />{{ branch }}
      </span>

      <div v-if="menuOpen" class="fd-titlebar__menu" role="menu" @keydown.esc="menuOpen = false">
        <div class="fd-titlebar__menuLabel">Recent projects</div>
        <button
          v-for="p in info?.recent ?? []"
          :key="p.path"
          type="button"
          role="menuitem"
          class="fd-titlebar__menuItem"
          :class="{ 'fd-titlebar__menuItemCurrent': p.path === info?.workspace }"
          :title="p.path"
          @click="open(p.path)"
        >
          <span class="codicon" :class="p.path === info?.workspace ? 'codicon-check' : 'codicon-folder'" aria-hidden="true" />
          <span class="fd-titlebar__menuName">{{ p.name }}</span>
          <span class="fd-titlebar__menuPath">{{ p.path }}</span>
        </button>
        <div class="fd-titlebar__menuSeparator" />
        <button type="button" role="menuitem" class="fd-titlebar__menuItem" @click="open()">
          <span class="codicon codicon-folder-opened" aria-hidden="true" />
          <span class="fd-titlebar__menuName">Open folder…</span>
        </button>
      </div>
    </div>

    <div class="fd-titlebar__spacer" data-tauri-drag-region />

    <div class="fd-titlebar__actions">
      <button
        type="button"
        class="fd-titlebar__iconButton"
        :class="{ 'fd-titlebar__iconButtonOn': sidebarOpen }"
        title="Toggle sidebar (Ctrl+B)"
        aria-label="Toggle sidebar"
        @click="emit('toggleSidebar')"
      >
        <span class="codicon codicon-layout-sidebar-left" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="fd-titlebar__changesButton"
        :class="{ 'fd-titlebar__iconButtonOn': changesOpen }"
        title="Changes (Ctrl+Shift+D)"
        aria-label="Toggle the Changes pane"
        @click="emit('toggleChanges')"
      >
        <span class="codicon codicon-diff" aria-hidden="true" />
        <template v-if="additions || deletions">
          <span class="fd-titlebar__added">+{{ additions }}</span>
          <span class="fd-titlebar__deleted">−{{ deletions }}</span>
        </template>
        <span v-else>Changes</span>
      </button>
    </div>

    <div v-if="showWindowButtons" class="fd-titlebar__window">
      <button type="button" class="fd-titlebar__windowButton" aria-label="Minimize" @click="act('minimize')">
        <span class="codicon codicon-chrome-minimize" aria-hidden="true" />
      </button>
      <button type="button" class="fd-titlebar__windowButton" aria-label="Maximize" @click="act('toggleMaximize')">
        <span class="codicon codicon-chrome-maximize" aria-hidden="true" />
      </button>
      <button type="button" class="fd-titlebar__windowButton fd-titlebar__close" aria-label="Close" @click="act('close')">
        <span class="codicon codicon-chrome-close" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ForgeCubeMark from '../components/forge/ForgeCubeMark.vue';
import { desktopHost, type DesktopInfo, type WindowAction } from './desktopHost';

const props = defineProps<{
  info: DesktopInfo | undefined;
  branch: string | null;
  additions: number;
  deletions: number;
  sidebarOpen: boolean;
  changesOpen: boolean;
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  toggleChanges: [];
}>();

const menuOpen = ref(false);
const projectButton = ref<HTMLElement>();

/** macOS draws its own traffic lights; elsewhere the shell draws the buttons. */
const showWindowButtons = computed(() => props.info?.platform !== 'macos');

function act(action: WindowAction): void {
  void desktopHost()?.windowAction(action);
}

function open(path?: string): void {
  menuOpen.value = false;
  if (path && path === props.info?.workspace) return;
  void desktopHost()?.openProject(path);
}

function onDocumentPointer(event: PointerEvent): void {
  if (!menuOpen.value) return;
  const root = projectButton.value?.parentElement;
  if (root && !root.contains(event.target as Node)) menuOpen.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onDocumentPointer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer));
</script>

<style scoped>
.fd-titlebar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  flex: none;
  padding-left: 12px;
  background: var(--vscode-titleBar-activeBackground, var(--app-root-background));
  color: var(--vscode-titleBar-activeForeground, var(--app-primary-foreground));
  border-bottom: 1px solid var(--vscode-titleBar-border, var(--app-widget-border));
  user-select: none;
}

.fd-titlebar__brand {
  display: flex;
  align-items: center;
  padding-right: 4px;
}

.fd-titlebar__project {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.fd-titlebar__projectButton,
.fd-titlebar__iconButton,
.fd-titlebar__changesButton,
.fd-titlebar__windowButton,
.fd-titlebar__menuItem {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.fd-titlebar__projectButton {
  height: 26px;
  padding: 0 8px;
  border-radius: var(--corner-radius-medium);
  font-weight: 600;
  max-width: 320px;
}

.fd-titlebar__projectButton:hover,
.fd-titlebar__iconButton:hover,
.fd-titlebar__changesButton:hover {
  background: var(--app-list-hover-background);
}

.fd-titlebar__projectName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fd-titlebar__chevron {
  opacity: 0.7;
}

.fd-titlebar__branch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  white-space: nowrap;
}

.fd-titlebar__spacer {
  flex: 1;
  align-self: stretch;
}

.fd-titlebar__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
}

.fd-titlebar__iconButton {
  justify-content: center;
  width: 28px;
  height: 26px;
  border-radius: var(--corner-radius-medium);
}

.fd-titlebar__changesButton {
  height: 26px;
  padding: 0 8px;
  border-radius: var(--corner-radius-medium);
  font-size: 12px;
}

.fd-titlebar__iconButtonOn {
  background: var(--app-list-active-background);
}

.fd-titlebar__added {
  color: var(--app-diff-addition-foreground);
}

.fd-titlebar__deleted {
  color: var(--app-diff-deletion-foreground);
}

.fd-titlebar__window {
  display: flex;
  align-self: stretch;
}

.fd-titlebar__windowButton {
  justify-content: center;
  width: 46px;
}

.fd-titlebar__windowButton:hover {
  background: var(--app-list-hover-background);
}

.fd-titlebar__close:hover {
  background: var(--app-error-foreground);
  color: var(--app-button-foreground);
}

.fd-titlebar__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 300px;
  max-width: 460px;
  padding: 4px;
  background: var(--app-menu-background);
  border: 1px solid var(--app-menu-border);
  border-radius: var(--corner-radius-large);
  box-shadow: var(--cursor-box-shadow-lg);
}

.fd-titlebar__menuLabel {
  padding: 6px 8px 4px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.fd-titlebar__menuItem {
  width: 100%;
  padding: 6px 8px;
  border-radius: var(--corner-radius-small);
  text-align: left;
}

.fd-titlebar__menuItem:hover {
  background: var(--app-menu-selection-background);
  color: var(--app-menu-selection-foreground);
}

.fd-titlebar__menuItemCurrent .fd-titlebar__menuName {
  font-weight: 600;
}

.fd-titlebar__menuName {
  white-space: nowrap;
}

.fd-titlebar__menuPath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  text-align: right;
}

.fd-titlebar__menuSeparator {
  height: 1px;
  margin: 4px 0;
  background: var(--app-menu-border);
}
</style>
