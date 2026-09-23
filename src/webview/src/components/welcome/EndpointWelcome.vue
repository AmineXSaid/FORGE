<template>
  <!--
    The first-run welcome, on the official login page's markup (module Eg8KCQ):
    a full-bleed art block, the explanatory copy, a full-width primary action
    with its note beneath, and the terminal line at the bottom.

    Like the official's, this is a gate: the composer is hidden behind it and
    the page holds the surface until an endpoint exists. The official gates on
    login; Forge gates on where your work is sent, and on whether anything
    there answers. A gateway that lists a hundred models it cannot serve is
    exactly as unusable as no gateway, and used to read as "100 models".

    Three states, and only the last of them can be dismissed:

      A  no profiles at all        -> Set up an endpoint
      B  profiles, never checked   -> Set up an endpoint · Check health
      C  checked, nothing answered -> the above, plus Skip to chat

    "Skip to chat" is the one deliberate softening of the gate. A stored verdict
    can be wrong (the gateway was down for the minute the sweep ran, the token
    had expired, the laptop was on the wrong network) and a hard gate on a wrong
    verdict strands the user worse than no check at all.
  -->
  <!--
    The page keeps the official login page's skeleton (module Eg8KCQ): the
    container, the art block, the copy, `methodSelection` with the one full-width
    primary action. What is Forge's own sits on `forge-welcome__*` classes: a
    three-step type hierarchy, the providers as chips, the keychain promise on a
    line of its own, and the terminal offer as a card pinned to the bottom --
    the same banner the chat page shows above its composer. Every colour comes
    from the Pajamas welcome tokens in `forge-tokens.css`.
  -->
  <div class="fg-welcome__container forge-welcome">
    <div class="forge-welcome__layout">
      <div class="fg-welcome__baseState forge-welcome__stage">
        <div class="fg-welcome__asciiArtContainer forge-welcome__art">
          <span class="forge-welcome__glow" aria-hidden="true" />
          <ForgeWelcomeArt />
        </div>

        <!--
          Three steps, in reading order: what Forge is, the one fact that makes
          it different, and the question the page exists to ask.
        -->
        <header class="forge-welcome__intro">
          <template v-if="state === 'none-healthy'">
            <h1 class="forge-welcome__headline">None of these endpoints answered</h1>
            <p class="forge-welcome__lede">Forge asked every model on them to reply, and none did.</p>
            <p class="forge-welcome__question">Check again, or add another endpoint?</p>
          </template>
          <template v-else-if="state === 'unchecked'">
            <h1 class="forge-welcome__headline">Your endpoints are set up</h1>
            <p class="forge-welcome__lede">Forge has not asked their models to answer yet.</p>
            <p class="forge-welcome__question">Check which models reply?</p>
          </template>
          <template v-else>
            <h1 class="forge-welcome__headline">
              Forge runs the real <code class="forge-welcome__code">claude</code> CLI
            </h1>
            <p class="forge-welcome__lede">It does not have to talk to api.anthropic.com.</p>
            <p class="forge-welcome__question">Where should Forge send your work?</p>
          </template>
        </header>

        <!--
          Forge-only, on `forge-welcome__*` classes so no ported `fg-welcome__*`
          rule is overridden (rule 4). A real table, with a header and a row per
          endpoint: the page is reporting a measurement, and a measurement with no
          column heading is a number the reader has to guess the units of.
        -->
        <table v-if="endpoints.length" class="forge-welcome__report">
          <thead>
            <tr>
              <th scope="col">Endpoint</th>
              <th scope="col" class="forge-welcome__reportNum">Answering</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in endpoints" :key="row.profileName">
              <th scope="row" class="forge-welcome__reportName">
                <span
                  class="forge-welcome__dot"
                  :data-state="stateOf(row)"
                  aria-hidden="true"
                />
                <code>{{ row.profileName }}</code>
              </th>
              <td class="forge-welcome__reportNum" :data-state="stateOf(row)">
                <template v-if="row.syncing">checking</template>
                <template v-else-if="!row.lastSyncedAt">not checked</template>
                <template v-else>{{ healthy(row) }} of {{ row.models.length }}</template>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="fg-welcome__methodSelection">
          <button
            class="fg-welcome__fullWidthButton fg-welcome__primary forge-welcome__cta"
            :class="{ 'forge-welcome__cta--busy': adding }"
            :disabled="adding"
            :aria-busy="adding"
            title="Find a local model server, or connect a gateway"
            @click="emit('add')"
          >
            <span v-if="adding" class="forge-welcome__spinner" aria-hidden="true" />
            <span>{{ adding ? 'Setting up your endpoint…' : 'Set up an endpoint' }}</span>
          </button>
          <p class="forge-welcome__hint" :class="{ 'forge-welcome__hint--on': adding }" aria-live="polite">
            {{ adding ? 'Answer the prompts at the top of the window.' : '' }}
          </p>

          <template v-if="state === 'no-profiles'">
            <p class="forge-welcome__caption">Found for you when they are running</p>
            <ul class="forge-welcome__chips" aria-label="Local model servers Forge detects">
              <li v-for="name in PROVIDERS" :key="name" class="forge-welcome__chip">{{ name }}</li>
            </ul>
            <p class="forge-welcome__keychain">
              <LockIcon class="forge-welcome__lock" />
              <span>
                Tokens go to the OS keychain, never to
                <code class="forge-welcome__code">settings.json</code>.
              </span>
            </p>
          </template>

          <!--
            The two Forge-only actions, side by side rather than stacked: three
            full-width slabs read as three equal choices, and they are not. One
            sets an endpoint up, the other two are what you do about the one you
            have. "Check health" leads with its mark because it acts on the table
            above; "Skip to chat" trails with an arrow because it moves you past
            the page.
          -->
          <div v-if="state !== 'no-profiles'" class="forge-welcome__actions">
            <button
              class="forge-welcome__action forge-welcome__action--check"
              :disabled="checking"
              title="Send every model one four-token request and keep what answers"
              @click="emit('check')"
            >
              <SignalIcon class="forge-welcome__actionIcon" :class="checking && 'forge-welcome__actionIcon--live'" />
              {{ checking ? 'Checking' : 'Check health' }}
            </button>

            <button
              v-if="state === 'none-healthy'"
              class="forge-welcome__action forge-welcome__action--skip"
              title="Open the composer anyway. Sending still works; a model that cannot answer will say so."
              @click="emit('skip')"
            >
              Skip to chat
              <ArrowRightIcon class="forge-welcome__actionIcon forge-welcome__actionIcon--trailing" />
            </button>
          </div>

          <p v-if="state !== 'no-profiles'" class="forge-welcome__caption">
            A check costs one four-token request per model.
          </p>
        </div>
      </div>

      <div class="forge-welcome__footer">
        <TerminalBanner command card location="bottom" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ForgeWelcomeArt from './ForgeWelcomeArt.vue';
import TerminalBanner from './TerminalBanner.vue';
import SignalIcon from '../forge/icons/SignalIcon.vue';
import ArrowRightIcon from '../forge/icons/ArrowRightIcon.vue';
import LockIcon from '../forge/icons/LockIcon.vue';
import type { EndpointHealth } from '../../../../shared/messages';
// Which of the three states the page is in is decided by the gate, not here.
import type { EndpointWelcomeState } from '../../utils/endpointWelcome';

const props = defineProps<{
  state: EndpointWelcomeState;
  /** One row per profile. Empty in state A, where there are none. */
  health?: EndpointHealth[];
  /**
   * The setup flow is open. The host answers `run_endpoint_action` only when
   * the flow ends -- saved, or dismissed -- so this spans exactly the time the
   * prompts are up, and the button says so instead of looking idle.
   */
  adding?: boolean;
}>();

/** The runtimes the setup flow probes, in the order it lists them. */
const PROVIDERS = ['Ollama', 'LM Studio', 'vLLM', 'llama.cpp', 'Jan'] as const;

const emit = defineEmits<{
  /** Open the guided "Add endpoint" flow. */
  (e: 'add'): void;
  /** Sweep every profile now. */
  (e: 'check'): void;
  /** Put the gate away and show the composer. */
  (e: 'skip'): void;
}>();

const endpoints = computed<EndpointHealth[]>(() => props.health ?? []);
const checking = computed(() => endpoints.value.some((row) => row.syncing));

function healthy(row: EndpointHealth): number {
  return row.models.filter((m) => m.servable).length;
}

/** What the dot and the count are saying, in one word the styles key off. */
function stateOf(row: EndpointHealth): 'live' | 'dead' | 'unknown' {
  if (row.syncing || !row.lastSyncedAt) return 'unknown';
  return healthy(row) > 0 ? 'live' : 'dead';
}
</script>

<style scoped>
/* ---------------------------------------------------------------------------
 * The page. Divergence #20 in `docs/forge-design.md`.
 *
 * The ported `fg-welcome__*` rules paint with `--app-primary-background` and
 * `--app-primary-foreground`. They are re-pointed here, inside this subtree
 * only, at the Pajamas welcome tokens -- so the official rules still do the
 * painting and none of them is overridden. The same move re-points the primary
 * button's fill (`--forge-brand-strong`) at purple-500.
 * ------------------------------------------------------------------------ */
.forge-welcome {
  --app-primary-background: var(--forge-welcome-bg);
  --app-primary-foreground: var(--forge-welcome-fg);
  --app-secondary-foreground: var(--forge-welcome-muted);
  --forge-brand-strong: var(--forge-welcome-brand);
  --forge-on-brand: var(--forge-welcome-on-brand);
  --forge-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
}

/*
 * A column that fills the page: the stage centred in whatever height is left,
 * the terminal card at the foot. Its own flex box, so the ported container's
 * centring is left alone and simply has one child to centre.
 */
.forge-welcome__layout {
  align-items: center;
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  gap: 24px;
  width: 100%;
}

.forge-welcome__stage {
  margin-block: auto;
  text-align: center;
}

/* ---- The art ------------------------------------------------------------ */

.forge-welcome__art {
  isolation: isolate;
  position: relative;
}

/*
 * The forge's glow: a low ember under the figure and the cube, where the
 * drawing already puts its purple. It breathes, slowly, once the page has
 * settled -- the page's one authored motion.
 */
.forge-welcome__glow {
  background: radial-gradient(60% 55% at 58% 78%, var(--forge-welcome-glow), transparent 70%);
  filter: blur(8px);
  inset: 0 6%;
  pointer-events: none;
  position: absolute;
  z-index: -1;
  animation:
    forge-welcome-glow-in 900ms var(--forge-ease-out) both,
    forge-welcome-breathe 5.6s ease-in-out 900ms infinite;
}

.forge-welcome__art :deep(.fg-welcomeart) {
  animation: forge-welcome-rise 700ms var(--forge-ease-out) both;
}

@keyframes forge-welcome-glow-in {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes forge-welcome-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.62; }
}

@keyframes forge-welcome-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---- The copy: headline, lede, question --------------------------------- */

.forge-welcome__intro {
  animation: forge-welcome-rise 600ms var(--forge-ease-out) 120ms both;
  margin: 8px auto 20px;
}

.forge-welcome__headline {
  color: var(--forge-welcome-fg);
  font-size: 1.38em;
  font-weight: 600;
  letter-spacing: -0.012em;
  line-height: 1.25;
  margin: 0;
  text-wrap: balance;
}

.forge-welcome__lede {
  color: var(--forge-welcome-muted);
  font-size: 1em;
  line-height: 1.5;
  margin: 6px 0 0;
  text-wrap: balance;
}

.forge-welcome__question {
  color: var(--forge-welcome-fg);
  font-size: 1.04em;
  font-weight: 500;
  line-height: 1.4;
  margin: 18px 0 0;
}

/* `claude`, `settings.json`: inline code, set as chips in the brand's tint. */
.forge-welcome__code {
  background: var(--forge-welcome-chip-bg);
  border: 1px solid var(--forge-welcome-chip-border);
  border-radius: var(--corner-radius-small);
  color: var(--forge-welcome-chip-fg);
  font-family: var(--app-monospace-font-family);
  font-size: 0.86em;
  font-weight: 500;
  padding: 0.08em 0.4em;
  white-space: nowrap;
}

/* ---- The primary action ------------------------------------------------- */

.fg-welcome__methodSelection {
  animation: forge-welcome-rise 600ms var(--forge-ease-out) 200ms both;
}

/*
 * The ported `fullWidthButton primary` supplies the geometry and the fill.
 * Forge adds height, a softer radius, depth and the four states; the hover is
 * a colour step (purple-400) rather than the ported brightness filter, because
 * the specified hover is a Pajamas stop, not a lightened purple-500.
 */
.forge-welcome__cta {
  align-items: center;
  border: 1px solid var(--forge-welcome-cta-border);
  border-radius: var(--corner-radius-medium);
  box-shadow:
    0 1px 0 color-mix(in srgb, var(--forge-welcome-on-brand) 18%, transparent) inset,
    0 6px 16px -8px var(--forge-welcome-shadow);
  display: flex;
  font-size: 1em;
  gap: 8px;
  justify-content: center;
  margin-top: 0;
  min-height: 34px;
  transition:
    background-color 160ms var(--forge-ease-out),
    box-shadow 160ms var(--forge-ease-out),
    transform 160ms var(--forge-ease-out);
}

.forge-welcome__cta:hover:not(:disabled) {
  background-color: var(--forge-welcome-brand-hover);
  box-shadow:
    0 1px 0 color-mix(in srgb, var(--forge-welcome-on-brand) 22%, transparent) inset,
    0 10px 22px -10px var(--forge-welcome-shadow);
  filter: none;
  transform: translateY(-1px);
}

.forge-welcome__cta:active:not(:disabled) {
  background-color: var(--forge-welcome-brand-active);
  box-shadow: 0 2px 6px -4px var(--forge-welcome-shadow);
  transform: translateY(0) scale(0.99);
}

.forge-welcome__cta:focus-visible {
  outline: 2px solid var(--forge-welcome-ring);
  outline-offset: 2px;
}

/* Busy is not disabled-looking: the fill stays, the label says what is happening. */
.forge-welcome__cta--busy:disabled {
  cursor: progress;
  opacity: 1;
}

.forge-welcome__spinner {
  animation: forge-welcome-spin 800ms linear infinite;
  border: 1.5px solid color-mix(in srgb, var(--forge-welcome-on-brand) 35%, transparent);
  border-radius: 50%;
  border-top-color: var(--forge-welcome-on-brand);
  flex: none;
  height: 12px;
  width: 12px;
}

@keyframes forge-welcome-spin {
  to { transform: rotate(360deg); }
}

/* Reserved height, so the page does not jump when the hint appears. */
.forge-welcome__hint {
  color: var(--forge-welcome-muted);
  font-size: 0.9em;
  margin: 6px 0 0;
  min-height: 1.4em;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 200ms var(--forge-ease-out), transform 200ms var(--forge-ease-out);
}

.forge-welcome__hint--on {
  opacity: 1;
  transform: translateY(0);
}

/* ---- Providers and the keychain promise --------------------------------- */

.forge-welcome__caption {
  color: var(--forge-welcome-muted);
  font-size: 0.86em;
  margin: 14px 0 8px;
}

.forge-welcome__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  list-style: none;
  margin: 0;
  padding: 0;
}

.forge-welcome__chip {
  background: var(--forge-welcome-surface);
  border: 1px solid var(--forge-welcome-border);
  border-radius: 999px;
  color: var(--forge-welcome-fg);
  font-size: 0.86em;
  line-height: 1.5;
  padding: 2px 10px;
  transition: border-color 160ms var(--forge-ease-out), color 160ms var(--forge-ease-out);
}

.forge-welcome__chip:hover {
  border-color: var(--forge-welcome-chip-border);
  color: var(--forge-welcome-chip-fg);
}

.forge-welcome__keychain {
  align-items: center;
  color: var(--forge-welcome-muted);
  display: flex;
  font-size: 0.9em;
  gap: 6px;
  justify-content: center;
  line-height: 1.45;
  margin: 16px 0 0;
}

.forge-welcome__lock {
  color: var(--forge-welcome-chip-fg);
  flex: none;
  height: 15px;
  width: 15px;
}

/* ---- The terminal card -------------------------------------------------- */

.forge-welcome__footer {
  animation: forge-welcome-rise 600ms var(--forge-ease-out) 320ms both;
  display: flex;
  justify-content: center;
  width: 100%;
}

/* ---- Narrow and wide panels --------------------------------------------- */

@media (max-width: 360px) {
  .forge-welcome__headline {
    font-size: 1.22em;
  }

  .forge-welcome__keychain {
    align-items: flex-start;
    text-align: left;
  }
}

@media (min-width: 720px) {
  .forge-welcome__headline {
    font-size: 1.5em;
  }
}

/* ---------------------------------------------------------------------------
 * The report table. Divergence #18 in `docs/forge-design.md`; the official page
 * has no element here at all.
 * ------------------------------------------------------------------------ */

.forge-welcome__report {
  border-collapse: collapse;
  margin: 1em 0 1.25em;
  table-layout: auto;
  width: 100%;
}

/*
 * The heading row is a label, so it sits at the size and weight of a label:
 * small, wide-tracked, recessive. It earns its keep by naming the unit, which
 * is the one thing a bare count cannot do for itself.
 */
.forge-welcome__report thead th {
  border-bottom: 1px solid var(--app-transparent-inner-border);
  color: var(--app-secondary-foreground);
  font-size: 0.78em;
  font-weight: 500;
  letter-spacing: 0.06em;
  padding: 0 0 0.35em;
  text-align: left;
  text-transform: uppercase;
}

.forge-welcome__report tbody th,
.forge-welcome__report tbody td {
  border-bottom: 1px solid color-mix(in srgb, var(--app-transparent-inner-border) 55%, transparent);
  font-weight: 400;
  padding: 0.45em 0;
  vertical-align: middle;
}

.forge-welcome__report tbody tr:last-child th,
.forge-welcome__report tbody tr:last-child td {
  border-bottom: 0;
}

.forge-welcome__reportName {
  align-items: center;
  display: flex;
  gap: 0.6em;
  min-width: 0;
  text-align: left;
}

.forge-welcome__reportName code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * Counts are compared down the column, so they get tabular figures. Browser
 * defaults give proportional ones, which makes a column of numbers wobble.
 */
.forge-welcome__reportNum {
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

/*
 * The heading sits over its own column, not beside it. Spelled out at the
 * higher specificity because the `thead th` rule above sets the default
 * alignment for the row and would otherwise win on element count alone.
 */
.forge-welcome__report thead th.forge-welcome__reportNum {
  text-align: right;
}

/* The number is the verdict, so the verdict is what carries the colour. */
.forge-welcome__reportNum[data-state='dead'] {
  color: var(--forge-danger);
  font-weight: 500;
}

.forge-welcome__reportNum[data-state='live'] {
  color: var(--forge-success);
}

.forge-welcome__reportNum[data-state='unknown'] {
  color: var(--app-secondary-foreground);
}

/*
 * A status dot, on the Pajamas status hues with their own derived ring. Same
 * mark the sessions list uses for a live conversation, so "this thing is
 * responding" reads the same way twice in the product.
 */
.forge-welcome__dot {
  border-radius: 50%;
  flex: none;
  height: 6px;
  width: 6px;
}

.forge-welcome__dot[data-state='live'] {
  background: var(--forge-success);
  box-shadow: 0 0 0 3px var(--forge-success-surface);
}

.forge-welcome__dot[data-state='dead'] {
  background: var(--forge-danger);
  box-shadow: 0 0 0 3px var(--forge-danger-surface);
}

.forge-welcome__dot[data-state='unknown'] {
  background: var(--app-secondary-foreground);
  opacity: 0.5;
}

/* ---------------------------------------------------------------------------
 * The two Forge-only actions. Divergence #19.
 * ------------------------------------------------------------------------ */

.forge-welcome__actions {
  display: flex;
  gap: 6px;
  margin-top: 0.5em;
}

/*
 * Deliberately *not* `.fg-welcome__fullWidthButton`. That class is the
 * official's one primary action, and these two are neither primary nor the
 * official's; borrowing it and then overriding half of it is the scoped-override
 * failure rule 4 names. The shared geometry (2px radius, 6px/8px padding,
 * weight 500) is matched by value instead, so the three read as one family.
 */
.forge-welcome__action {
  align-items: center;
  background-color: transparent;
  border: 1px solid var(--app-transparent-inner-border);
  border-radius: 2px;
  box-sizing: border-box;
  color: var(--app-primary-foreground);
  cursor: pointer;
  display: inline-flex;
  flex: 1 1 0;
  font-family: inherit;
  font-weight: 500;
  gap: 0.45em;
  justify-content: center;
  padding: 6px 8px;
  transition: background-color 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out;
}

.forge-welcome__action:disabled {
  cursor: default;
  opacity: 0.66;
}

.forge-welcome__action:focus-visible {
  outline: 1px solid var(--forge-focus-ring);
  outline-offset: 1px;
}

.forge-welcome__actionIcon {
  flex: none;
  height: 1em;
  width: 1em;
}

/*
 * Checking is an act of reaching out, so the mark that means "reaching out"
 * is the thing that moves, and only while it is true. One authored moment on
 * the page; everything else holds still.
 */
.forge-welcome__actionIcon--live {
  animation: forge-welcome-ping 1.6s ease-in-out infinite;
}

@keyframes forge-welcome-ping {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

.forge-welcome__action--check:hover:not(:disabled) {
  background-color: var(--forge-accent-subtle);
  border-color: var(--forge-accent);
  color: var(--forge-accent);
}

.forge-welcome__action--skip:hover:not(:disabled) {
  background-color: var(--app-ghost-button-hover-background);
}

.forge-welcome__actionIcon--trailing {
  transition: transform 160ms cubic-bezier(0.32, 0.72, 0, 1);
}

.forge-welcome__action--skip:hover:not(:disabled) .forge-welcome__actionIcon--trailing {
  transform: translateX(2px);
}

@media (prefers-reduced-motion: reduce) {
  .forge-welcome__glow,
  .forge-welcome__art :deep(.fg-welcomeart),
  .forge-welcome__intro,
  .fg-welcome__methodSelection,
  .forge-welcome__footer {
    animation: none;
  }

  .forge-welcome__spinner {
    animation-duration: 2.4s;
  }

  .forge-welcome__cta,
  .forge-welcome__hint,
  .forge-welcome__chip {
    transition: none;
  }

  .forge-welcome__cta:hover:not(:disabled),
  .forge-welcome__cta:active:not(:disabled),
  .forge-welcome__hint {
    transform: none;
  }

  .forge-welcome__action,
  .forge-welcome__actionIcon--trailing {
    transition: none;
  }

  .forge-welcome__actionIcon--live {
    animation: none;
    opacity: 0.7;
  }

  .forge-welcome__action--skip:hover:not(:disabled) .forge-welcome__actionIcon--trailing {
    transform: none;
  }
}
</style>
