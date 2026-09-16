<template>
  <!--
    The official tool-permission request (reference module qlaBag).

    Structure is copied from the reference bundle element for element, because
    the ported stylesheet depends on it: `foldsToTitle` reaches for
    `> .permissionRequestHeader` and `> :first-child > :first-child`, the folded
    state hides `> .buttonContainer` and `> .keyboardHints` as direct children,
    and the primary-button highlight is driven by `[data-focused-index]` plus
    `:first-child` / `:nth-child()`. Wrap any of these in an extra div and the
    rules quietly stop matching.

    There is no <style> block here on purpose. Every rule this component needs
    lives in styles/official/permission.css; a scoped override would be the
    fastest way to reintroduce the spacing drift the port exists to remove.
  -->
  <div
    ref="containerEl"
    class="fg-permission__permissionRequestContainer"
    :class="{ 'fg-permission__folded': folded }"
    tabindex="0"
    :data-focused-index="focusedIndex"
    data-permission-panel="1"
    @keydown="handleContainerKeyDown"
    @focusin="handleFocusIn"
  >
    <div class="fg-permission__permissionRequestContainerBackground"></div>

    <div class="fg-permission__foldButton">
      <button
        type="button"
        class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
        :aria-label="folded ? 'Expand' : 'Collapse'"
        :title="folded ? 'Expand' : 'Collapse'"
        :aria-expanded="!folded"
        @click="folded = !folded"
      >
        <ChevronUpIcon v-if="folded" />
        <ChevronDownIcon v-else />
      </button>
    </div>

    <div ref="contentEl" class="fg-permission__permissionRequestContent fg-permission__foldsToTitle">
      <div class="fg-permission__permissionRequestHeader">
        Do you want to proceed with <strong>{{ request.toolName }}</strong
        >?
      </div>

      <div class="fg-permission__permissionRequestDescription">
        <details v-if="hasInputs">
          <summary>
            <span>Details</span>
            <svg
              class="fg-permission__chevron"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </summary>
          <pre class="fg-permission__inputJson">{{ displayInputs }}</pre>
        </details>
      </div>
    </div>

    <div class="fg-permission__buttonContainer">
      <button
        class="fg-permission__button"
        @click="handleApprove"
        @focus="focusedIndex = 0"
      >
        <span class="fg-permission__shortcutNum">1</span> {{ approveLabel }}
      </button>
      <button
        v-if="showSecondButton"
        class="fg-permission__button"
        @click="handleApproveAndDontAsk"
        @focus="focusedIndex = 1"
      >
        <span class="fg-permission__shortcutNum">2</span> Yes, and don&apos;t ask again
      </button>
      <button
        class="fg-permission__button"
        @click="handleReject"
        @focus="focusedIndex = showSecondButton ? 2 : 1"
      >
        <span class="fg-permission__shortcutNum">{{ showSecondButton ? '3' : '2' }}</span>
        {{ rejectLabel }}
      </button>
      <ContentEditableInput
        ref="inputRef"
        v-model="rejectMessage"
        wrapper-class="fg-permission__rejectMessageInput"
        placeholder="Tell Forge what to do instead"
        @keydown="handleKeyDown"
      />
    </div>

    <div class="fg-permission__keyboardHints">Esc to cancel</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { PermissionRequest } from '../core/PermissionRequest';
import type { ToolContext } from '../types/tool';
import ContentEditableInput from './forge/ContentEditableInput.vue';
import ChevronUpIcon from './forge/icons/ChevronUpIcon.vue';
import ChevronDownIcon from './forge/icons/ChevronDownIcon.vue';

interface Props {
  request: PermissionRequest;
  context: ToolContext;
  onResolve: (request: PermissionRequest, allow: boolean) => void;
  /**
   * The session's permission mode. The official dialog does not add buttons in
   * plan mode -- it relabels the two it already has -- so this only changes copy.
   */
  permissionMode?: string;
}

const props = defineProps<Props>();

const containerEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const inputRef = ref<InstanceType<typeof ContentEditableInput> | null>(null);
const rejectMessage = ref('');
const modifiedInputs = ref<unknown | undefined>(undefined);
const folded = ref(false);

/**
 * Which control the official container treats as focused. It drives
 * `[data-focused-index]`, which is what paints the active button in the accent
 * colour and rings the reject field -- so it is state, not decoration.
 */
const focusedIndex = ref(0);

const hasInputs = computed(() => Object.keys(props.request.inputs).length > 0);
const showSecondButton = computed(
  () => !!props.request.suggestions && props.request.suggestions.length > 0
);

/** The official relabels both actions in plan mode rather than adding buttons. */
const isPlanMode = computed(() => props.permissionMode === 'plan');
const approveLabel = computed(() => (isPlanMode.value ? 'Yes, and auto-accept' : 'Yes'));
const rejectLabel = computed(() => (isPlanMode.value ? 'No, keep planning' : 'No'));

const displayInputs = computed(() => {
  try {
    return JSON.stringify(modifiedInputs.value ?? props.request.inputs, null, 2);
  } catch {
    return '{}';
  }
});

const handleApprove = (): void => {
  if (modifiedInputs.value) {
    (props.request as unknown as { inputs: unknown }).inputs = modifiedInputs.value;
  }
  props.onResolve(props.request, true);
};

const handleApproveAndDontAsk = (): void => {
  props.request.accept(props.request.inputs, props.request.suggestions || []);
};

const handleReject = (): void => {
  const trimmedMessage = rejectMessage.value.trim();
  const rejectionMessage = trimmedMessage
    ? `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection: ${trimmedMessage}`
    : "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

  props.request.reject(rejectionMessage, !trimmedMessage);
};

/** Focus moving into the reject field is index 3 in the official markup. */
const handleFocusIn = (event: FocusEvent): void => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('.fg-permission__rejectMessageInput')) focusedIndex.value = 3;
};

const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleReject();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    handleReject();
  }
};

const handleContainerKeyDown = (e: KeyboardEvent): void => {
  // Digits typed into the reject field are text, not shortcuts.
  const active = document.activeElement as HTMLElement | null;
  if (active?.closest('.fg-permission__rejectMessageInput')) return;

  if (e.key === '1') {
    e.preventDefault();
    handleApprove();
  } else if (e.key === '2') {
    e.preventDefault();
    if (showSecondButton.value) {
      handleApproveAndDontAsk();
    } else {
      handleReject();
    }
  } else if (e.key === '3' && showSecondButton.value) {
    e.preventDefault();
    handleReject();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    handleReject();
  }
};
</script>
