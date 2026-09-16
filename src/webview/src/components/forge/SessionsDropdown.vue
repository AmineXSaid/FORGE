<template>
  <!--
    The official "Past conversations" dropdown (reference `QW0` wrapping the
    sessions list `At`; modules Wc_2Bg + OOQiHg + 90gk3A).

    Copied from the bundle, with one intentional omission: the Local / Web
    segmented control. The official itself renders it only for claude.ai
    accounts (`s = authMethod === "claudeai"`); Forge has local sessions only.

    Configuration matches how QW0 mounts the list: not `isSessionListOnly`, so the
    search box is always shown and there is no clear button, status filter or
    "New group" button; the search input is focused on open.
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
      <div class="fg-sessions__root" @keydown="onListKeyDown">
        <div class="fg-sessions__searchRow">
          <div class="fg-sessions__searchBox">
            <SearchIcon class="fg-sessions__searchIcon" />
            <input
              ref="searchEl"
              v-model="query"
              type="text"
              placeholder="Search sessions…"
              class="fg-filter__filterInput fg-sessions__searchInput"
              :aria-controls="contentId"
              :aria-activedescendant="focusedId"
            />
          </div>
          <div class="fg-sessions__searchRowActions"></div>
          <span class="fg-sessions__searchRowTail"></span>
        </div>
        <div :id="contentId" class="fg-sessions__content">
          <div v-if="!loaded" class="fg-sessions__disconnectedState">
            <div class="fg-sessions__disconnectedText">Loading sessions…</div>
          </div>
          <div v-else-if="!sessions.length" class="fg-sessions__nullState">
            <div class="fg-sessions__nullStateText">No sessions yet</div>
          </div>
          <div v-else-if="!filtered.length" class="fg-sessions__emptyState">No sessions found</div>
          <div v-else class="fg-sessions__sessionsList">
            <button
              v-for="(session, index) in filtered"
              :id="rowId(index)"
              :key="session.sessionId.value ?? index"
              :ref="(el) => { if (el) rowEls[index] = el as HTMLElement }"
              class="fg-sessions__sessionItem"
              :class="{
                'fg-sessions__active': isActive(session),
                'fg-sessions__focused': index === focusedIndex,
              }"
              @click="open(session)"
              @focus="focusedIndex = index"
              @mousemove="focusedIndex = index"
            >
              <span class="fg-sessions__sessionName">
                <template v-for="(part, pi) in highlight(title(session), query)" :key="pi">
                  <mark v-if="part.match" class="fg-sessions__highlight">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span class="fg-sessions__sessionMeta">
                <span class="fg-sessions__sessionTime">{{ relativeTime(session.lastModifiedTime.value) }}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, nextTick, watch } from 'vue';
import SearchIcon from './icons/SearchIcon.vue';
import { RuntimeKey } from '../../composables/runtimeContext';
import { useSessionStore } from '../../composables/useSessionStore';
import { useSession } from '../../composables/useSession';
import type { Session } from '../../core/Session';

const props = defineProps<{ anchor: HTMLElement | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const runtime = inject(RuntimeKey)!;
const store = useSessionStore(runtime.sessionStore);

const loaded = ref(false);
const query = ref('');
const focusedIndex = ref(0);
const searchEl = ref<HTMLInputElement | null>(null);
const dropdownEl = ref<HTMLElement | null>(null);
const rowEls: HTMLElement[] = [];
const uid = Math.random().toString(36).slice(2, 8);
const contentId = `forge-sessions-${uid}`;
const rowId = (i: number) => `${contentId}-row-${i}`;
const focusedId = computed(() => (filtered.value.length ? rowId(focusedIndex.value) : undefined));

const sessions = computed(() =>
  ((store.sessionsByLastModified.value || []).filter(Boolean) as Session[]).map((raw) => ({
    ...useSession(raw),
    raw,
  }))
);

/**
 * The open conversation, compared by identity. Comparing ids marked every row
 * active whenever the open conversation had no id yet: undefined === undefined.
 */
const activeRaw = computed(() => store.activeSession.value);
const isActive = (session: { raw: Session }) => session.raw === activeRaw.value;

/** The official title: the summary, or "Untitled" (its `kR`). */
const title = (s: ReturnType<typeof useSession>) => s.summary.value || 'Untitled';

/** The official search: case-insensitive substring of the title (its `KZ`). */
const filtered = computed(() => {
  const q = query.value.toLowerCase();
  return q ? sessions.value.filter((s) => title(s).toLowerCase().includes(q)) : sessions.value;
});
watch(query, () => { focusedIndex.value = 0; });

/** Every match wrapped in <mark>, recursively, like the official `XW0`. */
function highlight(text: string, q: string): Array<{ text: string; match: boolean }> {
  if (!q) return [{ text, match: false }];
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return [{ text, match: false }];
  return [
    { text: text.slice(0, at), match: false },
    { text: text.slice(at, at + q.length), match: true },
    ...highlight(text.slice(at + q.length), q),
  ];
}

/** The official relative time (its `K95`): y, mo, d, h, m, or "now". */
function relativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'now';
}

/** Anchored 4px under the button, clamped 16px from the edge, as QW0 computes it. */
const position = computed(() => {
  const box = props.anchor?.getBoundingClientRect();
  if (!box) return {};
  const width = document.documentElement.clientWidth;
  return box.left + box.right < width
    ? { top: `${box.bottom + 4}px`, left: `${Math.max(16, box.left)}px` }
    : { top: `${box.bottom + 4}px`, right: `${Math.max(16, width - box.right)}px` };
});

function open(session: ReturnType<typeof useSession>): void {
  store.setActiveSession(session.__session);
  emit('close');
}

function onListKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const rows = filtered.value;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (rows.length) focusedIndex.value = (focusedIndex.value + 1) % rows.length;
      void nextTick(() => rowEls[focusedIndex.value]?.scrollIntoView({ block: 'nearest' }));
      break;
    case 'ArrowUp':
      event.preventDefault();
      if (rows.length) focusedIndex.value = (focusedIndex.value - 1 + rows.length) % rows.length;
      void nextTick(() => rowEls[focusedIndex.value]?.scrollIntoView({ block: 'nearest' }));
      break;
    case 'Enter': {
      const row = rows[focusedIndex.value];
      if (row && !event.repeat) { event.preventDefault(); open(row); }
      break;
    }
    case 'Escape':
      // First Escape clears the search; the next one closes the dropdown.
      if (query.value) { event.preventDefault(); event.stopPropagation(); query.value = ''; }
      break;
  }
}

function onDropdownKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); }
}

onMounted(async () => {
  searchEl.value?.focus();
  try {
    await store.listSessions();
  } finally {
    loaded.value = true;
  }
});
</script>
