<template>
  <!--
    The official "Past conversations" dropdown (reference `QW0`, module Wc_2Bg):
    an overlay and a panel anchored under the header's history button, holding
    the shared sessions list (`At`, SessionList.vue).

    QW0 mounts the list with no groups and no status feeds:

      F(At,{localSessions, localSessionsLoaded, …, activeSession, onSessionClick,
            onRenameSession, onArchiveSession, onUnarchiveSession, onOpenInNewWindow,
            currentCwd, authMethod, autoFocusSearch:!0, onOpenURL})

    so the search box is always shown and focused, a row offers rename and
    archive, and there is no status dot, right-click menu, filter or group.
    Those live in the session manager (SessionsPage.vue, `KW0`).
  -->
  <Teleport to="body">
    <div class="fg-sessionsdropdown__overlay" @mousedown.prevent="emit('close')"></div>
    <div
      ref="dropdownEl"
      class="fg-sessionsdropdown__dropdown"
      :style="position"
      role="dialog"
      aria-label="Past conversations"
      tabindex="-1"
      @keydown="onDropdownKeyDown"
    >
      <SessionList :loaded="loaded" auto-focus-search @open="open" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue';
import SessionList from './SessionList.vue';
import { RuntimeKey } from '../../composables/runtimeContext';
import { useSessionStore } from '../../composables/useSessionStore';
import type { Session } from '../../core/Session';

const props = defineProps<{ anchor: HTMLElement | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const runtime = inject(RuntimeKey)!;
const store = useSessionStore(runtime.sessionStore);
const dropdownEl = ref<HTMLElement | null>(null);
const loaded = ref(false);

/** Anchored 4px under the button, clamped 16px from the edge, as QW0 computes it. */
const position = computed(() => {
  const box = props.anchor?.getBoundingClientRect();
  if (!box) return {};
  const width = document.documentElement.clientWidth;
  return box.left + box.right < width
    ? { top: `${box.bottom + 4}px`, left: `${Math.max(16, box.left)}px` }
    : { top: `${box.bottom + 4}px`, right: `${Math.max(16, width - box.right)}px` };
});

/** `onSessionClick`: open it here and close the dropdown. */
function open(session: Session): void {
  store.setActiveSession(session);
  emit('close');
}

/** The list stops Escape while it is clearing a search; the next one closes. */
function onDropdownKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
}

onMounted(async () => {
  try {
    await store.listSessions();
  } catch (error) {
    // The rows already in the store stay; the dropdown still opens on them.
    console.warn('[SessionsDropdown] listing sessions failed', error);
  } finally {
    loaded.value = true;
  }
});
</script>
