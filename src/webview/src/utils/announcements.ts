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

export type WelcomeCardIcon = 'bolt' | 'plan' | 'edit' | 'mention' | 'slash' | 'selection' | 'history' | 'endpoint';

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

/**
 * Shown ahead of the rotation while no endpoint profile exists.
 *
 * Not one of `WELCOME_CARDS`: those rotate, alternate with tips and are there
 * to introduce a feature. This one is setup, so it holds the slot on every
 * empty state until it is dealt with -- a prompt that appears every other
 * conversation is a prompt that reads as noise.
 *
 * It retires for good on dismiss, because running against Anthropic directly
 * is a perfectly normal way to use Forge and a permanent nag would be wrong.
 * It also stops appearing the moment a profile exists, without a dismissal.
 */
export const ENDPOINT_SETUP_CARD: WelcomeCard = {
  id: 'endpoint-setup',
  icon: 'endpoint',
  tone: 'purple',
  title: ['Run Forge on ', 'your own endpoint'],
  description:
    'Forge looks for an Ollama, LM Studio or vLLM already running here and offers it with its own model list — or point it at a company gateway. A token goes to the OS keychain, never to settings.json.',
  action: 'Add an endpoint',
};

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

const retired = ref(
  new Set(
    [ENDPOINT_SETUP_CARD, ...WELCOME_CARDS]
      .filter((c) => storageGet(DISMISSED_PREFIX + c.id) === 'true')
      .map((c) => c.id),
  ),
);

/** What the empty state needs to know about the host to choose a card. */
export interface WelcomeContext {
  /**
   * Whether any endpoint profile parses. `undefined` while `init` is still in
   * flight -- the setup card is held back until the answer is known, so it
   * never flashes at someone who already has one.
   */
  hasEndpoints?: boolean;
}

/**
 * What the next empty state shows: a topic card, or undefined for a tip.
 * Advances the rotation, so call it once per empty state.
 */
export function nextWelcomeCard(context: WelcomeContext = {}): WelcomeCard | undefined {
  // Setup before features, and before the first-run gate.
  //
  // The gate exists so the very first screen is the official opening tip
  // rather than a feature card -- right for an announcement, wrong for this.
  // A brand-new install with no endpoint is exactly who this is for, and a
  // setup prompt that waits until after the first message is a prompt that
  // arrives after the failure it was meant to prevent. Recorded as a
  // divergence in `docs/forge-design.md`.
  //
  // It deliberately does not advance the cursor, so the rotation resumes where
  // it left off once this card is gone.
  if (context.hasEndpoints === false && !retired.value.has(ENDPOINT_SETUP_CARD.id)) {
    return ENDPOINT_SETUP_CARD;
  }
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
