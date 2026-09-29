<template>
  <!--
    The official command menu behind the composer's "/" button (reference `TV0`,
    modules G_S7FQ + 90gk3A).

    Structure, copy, section order and per-item behaviour come from the official
    command registry (`registerAction({ id, label, description, trailingComponent,
    keepMenuOpen, filterOnly }, section, handler)`):
      - sections render in the official order Context, Model, Customize, Settings,
        Slash Commands, Support, MCP servers; "Slash Commands" and `filterOnly`
        rows appear only while filtering;
      - a row with `keepMenuOpen` (toggles, effort) leaves the menu open;
      - the version row sits under the list and hides while filtering.

    The official only registers an action when the host can perform it (effort is
    unregistered for models without effort support, remote control only exists
    when it is available). Forge follows the same rule: the parent passes the
    actions Forge can actually carry out, so every row here does something.
  -->
  <div ref="popupEl" class="fg-commandmenu__menuPopup">
    <input
      ref="filterEl"
      v-model="filter"
      type="text"
      placeholder="Filter actions…"
      class="fg-filter__filterInput"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded="true"
      :aria-controls="listboxId"
      :aria-activedescendant="activeOptionId"
      @keydown="onKeyDown"
    />
    <div class="fg-commandmenu__commandList">
      <div :id="listboxId" role="listbox" aria-label="Actions" class="fg-commandmenu__listbox">
        <div
          v-if="!sections.length"
          class="fg-commandmenu__emptyState"
          role="option"
          aria-disabled="true"
          aria-selected="false"
        >
          No matching commands
        </div>
        <div
          v-for="(section, si) in sections"
          v-else
          :key="section.name"
          role="group"
          :aria-labelledby="`${listboxId}-section-${si}`"
        >
          <div v-if="si > 0" class="fg-commandmenu__sectionDivider" aria-hidden="true"></div>
          <div :id="`${listboxId}-section-${si}`" class="fg-commandmenu__sectionHeader" role="presentation">
            {{ section.name }}
          </div>
          <div
            v-for="cmd in section.commands"
            :id="optionId(cmd.id)"
            :key="cmd.id"
            :ref="(el) => { if (cmd.id === activeId) activeEl = el as HTMLElement }"
            role="option"
            :aria-selected="cmd.id === activeId"
            class="fg-commandmenu__commandItem"
            :class="{ 'fg-commandmenu__activeCommandItem': cmd.id === activeId }"
            :title="cmd.description"
            @mousemove="activeId = cmd.id"
            @click="run(cmd, false)"
          >
            <div class="fg-commandmenu__commandContent">
              <span class="fg-commandmenu__commandLabel"
                >{{ cmd.label
                }}<span v-if="cmd.labelSuffix" style="color: var(--app-secondary-foreground); margin-left: 4px">(<span :class="effortToneClass(cmd.effortLevel, cmd.ultracodeSelected)">{{ cmd.labelSuffix }}</span>)</span></span
              >
            </div>
            <span v-if="cmd.trailing === 'text'" class="fg-composer__modelIndicator">{{ cmd.trailingText }}</span>
            <ToggleSwitch v-else-if="cmd.trailing === 'toggle'" :is-on="!!cmd.isOn" />
            <EffortSlider
              v-else-if="cmd.trailing === 'effort'"
              :level="cmd.effortLevel"
              :levels="cmd.effortLevels ?? []"
              :show-ultracode="!!cmd.showUltracode"
              :ultracode-selected="!!cmd.ultracodeSelected"
              @select="(level) => emit('effort', level)"
              @select-ultracode="emit('ultracode')"
            />
            <TerminalIcon v-else-if="cmd.trailing === 'terminal'" class="fg-termicon__icon" :width="24" :height="24" />
          </div>
        </div>
      </div>
      <!--
        The official row is [Report a problem, version], the button opening its
        feedback dialog (`openFeedbackDialog("command_menu")`). Feedback is out
        of scope for Forge (CLAUDE.md); the button Forge had opened the log
        channel, which is not what the official one does, and its only other
        implementation was the `command:` allow-list step 32 deleted -- so the
        row keeps the version text alone. The ported `versionRow` rule is
        untouched: with one child its `space-between` simply leaves the text at
        the start, and overriding a ported rule to move it is the trap rule 4
        describes.
      -->
      <div v-if="!filtering" class="fg-commandmenu__versionRow">
        <span class="fg-commandmenu__versionText">v{{ version }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import ToggleSwitch from './ToggleSwitch.vue';
import EffortSlider from './EffortSlider.vue';
import { effortToneClass } from './effort';
import TerminalIcon from './icons/TerminalIcon.vue';

export interface MenuCommand {
  id: string;
  label: string;
  description: string;
  section: 'Context' | 'Model' | 'Customize' | 'Settings' | 'Slash Commands' | 'Support' | 'MCP servers';
  /** Leave the menu open after running (toggles and the effort row). */
  keepMenuOpen?: boolean;
  /** Only offered while the filter has text, e.g. "New conversation". */
  filterOnly?: boolean;
  labelSuffix?: string;
  trailing?: 'text' | 'toggle' | 'effort' | 'terminal';
  trailingText?: string;
  isOn?: boolean;
  effortLevel?: string;
  effortLevels?: readonly string[];
  /** The slider's extra Ultracode notch (the official `showUltracode`). */
  showUltracode?: boolean;
  /** Ultracode is on (the official `ultracodeSelected`). */
  ultracodeSelected?: boolean;
}

const props = defineProps<{ commands: MenuCommand[]; version: string }>();
const emit = defineEmits<{
  /** `viaTab`: chosen with Tab rather than click/Enter (the official `KZ` second argument). */
  (e: 'run', id: string, viaTab: boolean): void;
  (e: 'effort', level: string): void;
  /** The slider's Ultracode notch (the official `onSelectUltracode`). */
  (e: 'ultracode'): void;
  (e: 'close'): void;
}>();

/** The official section order (its `zM0`). */
const ORDER = ['Context', 'Model', 'Customize', 'Settings', 'Slash Commands', 'Support', 'MCP servers'] as const;
/** Hidden unless the query is being filtered, like the official's `s65`. */
const FILTER_ONLY_SECTIONS = new Set(['Slash Commands']);

const filter = ref('');
const filterEl = ref<HTMLInputElement | null>(null);
const popupEl = ref<HTMLElement | null>(null);
const activeId = ref<string | null>(null);
let activeEl = null as HTMLElement | null;
const uid = Math.random().toString(36).slice(2, 8);
const listboxId = `forge-command-listbox-${uid}`;
const optionId = (id: string) => `${listboxId}-option-${id}`;

const query = computed(() => filter.value.trim().toLowerCase().replace(/^\//, ''));
const filtering = computed(() => query.value.length > 0);
/** Official `n65`: a filter starting with "/" shows the Slash Commands section even before a query. */
const slashPrefixed = computed(() => filter.value.toLowerCase().startsWith('/'));

/** Exact label first, then prefix, then anywhere in label, id or description. */
function rank(cmd: MenuCommand): number {
  const q = query.value;
  const label = cmd.label.toLowerCase().replace(/^\//, '');
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (label.includes(q) || cmd.id.toLowerCase().includes(q)) return 2;
  if (cmd.description.toLowerCase().includes(q)) return 3;
  return -1;
}

const sections = computed(() =>
  ORDER.map((name) => {
    let list = props.commands.filter((c) => c.section === name);
    if (!filtering.value) {
      if (FILTER_ONLY_SECTIONS.has(name) && !slashPrefixed.value) return { name, commands: [] as MenuCommand[] };
      list = list.filter((c) => !c.filterOnly);
    } else {
      list = list
        .map((c) => ({ c, r: rank(c) }))
        .filter((x) => x.r >= 0)
        .sort((a, b) => a.r - b.r)
        .map((x) => x.c);
    }
    return { name, commands: list };
  }).filter((s) => s.commands.length > 0)
);

const flat = computed(() => sections.value.flatMap((s) => s.commands));
const activeOptionId = computed(() => (activeId.value ? optionId(activeId.value) : undefined));

// Filtering selects the best match; clearing the filter clears the selection.
watch(filtering, (on) => {
  if (!on) activeId.value = null;
});
watch(flat, (rows) => {
  if (!filtering.value) return;
  if (!rows.some((r) => r.id === activeId.value)) activeId.value = rows[0]?.id ?? null;
});

function run(cmd: MenuCommand, viaTab: boolean): void {
  emit('run', cmd.id, viaTab);
  if (!cmd.keepMenuOpen) {
    filter.value = '';
    emit('close');
  }
}

function move(step: 1 | -1): void {
  const rows = flat.value;
  if (!rows.length) return;
  const at = rows.findIndex((r) => r.id === activeId.value);
  const next = at === -1 ? (step === 1 ? 0 : rows.length - 1) : (at + step + rows.length) % rows.length;
  activeId.value = rows[next].id;
  void nextTick(() => activeEl?.scrollIntoView({ block: 'nearest' }));
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
  else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
    // Official `TV0`: Tab and Enter both choose the active row; Tab is passed on.
    if (event.isComposing) return;
    event.preventDefault();
    const cmd = flat.value.find((r) => r.id === activeId.value);
    if (cmd) run(cmd, event.key === 'Tab');
  } else if (event.key === 'Escape') { event.preventDefault(); emit('close'); }
}

function onMouseDown(event: MouseEvent): void {
  if (!popupEl.value?.contains(event.target as Node)) emit('close');
}

onMounted(() => {
  filterEl.value?.focus();
  // Deferred so the click that opened the menu does not immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onMouseDown), 0);
});
onUnmounted(() => document.removeEventListener('mousedown', onMouseDown));
</script>
