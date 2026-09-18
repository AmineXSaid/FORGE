<template>
  <!--
    The official tool-permission request (`EU0`, reference module qlaBag).

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
    @focus="handleContainerFocus"
  >
    <div class="fg-permission__permissionRequestContainerBackground"></div>

    <div class="fg-permission__foldButton">
      <button
        ref="foldButtonEl"
        type="button"
        class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
        :aria-label="folded ? 'Expand' : 'Collapse'"
        :title="folded ? 'Expand' : 'Collapse'"
        :aria-expanded="!folded"
        @click="toggleFold"
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
        ref="approveEl"
        class="fg-permission__button"
        :disabled="settling"
        @click="handleApprove"
      >
        <span v-if="!defaultToNo" class="fg-permission__shortcutNum">1</span>{{ ' ' }}{{ approveLabel }}
      </button>
      <button
        v-if="showSecondButton"
        ref="approveAlwaysEl"
        class="fg-permission__button"
        :disabled="settling"
        :aria-describedby="destinationChangeable ? hintId : undefined"
        @click="handleApproveAndDontAsk"
      >
        <span v-if="!defaultToNo" class="fg-permission__shortcutNum">2</span>{{ ' ' }}<template
          v-for="(part, index) in optionTwoParts"
          :key="index"
          ><template v-if="part.kind === 'text'">{{ part.text }}</template
          ><span
            v-else-if="part.kind === 'grant'"
            :title="grantTitle(part.grant)"
          >{{ oneLine(part.grant.label) }}</span
          ><span v-else-if="part.kind === 'count'" :title="part.title">{{ part.text }}</span
          ><span
            v-else
            class="fg-permission__destinationLink"
            :title="DESTINATION_TITLES[destination]"
            @click.stop="changeDestination(cycleDestination(destination, 1))"
          >{{ DESTINATION_LABELS[destination] }}</span
        ></template>
      </button>
      <button
        ref="rejectEl"
        class="fg-permission__button"
        :disabled="settling"
        @click="handleReject"
      >
        <span v-if="!defaultToNo" class="fg-permission__shortcutNum">{{ showSecondButton ? '3' : '2' }}</span>{{ ' ' }}{{ rejectLabel }}
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
    <span v-if="destinationChangeable" :id="hintId" class="fg-vh__visuallyHidden">{{ DESTINATION_KEYS_HINT }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import type { PermissionMode, PermissionUpdateDestination } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionRequest } from '../core/PermissionRequest';
import type { ToolContext } from '../types/tool';
import {
  DESTINATION_KEYS_HINT,
  DESTINATION_LABELS,
  DESTINATION_TITLES,
  cycleDestination,
  grantsRulesOrDirectories,
  initialDestination,
  oneLine,
  optionTwoLabel,
  optionTwoUpdates,
  rememberDestination,
  sessionModeChange,
  type Grant,
} from '../core/permissionPrompt';
import ContentEditableInput from './forge/ContentEditableInput.vue';
import ChevronUpIcon from './forge/icons/ChevronUpIcon.vue';
import ChevronDownIcon from './forge/icons/ChevronDownIcon.vue';

interface Props {
  request: PermissionRequest;
  context: ToolContext;
  onResolve: (request: PermissionRequest, allow: boolean) => void;
  /**
   * The official `onPermissionModeChange(mode, push)`: the session's
   * `setPermissionMode(mode, push, false)`. Option 2 mirrors a session-scoped
   * mode change it answers with, without pushing it (the answer carries it).
   */
  onPermissionModeChange?: (mode: PermissionMode, push: boolean) => Promise<unknown> | void;
  /**
   * The session's permission mode. The official dialog does not add buttons in
   * plan mode -- it relabels the two it already has -- so this only changes copy.
   */
  permissionMode?: string;
}

const props = defineProps<Props>();

/** `E` (`useId`): ties option 2 to its screen-reader hint. */
const hintId = `fg-permission-hint-${props.request.id}`;

const containerEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const foldButtonEl = ref<HTMLButtonElement | null>(null);
const approveEl = ref<HTMLButtonElement | null>(null);
const approveAlwaysEl = ref<HTMLButtonElement | null>(null);
const rejectEl = ref<HTMLButtonElement | null>(null);
const inputRef = ref<InstanceType<typeof ContentEditableInput> | null>(null);
const rejectMessage = ref('');
const modifiedInputs = ref<unknown | undefined>(undefined);
const folded = ref(false);

const hasInputs = computed(() => Object.keys(props.request.inputs).length > 0);

/** `z`: option 2 is offered when the CLI suggested something and did not forbid a lasting rule. */
const showSecondButton = computed(
  () => !props.request.suppressAlwaysAllowRule && props.request.suggestions.length > 0
);

/** `H`: `defaultToNo` -- no shortcut numbers, digits do nothing, focus starts on the reject button. */
const defaultToNo = computed(() => props.request.defaultToNo);

/** `V`: the reject button's index. */
const rejectIndex = computed(() => (showSecondButton.value ? 2 : 1));

/**
 * Which control the official container treats as focused. It drives
 * `[data-focused-index]`, which is what paints the active button in the accent
 * colour and rings the reject field -- so it is state, not decoration.
 */
const focusedIndex = ref(defaultToNo.value ? rejectIndex.value : 0);

/**
 * `P`: the buttons are disabled for the first 500 ms (and again after
 * unfolding), so a keystroke meant for the composer cannot answer the prompt.
 */
const settling = ref(true);

/** `O`: where option 2 saves -- remembered, else the suggestions' broadest, else "session". */
const destination = ref<PermissionUpdateDestination>(initialDestination(props.request.suggestions));

/** `T`: change it and remember it for the next prompt. */
function changeDestination(next: PermissionUpdateDestination): void {
  rememberDestination(next);
  destination.value = next;
}

/** `Y1`: option 2 grants a rule or a directory, so its destination can change. */
const destinationChangeable = computed(
  () => showSecondButton.value && grantsRulesOrDirectories(props.request.suggestions)
);

const optionTwoParts = computed(() => optionTwoLabel(props.request.suggestions));

/** `ky`: the full rule as a tooltip, only when the label shortened it. */
function grantTitle(grant: Grant): string | undefined {
  const label = oneLine(grant.label);
  const full = oneLine(grant.full);
  return full !== label ? full : undefined;
}

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

/**
 * `i1`: answer with the suggestions saved to the chosen destination. A
 * session-scoped mode change among them is mirrored in the webview first, not
 * pushed: the CLI applies it from the answer itself.
 */
const handleApproveAndDontAsk = async (): Promise<void> => {
  const updates = optionTwoUpdates(props.request.suggestions, destination.value);
  const mode = sessionModeChange(updates);
  if (mode !== undefined) await props.onPermissionModeChange?.(mode, false);
  props.request.accept((modifiedInputs.value as Record<string, unknown> | undefined) ?? props.request.inputs, updates);
};

const handleReject = (): void => {
  const trimmedMessage = rejectMessage.value.trim();
  const rejectionMessage = trimmedMessage
    ? `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection: ${trimmedMessage}`
    : "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

  props.request.reject(rejectionMessage, !trimmedMessage);
};

const rejectInputEl = (): HTMLElement | null => (inputRef.value?.el as HTMLElement | null | undefined) ?? null;

/** `z0`: the focus order the arrow keys walk and `data-focused-index` counts. */
const focusOrder = (): (HTMLElement | null)[] => {
  const order: (HTMLElement | null)[] = [approveEl.value];
  if (showSecondButton.value) order.push(approveAlwaysEl.value);
  order.push(rejectEl.value, rejectInputEl());
  return order;
};

/** `q0`: move focus through the controls, wrapping. */
function moveFocus(step: number): void {
  const order = focusOrder();
  const at = order.findIndex((el) => el === document.activeElement);
  const next = at === -1 ? 0 : (at + step + order.length) % order.length;
  const el = order[next];
  if (el) {
    focusedIndex.value = next;
    el.focus();
  }
}

/** `_R`: typing into a field. */
function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
  return el.isContentEditable === true;
}

/**
 * `wU0`: who owns a key. A held-down Enter, Escape or digit is swallowed; a
 * folded prompt only takes Escape; Enter on one of its own buttons is the
 * button's click.
 */
function keyOwner(e: KeyboardEvent, onOwnButton: boolean): 'claim' | 'leave' | 'answer' {
  if (e.repeat && !isTextField(e.target) && (e.key === 'Enter' || e.key === 'Escape' || /^[0-9]$/.test(e.key))) return 'claim';
  if (folded.value) return e.key === 'Escape' && !e.metaKey && !e.ctrlKey ? 'claim' : 'leave';
  if (onOwnButton && e.key === 'Enter') return 'leave';
  return 'answer';
}

/** The reject field's own keys (`V0`): Enter sends, Shift+Enter is a newline, Escape rejects. */
const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Enter' && !e.shiftKey) {
    if (e.isComposing) return;
    e.preventDefault();
    handleReject();
  } else if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    handleReject();
  }
};

/** `l0`: the container's keys. */
const handleContainerKeyDown = (e: KeyboardEvent): void => {
  const target = e.target as HTMLElement | null;
  const onOwnButton =
    target === foldButtonEl.value ||
    (target instanceof HTMLButtonElement && (contentEl.value?.contains(target) ?? false));
  const owner = keyOwner(e, onOwnButton);
  if (owner === 'claim') {
    e.preventDefault();
    return;
  }
  if (owner === 'leave') return;
  if (target && contentEl.value?.contains(target)) return;

  const inRejectField = document.activeElement === rejectInputEl();
  const actions: (() => void)[] = [handleApprove];
  if (showSecondButton.value) actions.push(() => void handleApproveAndDontAsk());
  actions.push(handleReject, () => {
    const el = rejectInputEl();
    if (el) {
      focusedIndex.value = focusOrder().length - 1;
      el.focus();
    }
  });
  const byDigit: Record<string, () => void> = {};
  actions.forEach((action, i) => (byDigit[String(i + 1)] = action));

  if (!inRejectField && !settling.value && !defaultToNo.value && byDigit[e.key]) {
    e.preventDefault();
    byDigit[e.key]();
  } else if (e.key === 'Enter' && !settling.value && !inRejectField && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    if (focusedIndex.value === 0) handleApprove();
    else if (focusedIndex.value === 1 && showSecondButton.value) void handleApproveAndDontAsk();
    else if (focusedIndex.value === rejectIndex.value) handleReject();
  } else if (e.key === 'Escape' && !settling.value && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    handleReject();
  } else if (
    (e.key === 'ArrowRight' || e.key === 'ArrowLeft') &&
    !e.metaKey && !e.ctrlKey && !e.altKey &&
    destinationChangeable.value &&
    document.activeElement === approveAlwaysEl.value
  ) {
    e.preventDefault();
    // The official also announces the new destination to screen readers (`lP`);
    // Forge has no live-region announcer yet.
    if (!e.repeat) changeDestination(cycleDestination(destination.value, e.key === 'ArrowRight' ? 1 : -1));
  } else if (e.key === 'ArrowDown') {
    if (inRejectField && rejectMessage.value.includes('\n')) return;
    e.preventDefault();
    moveFocus(1);
  } else if (e.key === 'ArrowUp') {
    if (inRejectField && rejectMessage.value.includes('\n')) return;
    e.preventDefault();
    moveFocus(-1);
  }
};

/** `b0`: focus landing on the container itself goes on to the control it marks. */
const handleContainerFocus = (e: FocusEvent): void => {
  if (e.target !== e.currentTarget) return;
  if (folded.value) {
    containerEl.value?.blur();
    foldButtonEl.value?.focus();
    return;
  }
  const el = focusOrder()[focusedIndex.value];
  if (el) {
    containerEl.value?.blur();
    el.focus();
  }
};

/** The official `focusin` listener: `data-focused-index` follows focus. */
const trackFocus = (): void => {
  const at = focusOrder().findIndex((el) => el === document.activeElement);
  if (at !== -1) focusedIndex.value = at;
};

/** `G1`: set when unfolding, so the settle timer does not steal focus. */
let skipSettleFocus = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** The settle timer: enable the buttons, then focus the default one. */
function startSettling(): void {
  clearTimeout(settleTimer);
  if (folded.value) return;
  settleTimer = setTimeout(() => {
    settling.value = false;
    if (skipSettleFocus) {
      skipSettleFocus = false;
      return;
    }
    if (isTextField(document.activeElement)) return;
    const target = defaultToNo.value ? rejectEl.value : approveEl.value;
    if (target && document.hasFocus()) {
      focusedIndex.value = defaultToNo.value ? rejectIndex.value : 0;
      target.focus();
    } else if (containerEl.value && (props.request.toolName === 'Edit' || props.request.toolName === 'Write')) {
      containerEl.value.focus();
    }
  }, 500);
}

/** `Y0.onToggle`: unfolding re-arms the guard; folding puts focus on the fold button. */
function toggleFold(): void {
  const next = !folded.value;
  if (!next) {
    settling.value = true;
    skipSettleFocus = true;
  }
  folded.value = next;
  if (next) setTimeout(() => foldButtonEl.value?.focus(), 0);
}

watch(folded, startSettling);

onMounted(() => {
  containerEl.value?.addEventListener('focusin', trackFocus);
  startSettling();
});

onBeforeUnmount(() => {
  clearTimeout(settleTimer);
  containerEl.value?.removeEventListener('focusin', trackFocus);
});
</script>
