/**
 * The empty state offers to set up an endpoint when there is none.
 *
 * Built on the card Forge already ports from the official startup announcement
 * (`bq0` / `Oq0`, module `BrnsCQ`) rather than a new component: the official
 * has no endpoint concept, so there is no markup to copy, and inventing a
 * second card shape would be the parity failure this skill exists to prevent.
 *
 * What is *not* borrowed is the rotation. `WELCOME_CARDS` alternate with tips
 * and exist to introduce a feature; this one is setup, so it holds the slot on
 * every empty state until it is dealt with.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * A localStorage, because the tests run in `environment: 'node'` and the
 * module reads dismissals from one. Without it `storageGet` silently answers
 * `null` for everything and the persistence path is never exercised -- which
 * is exactly the behaviour worth testing.
 */
function installStorage(): Map<string, string> {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => void entries.set(k, String(v)),
      removeItem: (k: string) => void entries.delete(k),
      clear: () => entries.clear(),
    },
  });
  return entries;
}

let storage: Map<string, string>;

/** Each test gets its own module instance, because the retired set is module state. */
async function load() {
  vi.resetModules();
  const firstRun = await import('../src/webview/src/utils/firstRun');
  firstRun.firstRunBypassed.value = true;
  return import('../src/webview/src/utils/announcements');
}

beforeEach(() => {
  storage = installStorage();
});

describe('when no endpoint exists', () => {
  it('offers the setup card', async () => {
    const { nextWelcomeCard, ENDPOINT_SETUP_CARD } = await load();
    expect(nextWelcomeCard({ hasEndpoints: false })).toBe(ENDPOINT_SETUP_CARD);
  });

  it('keeps offering it on every empty state, not every other one', async () => {
    // The rotation deliberately returns `undefined` half the time so the page
    // is never stacked. A setup prompt that appears every other conversation
    // reads as noise rather than as something to do.
    const { nextWelcomeCard, ENDPOINT_SETUP_CARD } = await load();
    for (let i = 0; i < 6; i++) {
      expect(nextWelcomeCard({ hasEndpoints: false })).toBe(ENDPOINT_SETUP_CARD);
    }
  });

  it('does not consume a rotation slot', async () => {
    // The feature cards should resume from the start once the setup card is
    // gone, not from wherever the cursor would have reached.
    const { nextWelcomeCard, WELCOME_CARDS } = await load();
    for (let i = 0; i < 4; i++) nextWelcomeCard({ hasEndpoints: false });
    expect(nextWelcomeCard({ hasEndpoints: true })).toBe(WELCOME_CARDS[0]);
  });

  it('carries an action, a title and a description', async () => {
    const { ENDPOINT_SETUP_CARD } = await load();
    expect(ENDPOINT_SETUP_CARD.action).toBe('Add an endpoint');
    expect(ENDPOINT_SETUP_CARD.title.join('')).toContain('your own endpoint');
    expect(ENDPOINT_SETUP_CARD.description).toBeTruthy();
    expect(ENDPOINT_SETUP_CARD.icon).toBe('endpoint');
  });

  it('says where the token goes, because that is the question it raises', async () => {
    const { ENDPOINT_SETUP_CARD } = await load();
    expect(ENDPOINT_SETUP_CARD.description).toContain('keychain');
    expect(ENDPOINT_SETUP_CARD.description).toContain('settings.json');
  });

  it('advertises the local-runtime detection, which is what makes it quick', async () => {
    // The copy has to match what the action actually does, or the card is
    // promising a five-question form that no longer appears for a local model.
    const { ENDPOINT_SETUP_CARD } = await load();
    const { LOCAL_RUNTIMES } = await import('../src/services/endpoints/discover');
    const named = LOCAL_RUNTIMES.filter((r) => ENDPOINT_SETUP_CARD.description.includes(r.label));
    expect(named.length).toBeGreaterThanOrEqual(2);
  });
});

describe('when it should stay out of the way', () => {
  it('is not offered once an endpoint exists', async () => {
    const { nextWelcomeCard, ENDPOINT_SETUP_CARD } = await load();
    expect(nextWelcomeCard({ hasEndpoints: true })).not.toBe(ENDPOINT_SETUP_CARD);
  });

  it('is held back while init has not answered', async () => {
    // `undefined` is "not known yet". Showing the card then would flash it at
    // someone who already has an endpoint, every single launch.
    const { nextWelcomeCard, ENDPOINT_SETUP_CARD } = await load();
    expect(nextWelcomeCard({})).not.toBe(ENDPOINT_SETUP_CARD);
    expect(nextWelcomeCard({ hasEndpoints: undefined })).not.toBe(ENDPOINT_SETUP_CARD);
  });

  it('stays gone once dismissed, because Anthropic direct is a normal way to run', async () => {
    const { nextWelcomeCard, retireWelcomeCard, ENDPOINT_SETUP_CARD } = await load();
    expect(nextWelcomeCard({ hasEndpoints: false })).toBe(ENDPOINT_SETUP_CARD);
    retireWelcomeCard(ENDPOINT_SETUP_CARD.id);
    for (let i = 0; i < 4; i++) {
      expect(nextWelcomeCard({ hasEndpoints: false })).not.toBe(ENDPOINT_SETUP_CARD);
    }
  });

  it('survives a reload once dismissed', async () => {
    const first = await load();
    first.retireWelcomeCard(first.ENDPOINT_SETUP_CARD.id);
    // The dismissal reached storage, which is what a reload reads back.
    expect([...storage.keys()]).toContain(
      'forge-vscode-startup-announcement-dismissed:endpoint-setup',
    );

    const reloaded = await load();
    expect(reloaded.nextWelcomeCard({ hasEndpoints: false }))
      .not.toBe(reloaded.ENDPOINT_SETUP_CARD);
  });

  it('IS offered on a brand-new install, unlike the rotation cards', async () => {
    // The first-run gate keeps feature announcements off the very first
    // screen. Setup is not an announcement: a fresh install with no endpoint
    // is exactly who this is for, and a prompt that waits for the first
    // message arrives after the failure it was meant to prevent. A deliberate
    // divergence from the official empty state; see docs/forge-design.md.
    vi.resetModules();
    const firstRun = await import('../src/webview/src/utils/firstRun');
    firstRun.firstRunBypassed.value = false;
    const { nextWelcomeCard, ENDPOINT_SETUP_CARD, WELCOME_CARDS } =
      await import('../src/webview/src/utils/announcements');

    expect(nextWelcomeCard({ hasEndpoints: false })).toBe(ENDPOINT_SETUP_CARD);
    // The rotation still waits, so the first screen is otherwise untouched.
    const rotation = nextWelcomeCard({ hasEndpoints: true });
    expect(rotation).toBeUndefined();
    expect(WELCOME_CARDS.length).toBeGreaterThan(0);
  });
});

describe('it is a card, not a new component', () => {
  it('has the same shape as every rotation card', async () => {
    const { ENDPOINT_SETUP_CARD, WELCOME_CARDS } = await load();
    const keys = (c: object) => Object.keys(c).sort();
    expect(keys(ENDPOINT_SETUP_CARD)).toEqual(keys(WELCOME_CARDS[0]));
  });

  it('is not in the rotation array', async () => {
    const { ENDPOINT_SETUP_CARD, WELCOME_CARDS } = await load();
    expect(WELCOME_CARDS.map((c) => c.id)).not.toContain(ENDPOINT_SETUP_CARD.id);
  });
});

describe('what puts the welcome page up', () => {
  /** Mirrors the computed in `ChatPage.vue`. */
  const showsWelcome = (modelCount: number | undefined) => modelCount === 0;

  it('shows it when there is nothing to talk to', () => {
    // The question the page asks is "where should Forge send your work". The
    // moment that matters is when there is nowhere: no endpoint, an endpoint
    // serving nothing, or one that cannot be reached.
    expect(showsWelcome(0)).toBe(true);
  });

  it('stays out of the way once any model is offered', () => {
    for (const n of [1, 2, 40]) expect(showsWelcome(n)).toBe(false);
  });

  it('does not flash while the model list is still loading', () => {
    // `undefined` is "not known yet" -- get_claude_state has not answered --
    // and must not be treated as zero, or the page appears on every launch.
    expect(showsWelcome(undefined)).toBe(false);
  });
});
