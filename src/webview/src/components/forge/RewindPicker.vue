<template>
  <!--
    The official "Rewind to…" picker (`yH0`, reference module cO8y_Q), element
    for element:

      selected
        ? mo {session, userMessageId, willForkAfter: true, onClose, onConfirm}
        : i7 {title:"Rewind to…", showCloseButton:true, closeOnClickOutside:true, maxWidth:520}
            targets.length === 0
              ? p.empty "No messages to rewind to yet."
              : p.hint
                ul.list  (tabIndex 0, role listbox)
                  li.item[.focused] (role option, aria-selected)
                    div.itemText  the prompt
                    div.itemTime  I85(timestamp)
                p.keys  kbd ↑ kbd ↓ … kbd Enter … kbd Esc

    Selecting a row always opens the dialog with `willForkAfter: true`, because
    the official's Rewind row rewinds **and** forks -- `K(j)` runs the rewind and
    then `D(j)`.
  -->
  <RewindDialog
    v-if="selected"
    :session="session"
    :user-message-id="selected.uuid"
    :will-fork-after="true"
    :on-close="() => (selected = null)"
    :on-confirm="() => void confirmSelected()"
  />
  <ForgeDialog
    v-else
    title="Rewind to&#8230;"
    :on-close="onClose"
    :show-close-button="true"
    :close-on-click-outside="true"
    :max-width="520"
  >
    <p v-if="targets.length === 0" class="fg-rewind__empty">No messages to rewind to yet.</p>
    <template v-else>
      <p class="fg-rewind__hint">Select a message to restore code and fork the conversation from that point.</p>
      <ul ref="listEl" class="fg-rewind__list" tabindex="0" role="listbox" @keydown="onListKeyDown">
        <li
          v-for="(target, index) in targets"
          :key="target.uuid"
          :class="['fg-rewind__item', index === focused ? 'fg-rewind__focused' : '']"
          role="option"
          :aria-selected="index === focused"
          @click="selected = target"
          @mousemove="focused = index"
        >
          <div class="fg-rewind__itemText">{{ target.promptText }}</div>
          <div class="fg-rewind__itemTime">{{ relativeTime(target.timestamp) }}</div>
        </li>
      </ul>
      <p class="fg-rewind__keys">
        <kbd>&#8593;</kbd><kbd>&#8595;</kbd> to navigate &#183; <kbd>Enter</kbd> to select &#183;
        <kbd>Esc</kbd> to close
      </p>
    </template>
  </ForgeDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Session } from '../../core/Session';
import ForgeDialog from './ForgeDialog.vue';
import RewindDialog from './RewindDialog.vue';
import { relativeTime, rewindResultMessage, rewindTargets, type RewindTarget } from '../../core/rewind';

interface Props {
  session: Session;
  onClose: () => void;
  /**
   * `Y` / `onCreateNewSession`: the first message has nothing before it, so
   * there is no point to fork from -- the official starts a new conversation
   * seeded with that prompt instead.
   */
  onCreateNewSession: (promptText: string) => void;
  /** `X` / `onRewindError`: a rewind that could not run. */
  onRewindError: (message: string) => void;
  /**
   * `D(j)`'s fork leg. Supplied by the mount site so this component stays the
   * picker and nothing else; `fork_conversation` itself is step 25.
   */
  onFork: (target: RewindTarget) => void;
}

const props = defineProps<Props>();

const focused = ref(0);
const selected = ref<RewindTarget | null>(null);
const listEl = ref<HTMLElement | null>(null);

/** `b5(()=>{…},[Q])`: the user prompts, newest first. */
const targets = computed(() =>
  rewindTargets(
    props.session.messages().map((m) => ({
      type: m.type,
      uuid: m.uuid,
      // `M.parentToolUseId`: a subagent's prompt is not a point to rewind to.
      parentToolUseId: m.parentToolUseId ?? undefined,
      timestamp: m.timestamp,
      text: typeof m.message.content === 'string'
        ? m.message.content
        : m.message.content
            .map((w) => (w.content.type === 'text' ? w.content.text : ''))
            .join(''),
    }))
  )
);

/** `e(()=>{if(V)return;let j=setTimeout((P)=>P.current?.focus(),0,W)},[V])`. */
watch(
  selected,
  (value) => {
    if (value) return;
    void nextTick(() => listEl.value?.focus());
  },
  { immediate: true }
);

/** `e(()=>{W.current?.querySelector(`.${dq.focused}`)?.scrollIntoView({block:"nearest"})},[q])`. */
watch(focused, () => {
  void nextTick(() => {
    listEl.value?.querySelector('.fg-rewind__focused')?.scrollIntoView({ block: 'nearest' });
  });
});

function onListKeyDown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focused.value = Math.min(focused.value + 1, targets.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focused.value = Math.max(focused.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = targets.value[focused.value];
    if (target) selected.value = target;
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    props.onClose();
  }
}

/**
 * `K(j)`: close the picker, rewind for real, note the result in the transcript,
 * warn when links were skipped, then hand over to the fork leg.
 *
 *   async function K(j){Z();let P=j.message.uuid;
 *     if(!P){X("Failed to rewind: no checkpoint for this message");return}
 *     let M;try{M=await $.rewindCode(P)}catch(w){X(`Failed to rewind code: …`);return}
 *     if(!M.canRewind){X("Failed to rewind code");return}
 *     if($.insertMetaMessage(TR(M.skippedLinks)),M.skippedLinks)
 *       $.showNotification(TR(M.skippedLinks),"warning");
 *     D(j)}
 */
async function confirmSelected(): Promise<void> {
  const target = selected.value;
  if (!target) return;
  props.onClose();
  if (!target.uuid) {
    props.onRewindError('Failed to rewind: no checkpoint for this message');
    return;
  }
  let result;
  try {
    result = await props.session.rewindCode(target.uuid);
  } catch (e: unknown) {
    props.onRewindError(`Failed to rewind code: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!result.canRewind) {
    props.onRewindError('Failed to rewind code');
    return;
  }
  props.session.insertMetaMessage(rewindResultMessage(result.skippedLinks));
  if (result.skippedLinks) props.session.showNotification(rewindResultMessage(result.skippedLinks), 'warning');
  fork(target);
}

/**
 * `D(j)`:
 *
 *   function D(j){if(!j.resumeAtMessageId){Y(j.promptText);return}
 *     if(!G){$.showNotification("Failed to fork conversation: Unknown session id","error");return}
 *     J.forkConversation(G,j.promptText,j.resumeAtMessageId).catch(…)}
 */
function fork(target: RewindTarget): void {
  if (!target.resumeAtMessageId) {
    props.onCreateNewSession(target.promptText);
    return;
  }
  if (!props.session.sessionId()) {
    props.session.showNotification('Failed to fork conversation: Unknown session id', 'error');
    return;
  }
  props.onFork(target);
}
</script>
