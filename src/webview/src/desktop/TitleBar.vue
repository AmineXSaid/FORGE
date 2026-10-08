<template>
  <!--
    The desktop window's title bar (the window has no native frame), in Forge
    Desktop's design (forge-desktop docs/DESIGN.md §4):
    - left: the sidebar toggle, the project (serif) with its recent projects,
      the branch as a mono pill tag (Monad);
    - centre: the frosted nav pill (GI): Session, Changes with the +/- totals,
      and the dark "New session" segment with its circled chevron;
    - right: the window buttons.
    Empty space drags the window; a double click maximises it.
  -->
  <header class="fd-titlebar" data-tauri-drag-region @dblclick.self="act('toggleMaximize')">
    <div class="fd-titlebar__left" data-tauri-drag-region>
      <button
        type="button"
        class="fd-titlebar__icon"
        :class="{ 'fd-titlebar__iconOn': sidebarOpen }"
        title="Toggle sidebar (Ctrl+B)"
        aria-label="Toggle sidebar"
        @click="emit('toggleSidebar')"
      >
        <span class="codicon codicon-layout-sidebar-left" aria-hidden="true" />
      </button>

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
          <span class="fd-serif fd-titlebar__projectName">{{ info?.name ?? 'No project' }}</span>
          <span class="codicon codicon-chevron-down fd-titlebar__chevron" aria-hidden="true" />
        </button>
        <span v-if="branch" class="fd-tag" :title="`Branch ${branch}`">
          <span class="codicon codicon-git-branch fd-titlebar__tagIcon" aria-hidden="true" />{{ branch }}
        </span>

        <div v-if="menuOpen" class="fd-titlebar__menu" role="menu" @keydown.esc="menuOpen = false">
          <div class="fd-label fd-titlebar__menuLabel">Recent projects</div>
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
            <span class="fd-caption fd-titlebar__menuPath">{{ p.path }}</span>
          </button>
          <div class="fd-titlebar__menuSeparator" />
          <button type="button" role="menuitem" class="fd-titlebar__menuItem" @click="open()">
            <span class="codicon codicon-folder-opened" aria-hidden="true" />
            <span class="fd-titlebar__menuName">Open folder…</span>
            <span class="fd-caption fd-titlebar__menuPath">Ctrl+O</span>
          </button>
        </div>
      </div>
    </div>

    <nav class="fd-titlebar__nav" aria-label="Views">
      <ForgeCubeMark :size="15" class="fd-titlebar__mark" />
      <button
        type="button"
        class="fd-label fd-titlebar__navItem"
        :class="{ 'fd-titlebar__navItemOn': view === 'chat' }"
        title="The session (Forge has one kind: it chats and codes)"
        @click="emit('showChat')"
      >
        Session
      </button>
      <button
        type="button"
        class="fd-label fd-titlebar__navItem"
        :class="{ 'fd-titlebar__navItemOn': changesOpen }"
        title="Changes (Ctrl+Shift+D)"
        @click="emit('toggleChanges')"
      >
        Changes
        <template v-if="additions || deletions">
          <span class="fd-titlebar__added">+{{ additions }}</span>
          <span class="fd-titlebar__deleted">−{{ deletions }}</span>
        </template>
      </button>
      <button
        type="button"
        class="fd-label fd-titlebar__navItem"
        :class="{ 'fd-titlebar__navItemOn': view === 'settings' }"
        title="Settings (Ctrl+,)"
        @click="emit('toggleSettings')"
      >
        Settings
      </button>
      <button type="button" class="fd-pill fd-pill--dark fd-titlebar__cta" title="New session (Ctrl+N)" @click="emit('newSession')">
        New session <span class="fd-chevron" aria-hidden="true">›</span>
      </button>
    </nav>

    <div class="fd-titlebar__spacer" data-tauri-drag-region />

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
  view: 'chat' | 'settings';
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  toggleChanges: [];
  toggleSettings: [];
  showChat: [];
  newSession: [];
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

defineExpose({ openProjectMenu: () => (menuOpen.value = true) });
</script>

<style scoped>
.fd-titlebar {
  position: relative;
  display: flex;
  align-items: center;
  height: 48px;
  flex: none;
  padding-left: 10px;
  background: var(--fd-chrome);
  color: var(--fd-ink);
  border-bottom: 1px solid var(--fd-edge-chrome);
  user-select: none;
}

.fd-titlebar__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.fd-titlebar__icon,
.fd-titlebar__projectButton,
.fd-titlebar__navItem,
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

.fd-titlebar__icon {
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--fd-pill);
  color: var(--fd-muted);
}

.fd-titlebar__icon:hover {
  background: var(--fd-hover);
  color: var(--fd-ink);
}

.fd-titlebar__iconOn {
  color: var(--fd-ink);
}

.fd-titlebar__project {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.fd-titlebar__projectButton {
  height: 30px;
  padding: 0 8px;
  border-radius: var(--fd-pill);
  max-width: 260px;
}

.fd-titlebar__projectButton:hover {
  background: var(--fd-hover);
}

.fd-titlebar__projectName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
}

.fd-titlebar__chevron {
  color: var(--fd-muted);
}

.fd-titlebar__tagIcon {
  font-size: 11px;
}

/* GI's floating frosted nav pill, centred over the window. */
.fd-titlebar__nav {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 2px;
  height: 36px;
  padding: 0 4px 0 12px;
  border: 1px solid var(--fd-edge-paper);
  border-radius: var(--fd-pill);
  background: var(--fd-glass);
  backdrop-filter: var(--fd-blur);
  box-shadow: var(--fd-shadow-nav);
}

.fd-titlebar__mark {
  margin-right: 6px;
}

.fd-titlebar__navItem {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--fd-pill);
  color: var(--fd-muted);
}

.fd-titlebar__navItem:hover {
  color: var(--fd-ink);
}

.fd-titlebar__navItemOn {
  color: var(--fd-ink);
  background: var(--fd-linen);
  box-shadow: inset 0 0 0 1px var(--fd-edge-paper);
}

.fd-titlebar__added {
  color: var(--fd-good);
}

.fd-titlebar__deleted {
  color: var(--fd-bad);
}

.fd-titlebar__cta {
  margin-left: 4px;
}

.fd-titlebar__spacer {
  flex: 1;
  align-self: stretch;
}

.fd-titlebar__window {
  display: flex;
  align-self: stretch;
}

.fd-titlebar__windowButton {
  justify-content: center;
  width: 46px;
  color: var(--fd-muted);
}

.fd-titlebar__windowButton:hover {
  background: var(--fd-hover);
  color: var(--fd-ink);
}

.fd-titlebar__close:hover {
  background: var(--fd-bad);
  color: var(--fd-white);
}

.fd-titlebar__menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 50;
  min-width: 320px;
  max-width: 480px;
  padding: 6px;
  background: var(--fd-paper);
  border: 1px solid var(--fd-edge-paper);
  border-radius: var(--fd-radius-card);
  box-shadow: var(--fd-shadow-card);
}

.fd-titlebar__menuLabel {
  padding: 6px 8px 6px;
  color: var(--fd-muted);
}

.fd-titlebar__menuItem {
  width: 100%;
  padding: 7px 8px;
  border-radius: 8px;
  text-align: left;
  color: var(--fd-ink);
}

.fd-titlebar__menuItem:hover {
  background: var(--fd-selected);
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
  text-align: right;
}

.fd-titlebar__menuSeparator {
  height: 1px;
  margin: 6px 0;
  background: var(--fd-edge-paper);
}
</style>
