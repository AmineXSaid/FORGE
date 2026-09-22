<template>
  <!--
    What each endpoint's models did when they were actually asked to serve.

    The point of the expandable row is the `detail` column: "0 of 101 healthy"
    is a symptom, and "60 returned 404" or "listed, but accepted the request and
    never answered" is the cause. A table that only reported the count would be
    the same lie the raw `/v1/models` listing tells, one level up.
  -->
  <SettingsSection title="Model health">
    <div class="forge-health">
      <div class="forge-health__intro">
        <p class="forge-health__lede">
          Being listed is not being servable. Forge sends each model one real
          four-token request and keeps what answered. The model picker offers
          those, and only those.
        </p>
        <Button
          variant="secondary"
          size="small"
          :disabled="!rows.length"
          @click="anySyncing ? cancel() : syncAll()"
        >
          {{ anySyncing ? 'Cancel' : 'Sync all' }}
        </Button>
      </div>

      <!-- Empty state 1: nothing to measure. -->
      <p v-if="!rows.length" class="forge-health__empty">
        No endpoint profiles yet. Add one above and Forge will check which of its
        models answer.
      </p>

      <table v-else class="forge-health__table">
        <thead>
          <tr>
            <th class="forge-health__col-name">Endpoint</th>
            <th>Status</th>
            <th class="forge-health__col-num">Healthy</th>
            <th class="forge-health__col-num">Median ping</th>
            <th>Last checked</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in rows" :key="row.profileName">
            <tr class="forge-health__row">
              <td class="forge-health__col-name">
                <button
                  class="forge-health__disclosure"
                  :aria-expanded="expanded === row.profileName"
                  @click="toggle(row.profileName)"
                >
                  <GroupChevronIcon
                    class="forge-health__caret"
                    :class="expanded === row.profileName && 'forge-health__caret--open'"
                  />
                  {{ row.profileName }}
                </button>
                <span v-if="row.active" class="forge-health__active">active</span>
              </td>
              <td>
                <span :class="['forge-health__status', `forge-health__status--${statusOf(row)}`]">
                  <span class="forge-health__dot" aria-hidden="true" />
                  {{ STATUS_LABEL[statusOf(row)] }}
                </span>
              </td>
              <td class="forge-health__col-num">
                <template v-if="row.syncing">{{ row.checked ?? 0 }} / {{ row.total ?? 0 }}</template>
                <template v-else-if="row.lastSyncedAt">
                  <span :class="healthyCount(row) === 0 ? 'forge-health__zero' : undefined">{{ healthyCount(row) }}</span>
                  / {{ row.listed || row.models.length }}
                </template>
                <template v-else><span class="forge-health__nil">·</span></template>
              </td>
              <td class="forge-health__col-num">{{ ping(row) }}</td>
              <td>{{ row.lastSyncedAt ? `${formatRelativeTime(row.lastSyncedAt)} ago` : 'never' }}</td>
              <td class="forge-health__col-action">
                <Button
                  variant="secondary"
                  size="small"
                  @click="row.syncing ? cancel(row.profileName) : sync(row.profileName)"
                >
                  {{ row.syncing ? 'Cancel' : 'Sync' }}
                </Button>
              </td>
            </tr>

            <tr v-if="row.error" class="forge-health__row forge-health__row--note">
              <td colspan="6">
                <!--
                  A sweep that could not start, beside the verdicts it could not
                  replace. The two are different statements: "I could not ask"
                  does not retract "these answered an hour ago".
                -->
                <span class="forge-health__error">Last sweep could not run. {{ row.error }}</span>
              </td>
            </tr>

            <tr v-if="expanded === row.profileName" class="forge-health__row forge-health__row--detail">
              <td colspan="6">
                <!-- Empty state 2: profiles, never swept. -->
                <p v-if="!row.lastSyncedAt" class="forge-health__empty">
                  Not checked yet. <strong>Sync</strong> sends one small request per model,
                  {{ CANDIDATE_CAP }} at most, the ones this profile names first.
                </p>

                <!-- Empty state 3: swept, and nothing answered. The loud one. -->
                <div v-else-if="healthyCount(row) === 0" class="forge-health__alarm">
                  <p class="forge-health__alarm-title">
                    Nothing answered on “{{ row.profileName }}”.
                  </p>
                  <p v-if="commonest(row)" class="forge-health__alarm-why">
                    Most models said: <code>{{ commonest(row) }}</code>
                  </p>
                  <p class="forge-health__alarm-why">
                    {{ row.models.length }} of {{ row.listed || row.models.length }} listed models were
                    checked. Nothing is offered in the picker while this is true.
                  </p>
                </div>

                <table v-if="row.models.length" class="forge-health__models">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th class="forge-health__col-num">Answered</th>
                      <th class="forge-health__col-num">Ping</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="model in row.models" :key="model.id">
                      <td><code>{{ model.id }}</code></td>
                      <td class="forge-health__col-num">
                        <!--
                          Drawn glyphs from the library the official webview
                          draws from, not a tick and a cross typed as text: a
                          Unicode stand-in inherits the reader's emoji font and
                          renders at a weight nothing else on the page uses.
                        -->
                        <CheckIcon v-if="model.servable" class="forge-health__verdict forge-health__yes" />
                        <CloseIcon v-else class="forge-health__verdict forge-health__no" />
                        <span class="forge-health__srOnly">{{ model.servable ? 'answered' : 'did not answer' }}</span>
                      </td>
                      <td class="forge-health__col-num">
                        <template v-if="model.servable">{{ model.ms }} ms</template>
                        <template v-else><span class="forge-health__nil">·</span></template>
                      </td>
                      <td class="forge-health__detail">{{ model.detail ?? '' }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * Forge-only. The official extension has no endpoint concept, so there is no
 * table in `index.js` to port; this is built from the Settings page's own
 * `SettingsSection` idiom rather than invented alongside it.
 *
 * Every host call goes through `runHostAction`, which is rule B4's webview
 * half: a row whose request the host rejects must say so, not sit there looking
 * pressed. A VSIX carrying a stale `extension.cjs` is exactly how that was
 * found the first time.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import SettingsSection from './SettingsSection.vue';
import Button from '../Common/Button.vue';
import CheckIcon from '../forge/icons/CheckIcon.vue';
import CloseIcon from '../forge/icons/CloseIcon.vue';
import GroupChevronIcon from '../forge/icons/GroupChevronIcon.vue';
import type { EndpointHealth } from '../../../../shared/messages';
import { transport, runHostAction } from '../../core/runtimeTransport';
import { formatRelativeTime } from '../../utils/relativeTime';

/** Mirrors `DEFAULT_CANDIDATE_CAP` in `services/endpoints/health.ts`. */
const CANDIDATE_CAP = 60;

type Status = 'alive' | 'unreachable' | 'unchecked';

const STATUS_LABEL: Record<Status, string> = {
  alive: 'alive',
  unreachable: 'unreachable',
  unchecked: 'never checked',
};

/**
 * The host's pushed feed, so a sweep started here updates the welcome page
 * behind this tab, and a sweep on the timer fills this table in without a
 * reload. `undefined` until the host answers.
 */
const pushed = useSignal(transport.endpointHealth);
const fetched = ref<EndpointHealth[] | undefined>(undefined);

const rows = computed<EndpointHealth[]>(() => pushed.value ?? fetched.value ?? []);
const anySyncing = computed(() => rows.value.some((r) => r.syncing));

const expanded = ref<string | undefined>(undefined);
function toggle(name: string): void {
  expanded.value = expanded.value === name ? undefined : name;
}

function healthyCount(row: EndpointHealth): number {
  return row.models.filter((m) => m.servable).length;
}

/** Median over the models that answered; a failed probe's time means nothing. */
function ping(row: EndpointHealth): string {
  const times = row.models.filter((m) => m.servable).map((m) => m.ms).sort((a, b) => a - b);
  // A middot rather than a dash: the cell has no value, and a dash in a column
  // of numbers reads as a minus sign.
  if (!times.length) return '·';
  const mid = Math.floor(times.length / 2);
  const value = times.length % 2 ? times[mid] : Math.round((times[mid - 1] + times[mid]) / 2);
  return `${value} ms`;
}

/** The failure most models gave, which is the thing the user can act on. */
function commonest(row: EndpointHealth): string | undefined {
  const counts = new Map<string, number>();
  for (const model of row.models) {
    if (model.servable || !model.detail) continue;
    counts.set(model.detail, (counts.get(model.detail) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [detail, count] of counts) if (count > bestCount) { best = detail; bestCount = count; }
  return best;
}

function statusOf(row: EndpointHealth): Status {
  if (!row.lastSyncedAt) return 'unchecked';
  if (row.error || healthyCount(row) === 0) return 'unreachable';
  return 'alive';
}

function refresh(): void {
  runHostAction('read the endpoint health', async () => {
    const response = await transport.getEndpointHealth();
    fetched.value = response.health;
  });
}

function sync(profileName?: string): void {
  runHostAction(
    profileName ? `check “${profileName}”` : 'check the endpoints',
    async () => {
      const response = await transport.syncEndpointHealth(profileName);
      fetched.value = response.health;
    },
  );
}

const syncAll = (): void => sync(undefined);

function cancel(profileName?: string): void {
  runHostAction('cancel the health check', async () => {
    const response = await transport.syncEndpointHealth(profileName, true);
    fetched.value = response.health;
  });
}

/**
 * A slow poll, and only while a sweep is running.
 *
 * The push is the primary feed; this is the belt that survives a webview which
 * reloaded mid-sweep and so missed the pushes that had already gone out.
 */
let poll: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  refresh();
  poll = setInterval(() => { if (anySyncing.value) refresh(); }, 1500);
});
onUnmounted(() => { if (poll) clearInterval(poll); });
</script>

<style scoped>
.forge-health {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.forge-health__intro {
  align-items: flex-end;
  display: flex;
  gap: 12px;
  padding: 0 12px;
}

.forge-health__lede {
  color: var(--cursor-text-secondary);
  flex: 1 1 0;
  font-size: 12px;
  line-height: 16px;
  margin: 0;
}

.forge-health__table,
.forge-health__models {
  border-collapse: collapse;
  font-size: 12px;
  line-height: 16px;
  table-layout: auto;
  width: 100%;
}

/*
 * Column headings are labels, so they read as labels: small, wide-tracked and
 * recessive, with a rule under them. They name the unit, which is the one thing
 * a bare count cannot do for itself.
 */
.forge-health__table thead th,
.forge-health__models thead th {
  border-bottom: 1px solid var(--cursor-stroke-tertiary);
  color: var(--cursor-text-tertiary);
  font-size: 0.85em;
  font-weight: 500;
  letter-spacing: 0.06em;
  padding: 0 8px 4px;
  text-align: left;
  text-transform: uppercase;
}

.forge-health__table td,
.forge-health__models td {
  border-top: 1px solid var(--cursor-stroke-tertiary);
  color: var(--cursor-text-primary);
  padding: 6px 8px;
  vertical-align: top;
}

/* Compared down the column, so tabular figures: the browser default wobbles. */
.forge-health__col-num {
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

/* An absent value, not a minus sign. */
.forge-health__nil {
  color: var(--cursor-text-tertiary);
  opacity: 0.6;
}

.forge-health__col-action {
  text-align: right;
  width: 1%;
}

.forge-health__col-name {
  word-break: break-all;
}

/* A row label that opens the per-model table. A button, so it is reachable. */
.forge-health__disclosure {
  all: unset;
  color: var(--cursor-text-primary);
  cursor: pointer;
  display: inline-flex;
  gap: 4px;
}

.forge-health__disclosure:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
}

/*
 * The sessions list's own chevron: it points right and rotates 90° when open,
 * exactly as `.fg-sessions__groupChevron` does, so a disclosure means the same
 * thing in both places.
 */
.forge-health__caret {
  color: var(--cursor-text-tertiary);
  flex: none;
  height: 12px;
  transition: transform 120ms ease-out;
  width: 12px;
}

.forge-health__caret--open {
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
  .forge-health__caret {
    transition: none;
  }
}

/* The verdict glyphs, at the same optical size as the text beside them. */
.forge-health__verdict {
  height: 13px;
  vertical-align: -2px;
  width: 13px;
}

/*
 * A tick alone is a shape. Screen readers get the word, sighted readers get the
 * column heading; neither has to infer it.
 */
.forge-health__srOnly {
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

/* Status reads as a dot plus a word, the same pairing the sessions list uses. */
.forge-health__status {
  align-items: center;
  display: inline-flex;
  gap: 6px;
}

.forge-health__dot {
  background: currentColor;
  border-radius: 50%;
  flex: none;
  height: 6px;
  width: 6px;
}

.forge-health__status--alive .forge-health__dot {
  box-shadow: 0 0 0 3px var(--forge-success-surface);
}

.forge-health__status--unreachable .forge-health__dot {
  box-shadow: 0 0 0 3px var(--forge-danger-surface);
}

.forge-health__status--unchecked .forge-health__dot {
  opacity: 0.5;
}

.forge-health__active {
  color: var(--cursor-text-tertiary);
  margin-left: 6px;
}

.forge-health__status--alive { color: var(--forge-success); }
.forge-health__status--unreachable { color: var(--forge-danger); }
.forge-health__status--unchecked { color: var(--cursor-text-tertiary); }

.forge-health__yes { color: var(--forge-success); }
.forge-health__no,
.forge-health__zero,
.forge-health__error { color: var(--forge-danger); }

.forge-health__row--note td,
.forge-health__row--detail td {
  border-top: 0;
}

.forge-health__row--detail > td {
  padding-bottom: 12px;
}

.forge-health__empty {
  color: var(--cursor-text-secondary);
  font-size: 12px;
  line-height: 16px;
  margin: 0;
  padding: 8px 12px;
}

/*
 * The zero-healthy state is loud on purpose: an empty table reads as "nothing
 * to report", and the one thing it must not read as is that.
 */
.forge-health__alarm {
  background-color: var(--forge-danger-surface);
  border: 1px solid var(--forge-danger-border);
  border-radius: 6px;
  margin-bottom: 8px;
  padding: 8px 10px;
}

.forge-health__alarm-title {
  color: var(--cursor-text-primary);
  margin: 0 0 4px;
}

.forge-health__alarm-why {
  color: var(--cursor-text-secondary);
  margin: 0;
}

.forge-health__detail {
  color: var(--cursor-text-secondary);
  word-break: break-word;
}
</style>
