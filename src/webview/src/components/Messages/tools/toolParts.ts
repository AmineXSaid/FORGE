/**
 * Building blocks shared by the tool renderers, ported from the official
 * Claude Code webview. Each export names the bundle function it copies, so a
 * difference can be checked against the source rather than argued about.
 */
import { h, ref, defineComponent, type PropType, type VNodeChild } from 'vue';
import type { ToolResultBlock } from '../../../models/ContentBlock';

/** Module ZUQaOA (`j0`): the tool call row. */
export const TOOL = {
  root: 'fg-tool__root',
  toolSummary: 'fg-tool__toolSummary',
  toolNameText: 'fg-tool__toolNameText',
  toolNameTextSecondary: 'fg-tool__toolNameTextSecondary',
  toolNameTextSecondaryPlaintext: 'fg-tool__toolNameTextSecondaryPlaintext',
  toolBody: 'fg-tool__toolBody',
  toolBodyPlainText: 'fg-tool__toolBodyPlainText',
  toolBodyGrid: 'fg-tool__toolBodyGrid',
  toolBodyRow: 'fg-tool__toolBodyRow',
  toolBodyRowLabel: 'fg-tool__toolBodyRowLabel',
  toolBodyRowContent: 'fg-tool__toolBodyRowContent',
  toolBodyRowContent_disableClipping: 'fg-tool__toolBodyRowContent_disableClipping',
} as const;

type Action = () => void;

/** `if1`: keyboard-operable click target. */
function clickable(onClick: Action) {
  return {
    tabindex: 0,
    onClick,
    onKeydown: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) onClick();
      }
    },
    style: { cursor: 'pointer' },
  };
}

/** `jM`: a clickable element announced as a button. */
export function buttonProps(onClick?: Action, ariaLabel?: string) {
  if (!onClick) return {};
  return { role: 'button', ...(ariaLabel !== undefined && { 'aria-label': ariaLabel }), ...clickable(onClick) };
}

/** `MM`: text long enough that its row offers "open in an editor tab". */
export function isLongText(text: string): boolean {
  return text.length > 250 || text.split('\n').length > 3;
}

/** `pT`. */
function swallow(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

/** `$8`: an in-app action link. */
export function actionLink(onAction: Action, children: VNodeChild, className?: string): VNodeChild {
  return h('a', { href: '#', class: className, onClick: (e: MouseEvent) => { swallow(e); onAction(); } }, children as any);
}

/** `pH`: an http(s) URL, or undefined. */
export function safeUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** `s6` (module mLrg7g): the dimmed one-line result under a tool header. */
export function secondaryLine(children: VNodeChild, onClick?: Action): VNodeChild {
  return h('div', { class: 'fg-secondaryline__secondaryLine', ...buttonProps(onClick) }, [
    h('span', { class: 'fg-secondaryline__content' }, children as any),
  ]);
}

// The rejection strings the CLI writes into a tool result (`AS`, `wM`).
const REJECTED =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const REJECTED_WITH_REASON =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection: ";

/** `NM`: "Reason: ..." when the user rejected the call and said why. */
export function rejectionReason(result: ToolResultBlock | undefined): VNodeChild | undefined {
  if (!result || !result.is_error || typeof result.content !== 'string') return undefined;
  const text = result.content;
  if (text.includes('<tool_use_error>') || text === REJECTED || !text.startsWith(REJECTED_WITH_REASON)) return undefined;
  return [h('b', 'Reason: '), ' ', text.replace(REJECTED_WITH_REASON, '')];
}

const COPY_PATHS: Record<string, string>[] = [
  {
    'fill-rule': 'evenodd',
    'clip-rule': 'evenodd',
    d: 'M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5v-3.379a3 3 0 0 0-.879-2.121l-3.12-3.121a3 3 0 0 0-1.402-.791 2.252 2.252 0 0 1 1.913-1.576A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z',
  },
  { d: 'M3.5 6A1.5 1.5 0 0 0 2 7.5v9A1.5 1.5 0 0 0 3.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L8.44 6.439A1.5 1.5 0 0 0 7.378 6H3.5Z' },
];
const CHECK_PATHS: Record<string, string>[] = [
  {
    'fill-rule': 'evenodd',
    'clip-rule': 'evenodd',
    d: 'M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z',
  },
];

function heroIcon(paths: Record<string, string>[]) {
  return h(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 20 20', fill: 'currentColor', 'aria-hidden': 'true', 'data-slot': 'icon', class: 'fg-copybutton__copyIcon' },
    paths.map((p) => h('path', p))
  );
}

/** `US` (module CEmTFw): copy to clipboard, showing a check for two seconds. */
export const CopyButton = defineComponent({
  name: 'CopyButton',
  props: {
    getText: { type: Function as PropType<() => string>, required: true },
    className: { type: String, default: '' },
  },
  setup(props) {
    const copied = ref(false);
    const copy = () => {
      void navigator.clipboard.writeText(props.getText()).then(() => {
        copied.value = true;
        setTimeout(() => (copied.value = false), 2000);
      });
    };
    return () =>
      h(
        'button',
        { class: `fg-copybutton__copyButton ${props.className}`, onClick: copy, title: 'Copy code', 'aria-label': 'Copy code to clipboard' },
        [heroIcon(copied.value ? CHECK_PATHS : COPY_PATHS)]
      );
  },
});

interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** `Un0` (module FvGYOg): a disabled checkbox; in progress is drawn indeterminate. */
function todoCheckbox(status: Todo['status']): VNodeChild {
  return h('input', {
    type: 'checkbox',
    class: 'fg-checkbox__checkbox',
    disabled: true,
    ref: (el: unknown) => {
      if (!(el instanceof HTMLInputElement)) return;
      el.checked = status === 'completed';
      el.indeterminate = status === 'in_progress';
    },
  });
}

/** `ZX0` (module xheXVQ): the TodoWrite list. */
export function todoList(todos: Todo[] | undefined): VNodeChild {
  if (!todos || todos.length === 0) return null;
  return h('div', { class: 'fg-todo__todoListContainer' }, [
    h(
      'ul',
      { class: 'fg-todo__todoList' },
      todos.map((todo, i) =>
        h('li', { key: i, class: `fg-todo__todoItem ${todo.status === 'completed' ? 'fg-todo__completed' : ''}` }, [
          todoCheckbox(todo.status),
          h('div', { class: 'fg-todo__content' }, todo.content),
        ])
      )
    ),
  ]);
}
