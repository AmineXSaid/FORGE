<template>
  <!--
    The official group header (`uF1`, module OOQiHg), used for each session
    group, "Ungrouped" and "Archived sessions":

      R("button",{className:`${H5.groupHeader} ${X?H5.dropTarget:""}`,
        onClick:Y?void 0:Q, onContextMenu:Y?void 0:G,
        onDragEnter/onDragOver:U, onDragLeave:V, onDrop:H, onKeyDown:(j)=>W95(j,Q),
        title: !Q ? $ : J ? `Expand ${$}` : `Collapse ${$}`,
        children:[ F(AF1,{className:`${H5.groupChevron} ${J?"":H5.groupChevronExpanded}`}),
                   Y ? <contenteditable name> : F("span",{className:H5.groupName, children:$}),
                   F("span",{className:H5.groupCount, children:Z}) ]})

    While its name is being edited the header takes no clicks, menus or drops.
  -->
  <button
    :class="['fg-sessions__groupHeader', { 'fg-sessions__dropTarget': isDropTarget }]"
    :title="!toggleable ? name : collapsed ? `Expand ${name}` : `Collapse ${name}`"
    @click="!isRenaming && toggleable && emit('toggle')"
    @contextmenu="!isRenaming && emit('contextmenu', $event)"
    @dragenter="!isRenaming && emit('dragover', $event)"
    @dragover="!isRenaming && emit('dragover', $event)"
    @dragleave="!isRenaming && emit('dragleave', $event)"
    @drop="!isRenaming && emit('drop', $event)"
    @keydown="onKeyDown"
  >
    <GroupChevronIcon :class="['fg-sessions__groupChevron', { 'fg-sessions__groupChevronExpanded': !collapsed }]" />
    <span
      v-if="isRenaming"
      key="edit"
      ref="editorEl"
      class="fg-sessions__groupName fg-sessions__groupNameEditing"
      contenteditable="true"
      @keydown="onEditorKeyDown"
      @blur="onEditorBlur"
      @click.stop
    >{{ name }}</span>
    <span v-else key="view" class="fg-sessions__groupName">{{ name }}</span>
    <span class="fg-sessions__groupCount">{{ count }}</span>
  </button>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import GroupChevronIcon from './icons/GroupChevronIcon.vue';

const props = withDefaults(
  defineProps<{
    name: string;
    collapsed: boolean;
    count: number;
    isRenaming?: boolean;
    isDropTarget?: boolean;
    /** `onToggleCollapsed` is passed (Archived's is not while searching). */
    toggleable?: boolean;
  }>(),
  { isRenaming: false, isDropTarget: false, toggleable: true }
);

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'contextmenu', event: MouseEvent): void;
  (e: 'finishRename', text: string): void;
  (e: 'cancelRename'): void;
  (e: 'dragover', event: DragEvent): void;
  (e: 'dragleave', event: DragEvent): void;
  (e: 'drop', event: DragEvent): void;
}>();

const editorEl = ref<HTMLElement | null>(null);
let mounted = true;
onBeforeUnmount(() => {
  mounted = false;
});

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

/** `W95`: Enter and Space toggle. */
function onKeyDown(event: KeyboardEvent): void {
  if (props.isRenaming) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.stopPropagation();
  if (props.toggleable) emit('toggle');
}

function onEditorKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    editorEl.value?.blur();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (editorEl.value) editorEl.value.textContent = props.name;
    emit('cancelRename');
  }
}

function onEditorBlur(): void {
  if (props.isRenaming && mounted && editorEl.value) emit('finishRename', editorEl.value.textContent || '');
}
</script>
