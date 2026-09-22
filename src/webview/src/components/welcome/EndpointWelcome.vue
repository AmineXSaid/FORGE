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
  <div class="fg-welcome__container">
    <div class="fg-welcome__baseState">
      <div class="fg-welcome__asciiArtContainer">
        <ForgeWelcomeArt />
      </div>

      <!--
        Two short lines at most. The page is a decision point, not a document:
        every line here is one the reader has to clear before they can act.
      -->
      <template v-if="state === 'none-healthy'">
        <p>Forge asked every model on these endpoints to answer. None did.</p>
      </template>
      <template v-else-if="state === 'unchecked'">
        <p>These endpoints are set up. Forge has not asked their models to answer yet.</p>
      </template>
      <template v-else>
        <p>
          Forge runs the real <code>claude</code> CLI, and it does not have to talk
          to api.anthropic.com.
        </p>
        <p>Where should Forge send your work?</p>
      </template>

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
        <div>
          <button
            class="fg-welcome__fullWidthButton fg-welcome__primary"
            title="Find a local model server, or connect a gateway"
            @click="emit('add')"
          >
            Set up an endpoint
          </button>
          <p v-if="state === 'no-profiles'" class="fg-welcome__noteBeneathButton">
            Ollama, LM Studio, vLLM, llama.cpp and Jan are found for you. Tokens go
            to the OS keychain, never to <code>settings.json</code>.
          </p>
        </div>

        <!--
          The two Forge-only actions, side by side rather than stacked: three
          full-width slabs read as three equal choices, and they are not. One
          sets an endpoint up, the other two are what you do about the one you
          have. The icons carry the difference in kind. "Check health" leads with
          its mark because it acts on the table above; "Skip to chat" trails with
          an arrow because it moves you past the page.
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

        <p v-if="state !== 'no-profiles'" class="fg-welcome__noteBeneathButton">
          A check costs one four-token request per model.
        </p>
      </div>

      <p class="fg-welcome__terminalNote">
        <a class="fg-welcome__terminalLink" href="#" @click.prevent="emit('terminal')">
          Prefer the terminal experience? Run
          <!--
            The official renders a bare `<code>claude</code>`. Forge marks it as
            a prompt: the `$` is the sigil, dimmer than what you type after it,
            inside a hairline box. A new class rather than a scoped override of
            the ported `.fg-welcome__terminalLink code`, which stays as it is.
          -->
          <code class="forge-welcome__command">
            <span class="forge-welcome__sigil" aria-hidden="true">$</span>forge
          </code>
          in terminal
        </a>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ForgeWelcomeArt from './ForgeWelcomeArt.vue';
import SignalIcon from '../forge/icons/SignalIcon.vue';
import ArrowRightIcon from '../forge/icons/ArrowRightIcon.vue';
import type { EndpointHealth } from '../../../../shared/messages';
// Which of the three states the page is in is decided by the gate, not here.
import type { EndpointWelcomeState } from '../../utils/endpointWelcome';

const props = defineProps<{
  state: EndpointWelcomeState;
  /** One row per profile. Empty in state A, where there are none. */
  health?: EndpointHealth[];
}>();

const emit = defineEmits<{
  /** Open the guided "Add endpoint" flow. */
  (e: 'add'): void;
  /** Sweep every profile now. */
  (e: 'check'): void;
  /** Put the gate away and show the composer. */
  (e: 'skip'): void;
  /** The official's terminal line. */
  (e: 'terminal'): void;
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
/*
 * A minimal terminal chip. Forge-only: the official's terminal line is a bare
 * `<code>`, and this is a deliberate divergence recorded in
 * `docs/forge-design.md`.
 */
.forge-welcome__command {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4em;
  border: 1px solid var(--app-transparent-inner-border);
  border-radius: 3px;
  padding: 0.1em 0.45em;
  white-space: nowrap;
}

/* The prompt is furniture, not something you type, so it recedes. */
.forge-welcome__sigil {
  opacity: 0.55;
  user-select: none;
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
