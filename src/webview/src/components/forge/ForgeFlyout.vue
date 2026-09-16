<template>
  <!--
    The Claude Code footer flyout: a trigger button with a popup anchored above
    it. Matches the official structure -- container / footerButton / menuPopup --
    so the ported official styles apply without any bridging CSS.
  -->
  <div class="fg-menu__container" ref="containerEl">
    <button
      ref="triggerEl"
      type="button"
      :class="[triggerClass, { 'fg-footer__footerButtonPrimary': open && triggerClass === 'fg-footer__footerButton' }]"
      :title="triggerTitle"
      :role="triggerRole"
      :aria-expanded="open"
      :aria-haspopup="triggerHaspopup"
      @click="toggle"
    >
      <slot name="trigger" />
    </button>

    <div
      v-if="open"
      ref="popupEl"
      class="fg-menu__menuPopup fg-menu__menuPopupV2"
      :class="{ 'fg-menu__menuPopupRight': alignRight }"
      role="menu"
    >
      <div v-if="title" class="fg-menu__menuHeader">
        <span class="fg-menu__menuHeaderTitle">{{ title }}</span>
        <span v-if="$slots.hint" class="fg-menu__menuHeaderHint"><slot name="hint" /></span>
      </div>
      <slot :close="close" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount, watch, nextTick } from 'vue';

interface Props {
  /** Header title, e.g. "Modes". Omit for a headerless menu. */
  title?: string;
  /** Anchor the popup to the trigger's right edge. */
  alignRight?: boolean;
  triggerTitle?: string;
  /**
   * Class on the trigger button. Most footer menus are a `footerButton`, but the
   * model pill *is* its own button in the official markup -- `modelPill` is set
   * on the `<button>`, not on a span inside one. Nesting it produced a visibly
   * wrong pill: `.fg-footer__footerButton span { display:inline-block }` and
   * `.fg-footer__inputFooterV2 .fg-footer__footerButton span { line-height:26px }`
   * both out-specify `.fg-footer__modelPill`, and the pill's own `font-size:.85em`
   * compounded with the button's, rendering it at 9.39px instead of 11.05px.
   */
  triggerClass?: string;
  /** ARIA role for the trigger; the official model pill is a `combobox`. */
  triggerRole?: string;
  /** What the trigger pops up -- `menu` for the footer menus, `listbox` for the pill. */
  triggerHaspopup?: string;
}

withDefaults(defineProps<Props>(), {
  alignRight: false,
  triggerClass: 'fg-footer__footerButton',
  triggerHaspopup: 'menu',
});

const open = ref(false);
const containerEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const popupEl = ref<HTMLElement | null>(null);

function toggle(): void {
  open.value = !open.value;
}

function close(): void {
  if (!open.value) return;
  open.value = false;
  // Return focus to the trigger so keyboard users are not dropped at the top
  // of the document after the popup unmounts.
  void nextTick(() => triggerEl.value?.focus());
}

function onPointerDown(event: MouseEvent): void {
  const target = event.target as Node;
  if (popupEl.value?.contains(target) || triggerEl.value?.contains(target)) return;
  open.value = false;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

// Listeners are attached only while the menu is open, so a closed menu costs
// nothing and several menus on the page cannot fight over the same events.
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
  } else {
    document.removeEventListener('mousedown', onPointerDown);
    document.removeEventListener('keydown', onKeyDown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onPointerDown);
  document.removeEventListener('keydown', onKeyDown);
});

defineExpose({ close });
</script>
