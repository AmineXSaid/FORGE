<template>
  <!--
    The official modal dialog (`i7`, reference module f3sAzg), element for
    element: overlay > dialog > header (back, h3 title, close) + content +
    optional actions. Styles come from styles/official/dialog.css only.
  -->
  <div class="fg-dialog__overlay" @click="handleOverlayClick" @mousedown="handleOverlayMouseDown">
    <div
      ref="dialogEl"
      :class="dialogClass"
      :style="{ maxWidth: `${maxWidth}px`, width: width === undefined ? undefined : `min(${width}px, 100vw - 32px)` }"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @click.stop
      @keydown="handleKeyDown"
    >
      <div class="fg-dialog__header">
        <button
          v-if="onBack"
          type="button"
          class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
          aria-label="Back"
          title="Back"
          @click="onBack"
        >
          <slot name="back-icon" />
        </button>
        <h3 :id="titleId" class="fg-dialog__title">{{ title }}</h3>
        <button
          v-if="showCloseButton"
          type="button"
          class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
          aria-label="Close"
          title="Close"
          @click="onClose"
        >
          <CloseIcon />
        </button>
      </div>
      <div class="fg-dialog__content"><slot /></div>
      <div v-if="buttons && buttons.length > 0" class="fg-dialog__actions">
        <button
          v-for="(button, index) in buttons"
          :key="index"
          type="button"
          :disabled="button.disabled"
          :class="button.primary ? 'fg-dialog__primaryButton' : 'fg-dialog__secondaryButton'"
          @click="button.onClick"
        >
          <span v-if="button.shortcut" class="fg-dialog__shortcut">{{ button.shortcut }}</span>{{ button.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CloseIcon from './icons/CloseIcon.vue';

export interface DialogButton {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

interface Props {
  title: string;
  onClose: () => void;
  buttons?: DialogButton[];
  showCloseButton?: boolean;
  closeOnClickOutside?: boolean;
  maxWidth?: number;
  width?: number;
  onBack?: () => void;
  scrollInside?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showCloseButton: true,
  closeOnClickOutside: true,
  maxWidth: 500,
  scrollInside: false,
});

/** `useId`: ties the dialog to its title. */
const titleId = `fg-dialog-title-${Math.random().toString(36).slice(2)}`;

const dialogEl = ref<HTMLElement | null>(null);

const dialogClass = computed(() =>
  ['fg-dialog__dialog', props.scrollInside ? 'fg-dialog__scrollInside' : '', props.width === undefined ? '' : 'fg-dialog__sized']
    .filter(Boolean)
    .join(' ')
);

/** [`y55`] What Tab cycles through inside the dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus the primary action, else the first action, else the dialog itself. */
onMounted(() => {
  const primary = dialogEl.value?.querySelector<HTMLElement>('.fg-dialog__primaryButton:not([disabled])');
  if (primary) {
    primary.focus();
    return;
  }
  const action = dialogEl.value?.querySelector<HTMLElement>('.fg-dialog__actions button:not([disabled])');
  if (action) {
    action.focus();
    return;
  }
  dialogEl.value?.focus();
});

/** Escape closes, Tab stays inside, and an action's shortcut key presses it. */
function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    props.onClose();
    return;
  }
  if (e.key === 'Tab') {
    const focusable = Array.from(dialogEl.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === dialogEl.value) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || active === dialogEl.value) {
      e.preventDefault();
      first.focus();
    }
    return;
  }
  const button = props.buttons?.find((b) => b.shortcut === e.key && !b.disabled);
  if (button) {
    e.preventDefault();
    button.onClick();
  }
}

function handleOverlayClick(): void {
  if (props.closeOnClickOutside) props.onClose();
}

function handleOverlayMouseDown(e: MouseEvent): void {
  if (e.target === e.currentTarget) e.preventDefault();
}
</script>
