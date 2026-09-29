<template>
  <!--
    The first-run welcome: "C · Summary", the design the user chose on the design
    canvas (2026-09-26). Divergence #55 in `docs/forge-design.md`.

    Like the official login page it stands in for, it is a gate: the composer
    is hidden behind it, and the chat's header is too (the official renders its
    login page without the header). Forge gates on where your work is sent, and
    on whether anything there answers:

      no-profiles  -> Set up an endpoint   · Use the terminal
      unchecked    -> Check models         · Use the terminal
      none-healthy -> Check again          · Skip to chat

    plus two passing states on any of them: setting up (the add flow is open)
    and checking (a sweep is running). "Skip to chat" is the one deliberate
    softening of the gate: a stored verdict can be wrong (the gateway was down
    for the minute the sweep ran), and a hard gate on a wrong verdict strands
    the user worse than no check at all.

    Only the official container remains (`fg-welcome__container`: the ground,
    the scrolling, the centring); everything inside is Forge's own, on
    `forge-welcome__*` classes, so no ported rule is overridden (rule 4).
  -->
  <div class="fg-welcome__container forge-welcome">
    <div class="forge-welcome__layout">
      <div class="forge-welcome__stage">
        <div class="forge-welcome__panel">
          <ForgeWelcomeArt />
        </div>

        <header class="forge-welcome__card">
          <p class="forge-welcome__eyebrow">Forge for VS Code</p>
          <template v-if="state === 'no-profiles'">
            <h1 class="forge-welcome__headline">
              Claude Code, <span class="forge-welcome__accent">reforged</span>,<br>on the model you choose
            </h1>
            <p class="forge-welcome__lede">
              Forge runs the real <code class="forge-welcome__code">claude</code> CLI in VS Code, and adds its own
              craft: any endpoint, edits you watch live, guards against loops.
            </p>
          </template>
          <template v-else>
            <h1 class="forge-welcome__headline">{{ copy.title }}</h1>
            <p class="forge-welcome__lede">{{ copy.lede }}</p>
          </template>
        </header>
      </div>

      <div class="forge-welcome__middle">
        <div v-if="state === 'no-profiles'" class="forge-welcome__intro">
          <span class="forge-welcome__rule" aria-hidden="true" />
          <p class="forge-welcome__statement">
            <template v-for="part in PROVIDER_PARTS" :key="part.name">
              <span class="forge-welcome__name">{{ part.name }}</span>{{ part.after }}
            </template>, found the moment they run. Or any
            <span class="forge-welcome__name">OpenAI</span>- or
            <span class="forge-welcome__name">Anthropic</span>-compatible gateway.
          </p>
        </div>

        <div v-else class="forge-welcome__summary" aria-live="polite">
          <p class="forge-welcome__count" :data-tone="summary.count.tone">
            {{ summary.count.value }}<span class="forge-welcome__countUnit">{{ summary.count.unit }}</span>
          </p>
          <p class="forge-welcome__countLabel">{{ summary.count.label }}</p>

          <div class="forge-welcome__bar" aria-hidden="true">
            <span
              v-for="(segment, i) in summary.segments"
              :key="i"
              class="forge-welcome__segment"
              :data-kind="segment.kind"
              :data-ticked="segment.ticks > 0 || undefined"
              :style="{ flexGrow: segment.weight }"
            >
              <template v-if="segment.ticks > 0">
                <span
                  v-for="t in segment.ticks"
                  :key="t"
                  class="forge-welcome__tick"
                  :data-on="t <= Math.round(segment.fill * segment.ticks) || undefined"
                  :style="{ animationDelay: `${(t - 1) * 80}ms` }"
                />
              </template>
              <span v-else class="forge-welcome__segmentFill" :style="{ width: `${Math.round(segment.fill * 100)}%` }" />
            </span>
          </div>

          <ul class="forge-welcome__chips" aria-label="Your endpoints">
            <li
              v-for="chip in summary.chips"
              :key="chip.name"
              class="forge-welcome__chip"
              :title="chip.detail"
            >
              <span class="forge-welcome__dot" :data-tone="chip.tone" aria-hidden="true" />
              {{ chip.name }} · {{ chip.status }}
            </li>
          </ul>

          <button
            type="button"
            class="forge-welcome__add"
            :disabled="adding"
            title="Find a local model server, or connect a gateway"
            @click="emit('add')"
          >
            <PlusIcon class="forge-welcome__addIcon" />
            {{ adding ? 'Setting up an endpoint…' : 'Add another endpoint' }}
          </button>
        </div>
      </div>

      <div class="forge-welcome__foot">
        <p v-if="adding" class="forge-welcome__caption forge-welcome__caption--hint" role="status">
          <svg class="forge-welcome__captionIcon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
          <span>Answer the prompts at the top of the window.</span>
        </p>
        <p v-else-if="state === 'no-profiles'" class="forge-welcome__caption">
          <LockIcon class="forge-welcome__captionIcon" />
          <span>Keys stay in your OS keychain, never in <code class="forge-welcome__code">settings.json</code>.</span>
        </p>
        <p v-else class="forge-welcome__caption">
          <svg class="forge-welcome__captionIcon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12.5h2M6 12.5V9M9 12.5V6M12 12.5V3" /></svg>
          <span>A check costs one four-token request per model.</span>
        </p>

        <div class="forge-welcome__actions">
          <button
            type="button"
            class="forge-welcome__primary"
            :disabled="primary.busy"
            :aria-busy="primary.busy"
            :title="primary.title"
            @click="onPrimary"
          >
            <svg v-if="primary.busy" class="forge-welcome__spinner" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 2a6 6 0 1 1-6 6" /></svg>
            {{ primary.label }}
          </button>
          <button
            v-if="state === 'none-healthy'"
            type="button"
            class="forge-welcome__secondary"
            title="Open the composer anyway. Sending still works; a model that cannot answer will say so."
            @click="emit('skip')"
          >
            Skip to chat
            <ArrowRightIcon class="forge-welcome__secondaryIcon" />
          </button>
          <button
            v-else
            type="button"
            class="forge-welcome__secondary"
            title="Open a terminal running Forge"
            @click="openTerminal"
          >
            Use the terminal
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ForgeWelcomeArt from './ForgeWelcomeArt.vue';
import ArrowRightIcon from '../forge/icons/ArrowRightIcon.vue';
import LockIcon from '../forge/icons/LockIcon.vue';
import PlusIcon from '../forge/icons/PlusIcon.vue';
import { runHostAction, transport } from '../../core/runtimeTransport';
import type { EndpointHealth } from '../../../../shared/messages';
// Which of the three states the page is in is decided by the gate, not here.
import type { EndpointWelcomeState } from '../../utils/endpointWelcome';
import { welcomeSummary } from '../../utils/welcomeSummary';

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

/** The runtimes the setup flow probes, in the order it lists them (`discover.ts`). */
const PROVIDERS = ['Ollama', 'LM Studio', 'vLLM', 'llama.cpp', 'Jan'] as const;

/** Each name with what follows it in the sentence: ", ", " and ", or nothing. */
const PROVIDER_PARTS = PROVIDERS.map((name, i) => ({
  name,
  after: i < PROVIDERS.length - 2 ? ', ' : i === PROVIDERS.length - 2 ? ' and ' : '',
}));

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
const summary = computed(() => welcomeSummary(endpoints.value));

/** The card's words once endpoints exist; state A has its own. */
const copy = computed(() => {
  if (checking.value) {
    return {
      title: props.state === 'none-healthy' ? 'Checking your endpoints again' : 'Your endpoints are set up',
      lede: 'Forge is asking every model for a four-token reply. The ones that answer reach the model picker.',
    };
  }
  if (props.state === 'unchecked') {
    return {
      title: 'Your endpoints are set up',
      lede: 'Forge has not asked their models to reply yet. Check which ones answer, and only those reach the model picker.',
    };
  }
  return {
    title: 'None of your endpoints answered',
    lede: 'A gateway can be down for a minute, a token can expire, or you may be on another network.',
  };
});

/** The one filled action: setting up in state A, checking once endpoints exist. */
const primary = computed(() => {
  if (props.state === 'no-profiles') {
    return {
      action: 'add' as const,
      busy: !!props.adding,
      // "Setting up your endpoint…" (the mock) does not fit beside "Use the
      // terminal" at a 420px sidebar; the caption above already says what to do.
      label: props.adding ? 'Setting up…' : 'Set up an endpoint',
      title: 'Find a local model server, or connect a gateway',
    };
  }
  return {
    action: 'check' as const,
    busy: checking.value,
    label: checking.value ? 'Checking…' : props.state === 'unchecked' ? 'Check models' : 'Check again',
    title: 'Send every model one four-token request and keep what answers',
  };
});

function onPrimary(): void {
  if (primary.value.action === 'add') emit('add');
  else emit('check');
}

function openTerminal(): void {
  runHostAction('open Forge in the terminal', () =>
    transport.openClaudeInTerminal(undefined, undefined, 'bottom'),
  );
}
</script>

<style scoped>
/* ---------------------------------------------------------------------------
 * The page. Divergence #55 in `docs/forge-design.md`.
 *
 * The ported container paints with `--app-primary-background` and
 * `--app-primary-foreground`; they are re-pointed here, inside this subtree
 * only, at the welcome tokens, so the official rule still does the painting.
 * Sizes are in em off the host's chat font size (13px by default), like the
 * rest of the webview, so the page follows the user's font setting.
 * ------------------------------------------------------------------------ */
.forge-welcome {
  --app-primary-background: var(--forge-welcome-bg);
  --app-primary-foreground: var(--forge-welcome-fg);
  --forge-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
}

/* A column as tall as the panel: the stage at the top, the actions at the foot. */
.forge-welcome__layout {
  box-sizing: border-box;
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  max-width: 460px;
  text-align: left;
  width: 100%;
}

/* ---- The art on its panel, and the card over its foot -------------------- */

.forge-welcome__stage {
  animation: forge-welcome-rise 600ms var(--forge-ease-out) both;
  display: flex;
  flex-direction: column;
}

.forge-welcome__panel {
  background: linear-gradient(
    180deg,
    var(--forge-welcome-panel-top) 0%,
    var(--forge-welcome-panel-mid) 42%,
    var(--forge-welcome-panel-bottom) 100%
  );
  border: 1px solid var(--forge-welcome-panel-border);
  border-radius: 4px;
  padding: 22px 18px 92px;
}

.forge-welcome__card {
  background: var(--forge-welcome-card);
  border: 1px solid var(--forge-welcome-card-border);
  border-radius: 4px;
  box-shadow: var(--forge-welcome-card-shadow);
  display: flex;
  flex-direction: column;
  margin: -76px 14px 0;
  padding: 18px 18px 20px;
  position: relative;
}

.forge-welcome__eyebrow {
  color: var(--forge-welcome-eyebrow);
  font-size: 0.846em;
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 1.4;
  margin: 0;
  text-transform: uppercase;
}

.forge-welcome__headline {
  color: var(--forge-welcome-fg);
  font-size: 1.846em;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.12;
  margin: 10px 0 0;
  text-wrap: balance;
}

.forge-welcome__accent {
  color: var(--forge-welcome-accent-text);
}

.forge-welcome__lede {
  color: var(--forge-welcome-lede);
  font-size: 1.077em;
  line-height: 1.5;
  margin: 10px 0 0;
  text-wrap: pretty;
}

.forge-welcome__code {
  color: var(--forge-welcome-fg);
  font-family: var(--app-monospace-font-family);
  font-size: 0.9em;
}

/* ---- The middle: one statement, or one count ---------------------------- */

.forge-welcome__middle {
  animation: forge-welcome-rise 600ms var(--forge-ease-out) 120ms both;
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  justify-content: center;
  padding: 24px 14px;
}

.forge-welcome__intro {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.forge-welcome__rule {
  background: var(--forge-welcome-rule);
  height: 2px;
  width: 28px;
}

.forge-welcome__statement {
  color: var(--forge-welcome-connector);
  font-size: 1.538em;
  font-weight: 500;
  letter-spacing: -0.015em;
  line-height: 1.4;
  margin: 0;
  text-wrap: pretty;
}

.forge-welcome__name {
  color: var(--forge-welcome-fg);
}

.forge-welcome__summary {
  display: flex;
  flex-direction: column;
}

.forge-welcome__count {
  color: var(--forge-welcome-fg);
  font-size: 3.385em;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1;
  margin: 0;
}

.forge-welcome__count[data-tone='live'] { color: var(--forge-welcome-accent-text); }
.forge-welcome__count[data-tone='dead'] { color: var(--forge-welcome-danger-text); }
.forge-welcome__count[data-tone='ok'] { color: var(--forge-welcome-success-text); }

.forge-welcome__countUnit {
  color: var(--forge-welcome-dim);
}

.forge-welcome__countLabel {
  color: var(--forge-welcome-muted);
  font-size: 1em;
  margin: 6px 0 0;
}

/* One segment per endpoint, 9px apart; inside it, one tick per model 3px apart. */
.forge-welcome__bar {
  display: flex;
  gap: 9px;
  margin-top: 16px;
}

.forge-welcome__segment {
  background: var(--forge-welcome-track);
  border-radius: 1px;
  box-shadow: inset 0 0 0 1px var(--forge-welcome-track-edge);
  flex-basis: 0;
  height: 6px;
  min-width: 6px;
  overflow: hidden;
}

.forge-welcome__segment[data-kind='hollow'] {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--forge-welcome-track-ring);
}

.forge-welcome__segment[data-ticked] {
  background: transparent;
  box-shadow: none;
  display: flex;
  gap: 3px;
}

.forge-welcome__tick {
  background: var(--forge-welcome-track);
  border-radius: 1px;
  box-shadow: inset 0 0 0 1px var(--forge-welcome-track-edge);
  flex: 1 1 0;
  height: 6px;
}

.forge-welcome__segment[data-kind='answered'] .forge-welcome__tick[data-on] {
  background: var(--forge-welcome-fill-ok);
}

/* A check in progress: what is done holds, what is still being asked pulses. */
.forge-welcome__segment[data-kind='live'] .forge-welcome__tick {
  animation: forge-welcome-wait 1.4s ease-in-out infinite;
  background: var(--forge-welcome-fill-live);
}

.forge-welcome__segment[data-kind='live'] .forge-welcome__tick[data-on] {
  animation: none;
  opacity: 1;
}

.forge-welcome__segmentFill {
  display: block;
  height: 100%;
  transition: width 320ms var(--forge-ease-out);
}

.forge-welcome__segment[data-kind='live'] .forge-welcome__segmentFill {
  animation: forge-welcome-pulse 1.4s ease-in-out infinite;
  background: var(--forge-welcome-fill-live);
}

.forge-welcome__segment[data-kind='answered'] .forge-welcome__segmentFill {
  background: var(--forge-welcome-fill-ok);
}

.forge-welcome__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
}

.forge-welcome__chip {
  align-items: center;
  background: var(--forge-welcome-chip);
  border: 1px solid var(--forge-welcome-chip-border);
  border-radius: 9999px;
  color: var(--forge-welcome-chip-text);
  display: flex;
  font-size: 1em;
  gap: 6px;
  padding: 4px 11px;
}

.forge-welcome__dot {
  border-radius: 50%;
  flex: none;
  height: 6px;
  width: 6px;
}

.forge-welcome__dot[data-tone='plain'] { background: var(--forge-welcome-dot-idle); }
.forge-welcome__dot[data-tone='dead'] { background: var(--forge-welcome-dot-dead); }
.forge-welcome__dot[data-tone='ok'] { background: var(--forge-welcome-dot-ok); }
.forge-welcome__dot[data-tone='live'] {
  animation: forge-welcome-pulse 1.4s ease-in-out infinite;
  background: var(--forge-welcome-dot-live);
}

.forge-welcome__add {
  align-items: center;
  align-self: flex-start;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--forge-welcome-accent-text);
  cursor: pointer;
  display: flex;
  font-family: inherit;
  font-size: 1.077em;
  font-weight: 500;
  gap: 8px;
  margin: 14px -6px 0;
  min-height: 32px;
  padding: 0 6px;
}

.forge-welcome__add:hover:not(:disabled) {
  background: var(--forge-welcome-square-hover);
}

.forge-welcome__add:disabled {
  cursor: progress;
  opacity: 0.7;
}

.forge-welcome__addIcon {
  flex: none;
  height: 12px;
  width: 12px;
}

/* ---- The foot: one line of context, then the two actions ---------------- */

.forge-welcome__foot {
  animation: forge-welcome-rise 600ms var(--forge-ease-out) 200ms both;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.forge-welcome__caption {
  align-items: center;
  color: var(--forge-welcome-muted);
  display: flex;
  font-size: 0.923em;
  gap: 8px;
  line-height: 1.45;
  margin: 0;
}

.forge-welcome__caption--hint {
  color: var(--forge-welcome-accent-text);
}

.forge-welcome__captionIcon {
  flex: none;
  height: 13px;
  width: 13px;
}

.forge-welcome__actions {
  align-items: stretch;
  display: flex;
  gap: 10px;
}

.forge-welcome__primary,
.forge-welcome__secondary {
  align-items: center;
  cursor: pointer;
  display: flex;
  font-family: inherit;
  font-size: 1.077em;
  font-weight: 500;
  gap: 10px;
  justify-content: center;
  letter-spacing: -0.01em;
  min-height: 44px;
  transition:
    background-color 160ms var(--forge-ease-out),
    color 160ms var(--forge-ease-out);
  white-space: nowrap;
}

/* The pill: the page's one filled action. */
.forge-welcome__primary {
  background: var(--forge-welcome-pill);
  border: 1px solid var(--forge-welcome-pill-border);
  border-radius: 9999px;
  color: var(--forge-welcome-pill-fg);
  flex: 1 1 auto;
  padding: 0 20px;
}

.forge-welcome__primary:hover:not(:disabled) {
  background: var(--forge-welcome-pill-hover);
}

.forge-welcome__primary:disabled {
  background: var(--forge-welcome-pill-busy);
  cursor: progress;
}

/* The square: its sharp corners against the pill are the pair's rhythm. */
.forge-welcome__secondary {
  background: transparent;
  border: 1px solid var(--forge-welcome-square-border);
  border-radius: 0;
  color: var(--forge-welcome-fg);
  flex: 0 0 auto;
  padding: 0 20px;
}

.forge-welcome__secondary:hover {
  background: var(--forge-welcome-square-hover);
}

.forge-welcome__primary:focus-visible,
.forge-welcome__secondary:focus-visible,
.forge-welcome__add:focus-visible {
  outline: 2px solid var(--forge-welcome-ring);
  outline-offset: 2px;
}

.forge-welcome__secondaryIcon {
  flex: none;
  height: 12px;
  transition: transform 160ms var(--forge-ease-out);
  width: 12px;
}

.forge-welcome__secondary:hover .forge-welcome__secondaryIcon {
  transform: translateX(2px);
}

.forge-welcome__spinner {
  animation: forge-welcome-spin 900ms linear infinite;
  flex: none;
  height: 14px;
  width: 14px;
}

@keyframes forge-welcome-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes forge-welcome-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@keyframes forge-welcome-wait {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.2; }
}

@keyframes forge-welcome-spin {
  to { transform: rotate(360deg); }
}

/* A very narrow panel: the pair stacks rather than squeezing its labels. */
@media (max-width: 300px) {
  .forge-welcome__actions {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .forge-welcome__stage,
  .forge-welcome__middle,
  .forge-welcome__foot,
  .forge-welcome__segment[data-kind='live'] .forge-welcome__segmentFill,
  .forge-welcome__segment[data-kind='live'] .forge-welcome__tick,
  .forge-welcome__dot[data-tone='live'] {
    animation: none;
  }

  .forge-welcome__spinner {
    animation-duration: 2.4s;
  }

  .forge-welcome__primary,
  .forge-welcome__secondary,
  .forge-welcome__segmentFill,
  .forge-welcome__secondaryIcon {
    transition: none;
  }

  .forge-welcome__secondary:hover .forge-welcome__secondaryIcon {
    transform: none;
  }
}
</style>
