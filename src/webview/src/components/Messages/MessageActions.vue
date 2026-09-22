<template>
  <!--
    The official "Message actions" control on a user message (`HU0`, reference
    module v2CdxQ), element for element:

      div.container
        button.actionButton[.visible][.subtleVisible]   title "Message actions"
          svg 24x24, strokeWidth 3, style transform scale(0.9)
            path  the rewind arrow
        open && div.popup[.popupVisible][.popupAbove]   style transform translateX(H)
          button.popupOption  > span.optionText  "Fork conversation from here"
          hasUuid &&
            button.popupOption > span.optionText  "Rewind code to here"
            button.popupOption > span.optionText  "Fork conversation and rewind code"

    Two notes on fidelity:

    - the official's container className is
      `${VZ.container} ${U?VZ.messageHovered:""}`, but `VZ` has no
      `messageHovered` key and `index.css` has no such rule -- checked both:
      one occurrence in index.js, zero in index.css, zero in the module map. The
      official therefore renders the literal class `undefined` while the message
      is hovered. It is inert, and Forge omits it.
    - the last two options are gated on `y = Z.uuid`, i.e. on the message
      carrying a uuid. Not a capability check: a message with no uuid has no
      checkpoint to rewind to and no point to fork at.
  -->
  <div class="fg-messageactions__container">
    <button
      ref="buttonEl"
      :class="['fg-messageactions__actionButton', open ? 'fg-messageactions__visible' : '', messageHovered ? 'fg-messageactions__subtleVisible' : '']"
      title="Message actions"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg
        style="transform: scale(0.9)"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="3"
        stroke="currentColor"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
      </svg>
    </button>
    <div
      v-if="open"
      ref="popupEl"
      :class="['fg-messageactions__popup', popupVisible ? 'fg-messageactions__popupVisible' : '', popupAbove ? 'fg-messageactions__popupAbove' : '']"
      :style="offsetX !== 0 ? { transform: `translateX(${offsetX}px)` } : undefined"
    >
      <button class="fg-messageactions__popupOption" @click="onForkOnly">
        <span class="fg-messageactions__optionText">Fork conversation from here</span>
      </button>
      <template v-if="uuid">
        <button class="fg-messageactions__popupOption" @click="onRewindOnly">
          <span class="fg-messageactions__optionText">Rewind code to here</span>
        </button>
        <button class="fg-messageactions__popupOption" @click="onForkAndRewind">
          <span class="fg-messageactions__optionText">Fork conversation and rewind code</span>
        </button>
      </template>
    </div>
  </div>
  <RewindDialog
    v-if="uuid && dialogOpen"
    :session="session"
    :user-message-id="uuid"
    :will-fork-after="willFork"
    :on-close="closeDialog"
    :on-confirm="() => void confirmDialog()"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { Message } from '../../models/Message';
import type { Session } from '../../core/Session';
import RewindDialog from '../forge/RewindDialog.vue';
import { rewindResultMessage } from '../../core/rewind';

interface Props {
  session: Session;
  message: Message;
  /** The outer message row, whose hover reveals the button (the official `containerRef`). */
  containerRef?: HTMLElement | null;
  /** `promptText`: this message's text, carried into the forked conversation's composer. */
  promptText: string;
  /** `onCreateNewSession`: the first message has nothing before it to fork from. */
  onCreateNewSession: (promptText: string) => void;
  /** `onRewindError`: a rewind that could not run. */
  onRewindError: (message: string) => void;
  /** `context.forkConversation(sessionId, promptText, resumeSessionAt)`. */
  forkConversation: (sessionId: string, promptText: string, resumeSessionAt?: string) => Promise<void>;
}

const props = defineProps<Props>();

const open = ref(false);
const messageHovered = ref(false);
const offsetX = ref(0);
const popupAbove = ref(false);
const popupVisible = ref(false);
const dialogOpen = ref(false);
const willFork = ref(false);
const buttonEl = ref<HTMLElement | null>(null);
const popupEl = ref<HTMLElement | null>(null);

/** `let y=Z.uuid`: the last two options exist only for a message that has one. */
const uuid = computed(() => props.message.uuid);

/**
 * `I`: the uuid of the nearest earlier user-or-assistant message — where the
 * fork resumes from.
 *
 *   let E=J.messages.value,I=void 0;
 *   for(let $1=E.indexOf(Z)-1;$1>=0;$1--){let C=E[$1];
 *     if(C?.uuid&&(C.type==="assistant"||C.type==="user")){I=C.uuid;break}}
 */
const resumeSessionAt = computed(() => {
  const messages = props.session.messages();
  for (let i = messages.indexOf(props.message) - 1; i >= 0; i--) {
    const earlier = messages[i];
    if (earlier?.uuid && (earlier.type === 'assistant' || earlier.type === 'user')) return earlier.uuid;
  }
  return undefined;
});

/** `let f=!I`: nothing before it, so a fork would be a brand new conversation. */
const isFirstMessage = computed(() => resumeSessionAt.value === undefined);

/** The official's hover listeners on the message row. */
watch(
  () => props.containerRef,
  (el, _old, onCleanup) => {
    if (!el) return;
    const enter = () => (messageHovered.value = true);
    const leave = () => (messageHovered.value = false);
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    onCleanup(() => {
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
    });
  },
  { immediate: true }
);

/** `if(_.current&&!_.current.contains(C.target)&&O.current&&!O.current.contains(C.target))…q(!1)`. */
function onDocumentMouseDown(e: MouseEvent): void {
  const target = e.target as Node | null;
  if (!target) return;
  if (popupEl.value?.contains(target)) return;
  if (buttonEl.value?.contains(target)) return;
  open.value = false;
}

/**
 * `e(()=>{if(z&&_.current&&O.current){let $1=_.current.getBoundingClientRect(),
 *          C=O.current.getBoundingClientRect();
 *          W($1.left<0?-$1.left+8:0), K(C.bottom>window.innerHeight-260), j(!0)}
 *        else if(!z)W(0),K(!1),j(!1)},[z])`
 */
watch(open, (isOpen) => {
  if (!isOpen) {
    document.removeEventListener('mousedown', onDocumentMouseDown);
    offsetX.value = 0;
    popupAbove.value = false;
    popupVisible.value = false;
    return;
  }
  document.addEventListener('mousedown', onDocumentMouseDown);
  void nextTick(() => {
    const popup = popupEl.value?.getBoundingClientRect();
    const button = buttonEl.value?.getBoundingClientRect();
    if (!popup || !button) return;
    offsetX.value = popup.left < 0 ? -popup.left + 8 : 0;
    popupAbove.value = button.bottom > window.innerHeight - 260;
    popupVisible.value = true;
  });
});

onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentMouseDown));

/** `function m(){q(!1),s()}` */
function onForkOnly(): void {
  open.value = false;
  fork();
}

/** `function S(){q(!1),N(!1),M(!0)}` */
function onRewindOnly(): void {
  open.value = false;
  willFork.value = false;
  dialogOpen.value = true;
}

/** `function B1(){q(!1),N(!0),M(!0)}` */
function onForkAndRewind(): void {
  open.value = false;
  willFork.value = true;
  dialogOpen.value = true;
}

/** `function Y1(){M(!1),N(!1)}` */
function closeDialog(): void {
  dialogOpen.value = false;
  willFork.value = false;
}

/**
 * `async function G1(){if(M(!1),await i()&&w)s();N(!1)}`
 *
 * Close the dialog, rewind, and fork **only if the rewind succeeded** and a
 * fork was asked for. Order matters: a failed rewind must not fork.
 */
async function confirmDialog(): Promise<void> {
  dialogOpen.value = false;
  const ok = await rewind();
  if (ok && willFork.value) fork();
  willFork.value = false;
}

/**
 * `async function i(){…}` — the real rewind.
 *
 *   if(!Z.uuid)return G?.("Failed to rewind code: No file checkpoint found"),!1;
 *   let $1;try{$1=await J.rewindCode(Z.uuid)}catch(C){return G?.(`Failed to rewind code: …`),!1}
 *   if(!$1.canRewind)return G?.("Failed to rewind code"),!1;
 *   if(J.insertMetaMessage(TR($1.skippedLinks)),$1.skippedLinks&&w)
 *     J.showNotification(TR($1.skippedLinks),"warning");
 *   return!0
 *
 * The notification is gated on `w` (a fork will follow) in the official, where
 * the picker's own copy is not -- kept as the official has it.
 */
async function rewind(): Promise<boolean> {
  const id = props.message.uuid;
  if (!id) {
    props.onRewindError('Failed to rewind code: No file checkpoint found');
    return false;
  }
  let result;
  try {
    result = await props.session.rewindCode(id);
  } catch (e: unknown) {
    props.onRewindError(`Failed to rewind code: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  if (!result.canRewind) {
    props.onRewindError('Failed to rewind code');
    return false;
  }
  props.session.insertMetaMessage(rewindResultMessage(result.skippedLinks));
  if (result.skippedLinks && willFork.value) {
    props.session.showNotification(rewindResultMessage(result.skippedLinks), 'warning');
  }
  return true;
}

/**
 * `function s(){if(f){Q(X);return}
 *    if(!T){J.showNotification("Failed to fork conversation: Unknown session id","error");return}
 *    $.forkConversation(T,X,I).catch(($1)=>{J.showNotification(`Failed to fork conversation: …`,"error")})}`
 */
function fork(): void {
  if (isFirstMessage.value) {
    props.onCreateNewSession(props.promptText);
    return;
  }
  const sessionId = props.session.sessionId();
  if (!sessionId) {
    props.session.showNotification('Failed to fork conversation: Unknown session id', 'error');
    return;
  }
  props.forkConversation(sessionId, props.promptText, resumeSessionAt.value).catch((e: unknown) => {
    props.session.showNotification(
      `Failed to fork conversation: ${e instanceof Error ? e.message : String(e)}`,
      'error'
    );
  });
}
</script>
