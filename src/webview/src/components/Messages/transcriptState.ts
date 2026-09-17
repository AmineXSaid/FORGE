import { ref, type InjectionKey, type Ref } from 'vue';

/**
 * Whether thinking blocks are expanded. The official keeps one flag for the whole
 * transcript (`areThinkingBlocksExpanded`), so opening one thinking block opens
 * them all; the chat page provides it and every thinking block shares it.
 */
export const ThinkingExpandedKey: InjectionKey<Ref<boolean>> = Symbol('thinkingExpanded');

export function createThinkingExpanded(): Ref<boolean> {
  return ref(false);
}

/** Whether the session is working, for rows that show a live state (a running shell command). */
export const TranscriptBusyKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('transcriptBusy');
