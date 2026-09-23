<template>
  <!--
    The official "Permission rules" dialog (`kU0`, reference module 0Reg3g),
    opened from "/" → Permissions. Markup and copy are the bundle's, piece for
    piece: the list (`f45`), one section per behavior (`y45`), the workspace
    directories (`x45`), the remove confirmation (`C45`) and the add form
    (`S45`). Styles come from styles/official/permissionrules.css only.
  -->
  <ForgeDialog title="Permission rules" :on-close="onClose">
    <div v-if="!state && !loadError" class="fg-permissionrules__loadingText">Loading permission rules…</div>
    <div v-if="loadError" class="fg-permissionrules__errorMessage">Couldn’t load permission rules from this session:{{ ' ' }}{{ escapeRuleText(loadError) }}</div>

    <!-- C45: confirm a removal -->
    <div v-if="state && removing" class="fg-permissionrules__overlayPanel">
      <div class="fg-permissionrules__overlayTitle">Remove {{ removing.behavior }} rule?</div>
      <div class="fg-permissionrules__confirmRule">
        <span class="fg-permissionrules__ruleText">{{ escapeRuleText(removing.rule) }}</span>
        <span v-if="removing.description" class="fg-permissionrules__ruleDescription"
          >{{ escapeText(removing.description.prefix)
          }}<strong v-if="removing.description.emphasis !== undefined">{{ escapeRuleText(removing.description.emphasis) }}</strong
          >{{ removing.description.suffix !== undefined ? escapeText(removing.description.suffix) : '' }}</span
        >
        <span class="fg-permissionrules__ruleSource">From {{ escapeRuleText(sourceLabel(removing.source)) }}</span>
      </div>
      <p class="fg-permissionrules__overlayNote">The rule is deleted from its settings file and stops applying to this session once Claude Code has re-read its settings.</p>
      <div v-if="actionError" class="fg-permissionrules__errorMessage">Couldn’t remove the rule: {{ escapeRuleText(actionError) }}</div>
      <div class="fg-permissionrules__overlayButtons">
        <button type="button" class="fg-dialogbutton__button fg-dialogbutton__primary" @click="busy ? undefined : confirmRemove()">
          {{ busy ? 'Removing…' : 'Remove rule' }}
        </button>
        <button type="button" class="fg-dialogbutton__button" @click="busy ? undefined : cancelRemove()">Cancel</button>
      </div>
    </div>

    <!-- S45: add a rule -->
    <div v-if="state && !removing && adding" class="fg-permissionrules__overlayPanel">
      <div class="fg-permissionrules__overlayTitle">Add {{ BEHAVIOR_LABELS[adding].toLowerCase() }} rule</div>
      <p class="fg-permissionrules__overlayNote">A permission rule is a tool name, optionally followed by a specifier in parentheses, e.g. <code>WebFetch</code> or <code>Bash(ls *)</code>.</p>
      <input
        ref="ruleInputEl"
        v-model="draftRule"
        type="text"
        class="fg-permissionrules__ruleInput"
        placeholder="Enter permission rule…"
        @keydown="handleRuleKeyDown"
      />
      <label class="fg-permissionrules__destinationRow">
        <span>Save for</span>
        <select v-model="draftDestination" class="fg-permissionrules__destinationSelect">
          <option v-for="option in ADD_RULE_DESTINATIONS" :key="option" :value="option" :title="DESTINATION_TITLES[option]">{{ DESTINATION_LABELS[option] }}</option>
        </select>
      </label>
      <div v-if="actionError" class="fg-permissionrules__errorMessage">Couldn’t add the rule: {{ escapeRuleText(actionError) }}</div>
      <div class="fg-permissionrules__overlayButtons">
        <button type="button" class="fg-dialogbutton__button fg-dialogbutton__primary" @click="busy ? undefined : submitAdd()">
          {{ busy ? 'Adding…' : 'Add rule' }}
        </button>
        <button type="button" class="fg-dialogbutton__button" @click="busy ? undefined : cancelAdd()">Cancel</button>
      </div>
    </div>

    <!-- f45: the list -->
    <template v-if="state && !removing && !adding">
      <div v-if="(state.errors ?? []).length > 0" class="fg-permissionrules__errorMessage">
        <div v-for="(error, index) in state.errors ?? []" :key="index">Settings file failed to load:{{ ' ' }}{{ escapeRuleText(error.file ?? 'unknown') }} ({{ escapeRuleText(error.message) }}). Its settings, including permission rules, are not in effect.</div>
      </div>
      <div v-if="someNotInEffect" class="fg-permissionrules__managedNotice">Enterprise managed settings allow only managed permission rules. Rules from other settings files are shown below but are not in effect.</div>
      <div v-if="addNotes.length > 0 || pendingNotice !== null" class="fg-permissionrules__warningMessage">
        <div v-for="(note, index) in addNotes" :key="`note-${index}`">{{ escapeRuleText(note) }}</div>
        <div v-if="pendingNotice !== null">{{ pendingNotice }}</div>
      </div>
      <div v-if="isEmpty" class="fg-permissionrules__emptyState">
        <p>No permission rules are saved.</p>
        <p v-if="!state.managedOnly" class="fg-permissionrules__hint">Choosing an “Always” option on a permission prompt saves a rule here{{ canEdit ? ', or add one below' : '' }}.</p>
      </div>

      <!-- y45: one section per behavior -->
      <template v-for="behavior in BEHAVIORS" :key="behavior">
        <div v-if="groups[behavior].length > 0 || canEdit">
          <div class="fg-permissionrules__sectionHeading">
            <span>{{ BEHAVIOR_LABELS[behavior] }} ({{ groups[behavior].length }})</span>
            <button v-if="canEdit" type="button" class="fg-permissionrules__addRuleButton" @click="startAdd(behavior)">Add rule…</button>
          </div>
          <div
            v-for="(entry, index) in groups[behavior]"
            :key="index"
            :class="['fg-permissionrules__ruleItem', entry.notInEffect ? 'fg-permissionrules__notInEffect' : '']"
          >
            <span class="fg-permissionrules__ruleMain">
              <span class="fg-permissionrules__ruleText">{{ escapeRuleText(entry.rule) }}</span>
              <span v-if="entry.description" class="fg-permissionrules__ruleDescription"
                >{{ escapeText(entry.description.prefix)
                }}<strong v-if="entry.description.emphasis !== undefined">{{ escapeRuleText(entry.description.emphasis) }}</strong
                >{{ entry.description.suffix !== undefined ? escapeText(entry.description.suffix) : '' }}</span
              >
              <span v-if="canEdit && readOnlyReason(entry) !== null" class="fg-permissionrules__readOnlyReason">{{
                readOnlyReason(entry)
              }}</span>
            </span>
            <span class="fg-permissionrules__ruleActions">
              <span class="fg-permissionrules__ruleSource">{{ ruleSourceText(entry) }}</span>
              <button v-if="canRemove(entry, canEdit)" type="button" class="fg-permissionrules__removeButton" @click="startRemove(entry)">Remove</button>
            </span>
          </div>
        </div>
      </template>

      <!-- x45: workspace directories -->
      <div>
        <div class="fg-permissionrules__sectionHeading">
          <span>Workspace ({{ state.workspaceDirectories.length + 1 }})</span>
        </div>
        <div class="fg-permissionrules__ruleItem">
          <span class="fg-permissionrules__ruleText">{{ escapeRuleText(state.originalCwd) }}</span>
          <span class="fg-permissionrules__ruleSource">Original working directory</span>
        </div>
        <div v-for="(directory, index) in state.workspaceDirectories" :key="index" class="fg-permissionrules__ruleItem">
          <span class="fg-permissionrules__ruleText">{{ escapeRuleText(directory.path) }}</span>
          <span class="fg-permissionrules__ruleSource">From {{ escapeRuleText(sourceLabel(directory.source)) }}</span>
        </div>
      </div>
    </template>

    <p class="fg-permissionrules__scopeNote">Rules and workspace directories come from the running session, including approvals made for this session only and rules set when the session started.{{ ' ' }}{{ canEdit ? 'Rules you add or remove here are written to the settings file you choose. ' : '' }}Workspace directories are listed here for reference.</p>
  </ForgeDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PermissionBehavior, SDKControlPermissionRulesState, SDKPermissionRuleEntry } from '@anthropic-ai/claude-agent-sdk';
import type {
  AddPermissionRulesResponse,
  EditableRuleDestination,
  ListPermissionRulesResponse,
  RemovePermissionRuleResponse,
} from '../../../shared/messages';
import ForgeDialog from './forge/ForgeDialog.vue';
import { DESTINATION_LABELS, DESTINATION_TITLES, rememberDestination } from '../core/permissionPrompt';
import {
  ADD_RULE_DESTINATIONS,
  BEHAVIORS,
  BEHAVIOR_LABELS,
  canRemove,
  escapeRuleText,
  escapeText,
  groupByBehavior,
  initialAddDestination,
  isEditableSource,
  readOnlyReason,
  removedPendingNotice,
  ruleSourceText,
  savedPendingNotice,
  sourceLabel,
} from '../core/permissionRules';

/** What the dialog needs from the session (the official passes the session itself). */
export interface PermissionRulesSession {
  listPermissionRules(): Promise<ListPermissionRulesResponse>;
  addPermissionRules(rules: string[], behavior: PermissionBehavior, destination: EditableRuleDestination): Promise<AddPermissionRulesResponse>;
  removePermissionRule(rule: string, behavior: PermissionBehavior, source: EditableRuleDestination): Promise<RemovePermissionRuleResponse>;
}

const props = defineProps<{ session: PermissionRulesSession; onClose: () => void }>();

/** `Z`: the listed state. */
const state = ref<SDKControlPermissionRulesState | null>(null);
/** `X`: why the first listing failed. */
const loadError = ref<string | null>(null);
/** `G`: the rule waiting for its removal to be confirmed. */
const removing = ref<SDKPermissionRuleEntry | null>(null);
/** `q`: the behavior a rule is being added under. */
const adding = ref<PermissionBehavior | null>(null);
/** `V`: the CLI's notes on the rules it just stored. */
const addNotes = ref<string[]>([]);
/** `W`: written but not listed yet. */
const pendingNotice = ref<string | null>(null);
/** `K`: an add or remove is in flight. */
const busy = ref(false);
/** `j`: why the last add or remove failed. */
const actionError = ref<string | null>(null);

// S45's own state: the rule being typed and where it goes.
const draftRule = ref('');
const draftDestination = ref<EditableRuleDestination>(initialAddDestination());
const ruleInputEl = ref<HTMLInputElement | null>(null);

let closed = false;
onBeforeUnmount(() => {
  closed = true;
});

/** The session is always local in Forge (`isRemote` is the official's other case). */
const canEdit = computed(() => state.value !== null && !state.value.managedOnly);

const groups = computed(() =>
  state.value ? groupByBehavior(state.value) : { allow: [], ask: [], deny: [] } as Record<PermissionBehavior, SDKPermissionRuleEntry[]>
);
const isEmpty = computed(
  () => !!state.value && BEHAVIORS.every((b) => groups.value[b].length === 0) && state.value.workspaceDirectories.length === 0
);
const someNotInEffect = computed(() => BEHAVIORS.some((b) => groups.value[b].some((entry) => entry.notInEffect)));

onMounted(() => {
  props.session
    .listPermissionRules()
    .then((response) => {
      if (closed) return;
      if (response.state) state.value = response.state;
      else loadError.value = response.error ?? 'unknown error';
    })
    .catch((error: unknown) => {
      if (!closed) loadError.value = error instanceof Error ? error.message : String(error);
    });
});

/** `N`: list again after a failed change, keeping what is shown if that fails too. */
function refresh(): void {
  props.session
    .listPermissionRules()
    .then((response) => {
      if (!closed && response.state) state.value = response.state;
    })
    .catch(() => {});
}

function startRemove(entry: SDKPermissionRuleEntry): void {
  actionError.value = null;
  pendingNotice.value = null;
  removing.value = entry;
}

function cancelRemove(): void {
  removing.value = null;
  actionError.value = null;
}

/** `O`: remove the confirmed rule from its settings file. */
function confirmRemove(): void {
  const entry = removing.value;
  if (!entry || busy.value || !isEditableSource(entry.source)) return;
  busy.value = true;
  actionError.value = null;
  props.session
    .removePermissionRule(entry.rule, entry.behavior, entry.source)
    .then((response) => {
      if (closed) return;
      busy.value = false;
      if (response.state) {
        state.value = response.state;
        removing.value = null;
        addNotes.value = [];
        pendingNotice.value = response.pending ? removedPendingNotice(entry.source) : null;
      } else {
        actionError.value = response.error ?? 'unknown error';
        refresh();
      }
    })
    .catch((error: unknown) => {
      if (closed) return;
      busy.value = false;
      actionError.value = error instanceof Error ? error.message : String(error);
      refresh();
    });
}

function startAdd(behavior: PermissionBehavior): void {
  actionError.value = null;
  addNotes.value = [];
  pendingNotice.value = null;
  draftRule.value = '';
  draftDestination.value = initialAddDestination();
  adding.value = behavior;
}

function cancelAdd(): void {
  adding.value = null;
  actionError.value = null;
}

/** `U` in `S45`, then `_` in `kU0`: remember the destination and add the one rule. */
function submitAdd(): void {
  const rule = draftRule.value.trim();
  const behavior = adding.value;
  if (rule.length === 0 || busy.value || !behavior) return;
  const destination = draftDestination.value;
  rememberDestination(destination);
  busy.value = true;
  actionError.value = null;
  props.session
    .addPermissionRules([rule], behavior, destination)
    .then((response) => {
      if (closed) return;
      busy.value = false;
      if (response.state) {
        state.value = response.state;
        addNotes.value = response.warnings ?? [];
        pendingNotice.value = response.pending ? savedPendingNotice(destination, behavior) : null;
        adding.value = null;
      } else {
        actionError.value = response.error ?? 'unknown error';
        refresh();
      }
    })
    .catch((error: unknown) => {
      if (closed) return;
      busy.value = false;
      actionError.value = error instanceof Error ? error.message : String(error);
      refresh();
    });
}

function handleRuleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.isComposing) submitAdd();
}

/** The add form's input is `autoFocus`. */
watch(adding, async (behavior) => {
  if (!behavior) return;
  await nextTick();
  ruleInputEl.value?.focus();
});
</script>
