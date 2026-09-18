import { ref } from 'vue';
import { firstRunBypassed } from './firstRun';

/**
 * The empty state's topic cards, built on the official startup-announcement card.
 * Each introduces one thing Forge can do and offers to do it.
 *
 * Only one thing is shown under the mascot at a time. The first visit gets the
 * official opening tip; after that, each new conversation alternates between the
 * next topic card and a rotating tip, so the page is never stacked. A dismissed
 * card, or one whose action was used, is retired for good; once every card is
 * retired, the tips carry on alone.
 */

export type WelcomeCardIcon = 'bolt' | 'plan' | 'edit' | 'mention' | 'slash' | 'selection' | 'history';

/** Each topic wears one Pajamas hue, the palette showing at the edges of a purple UI. */
export type WelcomeCardTone = 'pink' | 'blue' | 'green' | 'orange' | 'purple' | 'amber' | 'neutral';

export interface WelcomeCard {
  id: string;
  icon: WelcomeCardIcon;
  tone: WelcomeCardTone;
  /** The title as [lead-in, highlighted words]. */
  title: readonly [string, string];
  /** `{chat}` is replaced with the platform's chat shortcut. */
  description: string;
  /** The link that does the thing; omitted when there is nothing to do from here. */
  action?: string;
}

export const WELCOME_CARDS: readonly WelcomeCard[] = [
  {
    id: 'ultracode',
    icon: 'bolt',
    tone: 'pink',
    title: ['Meet ', 'Ultracode'],
    description: 'Extra high effort plus workflow orchestration, on models that support it. Pick it from the last notch of the Effort slider in the model menu or the / menu.',
    action: 'Try Ultracode',
  },
  {
    id: 'plan-mode',
    icon: 'plan',
    tone: 'blue',
    title: ['Think it through in ', 'Plan mode'],
    description: 'Forge explores the code and lays out a plan before it changes anything. Press Shift+Tab to cycle between modes.',
    action: 'Switch to Plan mode',
  },
  {
    id: 'edit-automatically',
    icon: 'edit',
    tone: 'green',
    title: ['Keep moving with ', 'Edit automatically'],
    description: 'Forge applies its edits without stopping to ask each time, and every change is still there to review.',
    action: 'Turn on Edit automatically',
  },
  {
    id: 'mentions',
    icon: 'mention',
    tone: 'orange',
    title: ['Point Forge at files with ', '@'],
    description: 'Type @ in the message box to mention any file in this project, so Forge reads exactly what you mean.',
    action: 'Mention a file',
  },
  {
    id: 'actions-menu',
    icon: 'slash',
    tone: 'purple',
    title: ['Everything is in the ', '/ menu'],
    description: 'Switch models, set effort, toggle thinking and open settings, all from one place.',
    action: 'Open the / menu',
  },
  {
    id: 'selection',
    icon: 'selection',
    tone: 'amber',
    title: ['Chat about a ', 'selection'],
    description: 'Highlight code in the editor and press {chat} to bring it straight into the conversation.',
  },
  {
    id: 'history',
    icon: 'history',
    tone: 'neutral',
    title: ['Pick up ', 'where you left off'],
    description: 'Every conversation is kept. Open past conversations from the clock button above to carry one on.',
    action: 'Browse past conversations',
  },
];

const DISMISSED_PREFIX = 'forge-vscode-startup-announcement-dismissed:';
const CURSOR_KEY = 'forge-vscode-welcome-cursor';

function storageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Without storage the rotation simply restarts next time.
  }
}

const retired = ref(new Set(WELCOME_CARDS.filter((c) => storageGet(DISMISSED_PREFIX + c.id) === 'true').map((c) => c.id)));

/**
 * What the next empty state shows: a topic card, or undefined for a tip.
 * Advances the rotation, so call it once per empty state.
 */
export function nextWelcomeCard(): WelcomeCard | undefined {
  if (!firstRunBypassed.value) return undefined;
  const available = WELCOME_CARDS.filter((c) => !retired.value.has(c.id));
  if (!available.length) return undefined;
  const cursor = Number(storageGet(CURSOR_KEY)) || 0;
  storageSet(CURSOR_KEY, String(cursor + 1));
  if (cursor % 2 === 1) return undefined;
  return available[(cursor / 2) % available.length];
}

/** Retire a card: dismissed, or its action used. */
export function retireWelcomeCard(id: string): void {
  retired.value = new Set([...retired.value, id]);
  storageSet(DISMISSED_PREFIX + id, 'true');
}
