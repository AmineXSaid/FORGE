<template>
  <!--
    The official composer "+" button and its menu (reference `pV0`, module Lu5mZA).

    Items are built the way the official builds them: "Upload from computer" only
    when attaching is possible, "Add context" only when @-mentions are, and
    "Browse the web" only when browser integration is supported. That last flag
    is the host's `browserIntegrationSupported` on the init state (step 28), so
    a build with no Claude binary -- and therefore no `--claude-in-chrome-mcp`
    server -- leaves the row out rather than offering it broken.
  -->
  <div class="fg-addmenu__addButtonContainer">
    <button
      ref="buttonEl"
      type="button"
      class="fg-addmenu__addButton fg-addmenu__addButtonSquare"
      title="Add"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <PlusIcon />
    </button>
    <Transition name="forge-pop">
      <div v-if="open" ref="popupEl" class="fg-addmenu__menuPopup">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="fg-addmenu__menuItem"
          :title="item.title"
          @click="item.onSelect"
        >
          <span class="fg-addmenu__menuItemIcon"><component :is="item.icon" /></span>
          <span class="fg-addmenu__menuItemLabel">{{ item.label }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, type Component } from 'vue';
import PlusIcon from './icons/PlusIcon.vue';
import UploadIcon from './icons/UploadIcon.vue';
import AddContextIcon from './icons/AddContextIcon.vue';
import GlobeIcon from './icons/GlobeIcon.vue';

interface Props {
  canAttach?: boolean;
  canMention?: boolean;
  browserIntegrationSupported?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  canAttach: true,
  canMention: true,
  browserIntegrationSupported: false,
});
const emit = defineEmits<{
  (e: 'attachFile'): void;
  (e: 'insertAtMention', text: string): void;
}>();

const open = ref(false);
const buttonEl = ref<HTMLElement | null>(null);
const popupEl = ref<HTMLElement | null>(null);

interface Item { id: string; label: string; title: string; icon: Component; onSelect: () => void }

const items = computed<Item[]>(() => {
  const list: Item[] = [];
  if (props.canAttach) {
    list.push({ id: 'upload', label: 'Upload from computer', title: 'Attach files from your computer', icon: UploadIcon,
      onSelect: () => { emit('attachFile'); open.value = false; } });
  }
  if (props.canMention) {
    list.push({ id: 'files', label: 'Add context', title: 'Add files or folders to the conversation', icon: AddContextIcon,
      onSelect: () => { emit('insertAtMention', '@'); open.value = false; } });
    if (props.browserIntegrationSupported) {
      list.push({ id: 'browser', label: 'Browse the web', title: 'Add browser tabs to the conversation', icon: GlobeIcon,
        onSelect: () => { emit('insertAtMention', '@browser:'); open.value = false; } });
    }
  }
  return list;
});

function onMouseDown(event: MouseEvent): void {
  if (!open.value) return;
  const t = event.target as Node;
  if (popupEl.value?.contains(t) || buttonEl.value?.contains(t)) return;
  open.value = false;
}
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false;
}
onMounted(() => { document.addEventListener('mousedown', onMouseDown); document.addEventListener('keydown', onKeyDown); });
onUnmounted(() => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); });
</script>
