<template>
  <!--
    The official session row (`V95`, module OOQiHg):

      R("button",{id, className:`${H5.sessionItem} ${Y?H5.active:""} ${X?H5.focused:""} ${Q?H5.selected:""}`,
                  onClick, onContextMenu, onFocus, onKeyDown, onMouseMove, draggable, onDragStart, onDragEnd,
        children:[ T && F(vG,{state:T, ring:…, title:dH0(T,E)}),
                   G ? <contenteditable name> : F("span",{className:H5.sessionName, children:XW0(kR(J),z)}),
                   <worktree pill>,
                   R("span",{className:H5.sessionMeta, children:[
                     F("span",{className:H5.sessionTime, children:K95(J.lastModifiedTime.value)}),
                     !G && !S && (j||w||N) && R("span",{className:H5.sessionActions, children:[
                       rename, archive, unarchive ]}) ]}) ]})

    The listeners the list passes (click, contextmenu, focus, mousemove,
    dragstart, dragend) fall through to the button.
  -->
  <button
    :ref="(el) => rowRef?.(el as HTMLElement | null)"
    :id="id"
    :class="[
      'fg-sessions__sessionItem',
      { 'fg-sessions__active': isActive, 'fg-sessions__focused': isFocused, 'fg-sessions__selected': isSelected },
    ]"
    :draggable="draggable"
    @keydown="onKeyDown"
  >
    <StatusDot v-if="openState" :state="openState" :title="openStateTitle(openState)" />
    <span
      v-if="isRenaming"
      key="edit"
      ref="editorEl"
      class="fg-sessions__sessionName fg-sessions__sessionNameEditing"
      contenteditable="true"
      @keydown="onEditorKeyDown"
      @blur="onEditorBlur"
      @click.stop
    >{{ title }}</span>
    <span v-else key="view" class="fg-sessions__sessionName">
      <template v-for="(part, i) in highlight(title, searchQuery)" :key="i">
        <mark v-if="part.match" class="fg-sessions__highlight">{{ part.text }}</mark>
        <template v-else>{{ part.text }}</template>
      </template>
    </span>
    <span class="fg-sessions__sessionMeta">
      <span class="fg-sessions__sessionTime">{{ formatRelativeTime(time) }}</span>
      <span v-if="!isRenaming && !blank && (canRename || canArchive || canUnarchive)" class="fg-sessions__sessionActions">
        <span
          v-if="canRename"
          role="button"
          tabindex="0"
          class="fg-sessions__actionButton"
          title="Rename session"
          @click.stop="emit('startRename')"
          @keydown="onActionKey($event, 'startRename')"
        >
          <RenameIcon class="fg-sessions__actionIcon" />
        </span>
        <span
          v-if="canArchive"
          role="button"
          tabindex="0"
          class="fg-sessions__actionButton"
          title="Archive session"
          @click.stop="emit('archive')"
          @keydown="onActionKey($event, 'archive')"
        >
          <ArchiveIcon class="fg-sessions__actionIcon" />
        </span>
        <span
          v-if="canUnarchive"
          role="button"
          tabindex="0"
          class="fg-sessions__actionButton"
          title="Unarchive session"
          @click.stop="emit('unarchive')"
          @keydown="onActionKey($event, 'unarchive')"
        >
          <UnarchiveIcon class="fg-sessions__actionIcon" />
        </span>
      </span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import StatusDot from './StatusDot.vue';
import RenameIcon from './icons/RenameIcon.vue';
import ArchiveIcon from './icons/ArchiveIcon.vue';
import UnarchiveIcon from './icons/UnarchiveIcon.vue';
import { formatRelativeTime } from '../../utils/relativeTime';
import { openStateTitle, type SessionOpenState } from '../../core/sessionStates';

const props = defineProps<{
  id: string;
  rowRef?: (el: HTMLElement | null) => void;
  title: string;
  time: number;
  isActive: boolean;
  isFocused: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  searchQuery: string;
  draggable: boolean;
  blank: boolean;
  canRename: boolean;
  canArchive: boolean;
  canUnarchive: boolean;
  openState?: SessionOpenState;
}>();

const emit = defineEmits<{
  (e: 'modifiedEnter', event: KeyboardEvent): void;
  (e: 'startRename'): void;
  (e: 'finishRename', text: string): void;
  (e: 'cancelRename'): void;
  (e: 'archive'): void;
  (e: 'unarchive'): void;
}>();

const editorEl = ref<HTMLElement | null>(null);
let mounted = true;
onBeforeUnmount(() => {
  mounted = false;
});

/** The official effect: focus the editor with its text selected. */
watch(
  () => props.isRenaming,
  async (renaming) => {
    if (!renaming) return;
    await nextTick();
    const el = editorEl.value;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  },
  { immediate: true }
);

/** `onKeyDown`: Enter with a modifier opens (or selects) even from the row itself. */
function onKeyDown(event: KeyboardEvent): void {
  if (props.isRenaming) return;
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || event.shiftKey)) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) emit('modifiedEnter', event);
  }
}

/** `i(m)`: Enter commits (by blurring), Escape puts the old title back. */
function onEditorKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    editorEl.value?.blur();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (editorEl.value) editorEl.value.textContent = props.title;
    emit('cancelRename');
  }
}

/** `s()`: blur commits while the row is still mounted and renaming. */
function onEditorBlur(): void {
  if (props.isRenaming && mounted && editorEl.value) emit('finishRename', editorEl.value.textContent || '');
}

function onActionKey(event: KeyboardEvent, action: 'startRename' | 'archive' | 'unarchive'): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.stopPropagation();
  if (action === 'startRename') emit('startRename');
  else if (action === 'archive') emit('archive');
  else emit('unarchive');
}

/** `XW0`: every match wrapped in <mark>, recursively. */
function highlight(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query) return [{ text, match: false }];
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return [{ text, match: false }];
  return [
    { text: text.slice(0, at), match: false },
    { text: text.slice(at, at + query.length), match: true },
    ...highlight(text.slice(at + query.length), query),
  ];
}
</script>
