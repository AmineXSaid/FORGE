<template>
  <!--
    The official output-style picker (`DH0`, reference module GCcFcA), element
    for element:

      div.menuPopup
        div.styleList (role listbox, id "output-style-list")
          div.emptyState            while `availableStyles` is undefined
          div.emptyState            when it is empty
          <>                        otherwise
            div.sectionHeader       "Select an output style"
            div.styleItem[.activeStyleItem] (role option, aria-selected)
              span.styleLabel
              div.checkIcon          the tick on the current style
        div.buildRowSection          only once the list has loaded
          button.styleItem.navRow[.activeStyleItem]
            span.styleLabel  "Build a custom style"
            span.navChevron  ">"

    The popup keeps no focus of its own -- the caret stays in the composer, and
    the keys are read off `document`, which is why the active row is published
    through `onActiveOptionChange` for the composer's aria-activedescendant.
  -->
  <div ref="rootEl" class="fg-outputstyle__menuPopup">
    <div
      class="fg-outputstyle__styleList"
      role="listbox"
      :id="LIST_ID"
      :aria-labelledby="hasStyles ? LABEL_ID : undefined"
      :aria-label="hasStyles ? undefined : 'Select an output style'"
      :aria-owns="buildRowShown ? BUILD_ID : undefined"
    >
      <div
        v-if="availableStyles === undefined"
        class="fg-outputstyle__emptyState"
        role="option"
        :id="LOADING_ID"
        aria-disabled="true"
        :aria-selected="false"
      >
        Loading output styles&#8230;
      </div>
      <div
        v-else-if="availableStyles.length === 0"
        class="fg-outputstyle__emptyState"
        role="option"
        :id="EMPTY_ID"
        aria-disabled="true"
        :aria-selected="false"
      >
        No output styles available
      </div>
      <template v-if="hasStyles">
        <div class="fg-outputstyle__sectionHeader" :id="LABEL_ID" role="presentation">Select an output style</div>
        <div
          v-for="(style, index) in availableStyles"
          :key="style"
          :ref="(el) => setStyleRef(style, el)"
          :id="optionId(index)"
          role="option"
          :aria-selected="currentStyle === style"
          :class="`fg-outputstyle__styleItem ${style === activeStyleName ? 'fg-outputstyle__activeStyleItem' : ''}`"
          @mousemove="hoverStyle(style)"
          @click="pick(style)"
        >
          <span class="fg-outputstyle__styleLabel">{{ outputStyleLabel(style) }}</span>
          <div class="fg-outputstyle__checkIcon">
            <CheckIcon v-if="currentStyle === style" />
          </div>
        </div>
      </template>
    </div>
    <div v-if="availableStyles !== undefined && onBuildCustomStyle" class="fg-outputstyle__buildRowSection">
      <button
        type="button"
        :id="BUILD_ID"
        role="option"
        :aria-selected="false"
        ref="buildEl"
        :class="`fg-outputstyle__styleItem fg-modelmenu__navRow ${buildActive ? 'fg-outputstyle__activeStyleItem' : ''}`"
        @mousemove="hoverBuild()"
        @focus="hoverBuild()"
        @click="build()"
      >
        <span class="fg-outputstyle__styleLabel">Build a custom style</span>
        <span class="fg-modelmenu__navChevron" aria-hidden="true">&#8250;</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CheckIcon from './icons/CheckIcon.vue';
import { outputStyleLabel } from './outputStyle';

/** The official `xK` and the ids derived from it. */
const LIST_ID = 'output-style-list';
const LABEL_ID = `${LIST_ID}-label`;
const LOADING_ID = `${LIST_ID}-loading`;
const EMPTY_ID = `${LIST_ID}-empty`;
const BUILD_ID = `${LIST_ID}-build`;
/** The official `AH0`. */
const optionId = (index: number): string => `${LIST_ID}-option-${index}`;

interface Props {
  /** `Z`: undefined until `get_output_style` answers. */
  availableStyles?: string[];
  /** `Y`: the style the tick sits on. */
  currentStyle?: string;
  onClose: () => void;
  onStyleSelected: (style: string) => void;
  /** `Q`: publishes the active row's id for the composer's aria-activedescendant. */
  onActiveOptionChange?: (id: string | undefined) => void;
  /** `G`: omitted when the host cannot create styles, which also hides the row. */
  onBuildCustomStyle?: () => void;
}

const props = defineProps<Props>();

/** The official `z`: `{kind:"style",name}` | `{kind:"build"}` | null. */
type ActiveOption = { kind: 'style'; name: string } | { kind: 'build' };
const active = ref<ActiveOption | null>(null);
/** The official `w`: true once the user has moved the selection themselves. */
const userNavigated = ref(false);

const rootEl = ref<HTMLElement | null>(null);
const buildEl = ref<HTMLElement | null>(null);
const styleEls = new Map<string, HTMLElement>();
function setStyleRef(style: string, el: unknown): void {
  if (el instanceof HTMLElement) styleEls.set(style, el);
  else styleEls.delete(style);
}

const activeStyleName = computed(() => (active.value?.kind === 'style' ? active.value.name : null));
const buildActive = computed(() => active.value?.kind === 'build');
/** The official `B`. */
const hasStyles = computed(() => props.availableStyles !== undefined && props.availableStyles.length > 0);
/** The official `K`. */
const buildRowShown = computed(() => props.availableStyles !== undefined && !!props.onBuildCustomStyle);

/** The official `U`: every navigable option, the build row last. */
const options = computed<ActiveOption[]>(() => {
  if (props.availableStyles === undefined) return [];
  const rows: ActiveOption[] = props.availableStyles.map((name) => ({ kind: 'style', name }));
  return props.onBuildCustomStyle ? [...rows, { kind: 'build' }] : rows;
});

/** The official `D`. */
const activeOptionId = computed<string | undefined>(() => {
  if (buildRowShown.value && buildActive.value) return BUILD_ID;
  if (props.availableStyles === undefined) return LOADING_ID;
  if (!hasStyles.value) return EMPTY_ID;
  const index = activeStyleName.value === null ? -1 : props.availableStyles.indexOf(activeStyleName.value);
  return index >= 0 ? optionId(index) : undefined;
});

/** `e(()=>{Q?.(D)},[D,Q])`, with the official's unmount cleanup. */
watch(activeOptionId, (id) => props.onActiveOptionChange?.(id), { immediate: true });

/**
 * `e(()=>{if(!$||w.current)return;let _=Z?.find(T=>T===Y);q(_===void 0?null:{kind:"style",name:_})},[$,Z,Y])`
 * -- the active row follows the current style until the user navigates.
 */
watch(
  () => [props.availableStyles, props.currentStyle] as const,
  ([styles, current]) => {
    if (userNavigated.value) return;
    const found = styles?.find((style) => style === current);
    active.value = found === undefined ? null : { kind: 'style', name: found };
  },
  { immediate: true }
);

/** `e(()=>{let _=P.current??M.current;if(_)_.scrollIntoView({behavior:"instant",block:"nearest"})})`. */
watch(active, () => {
  void nextTick(() => {
    const el = activeStyleName.value !== null ? styleEls.get(activeStyleName.value) : buildEl.value;
    el?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  });
});

function sameOption(a: ActiveOption | null, b: ActiveOption | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && (a.kind !== 'style' || b.kind !== 'style' || a.name === b.name);
}

function hoverStyle(style: string): void {
  userNavigated.value = true;
  const next: ActiveOption = { kind: 'style', name: style };
  if (!sameOption(active.value, next)) active.value = next;
}

function hoverBuild(): void {
  userNavigated.value = true;
  if (!buildActive.value) active.value = { kind: 'build' };
}

function pick(style: string): void {
  props.onStyleSelected(style);
  props.onClose();
}

function build(): void {
  props.onClose();
  props.onBuildCustomStyle?.();
}

/** The official `N`: is this node inside the popup? */
function insidePopup(node: EventTarget | null): boolean {
  return node instanceof Node && rootEl.value?.contains(node) === true;
}

/**
 * The official `O`, on `document` rather than on the popup: the caret never
 * leaves the composer, so the picker reads the keys from there. Events aimed at
 * some other control are ignored -- only the body, a contenteditable, or the
 * popup itself drive it.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    props.onClose();
    return;
  }
  if (event.isComposing || event.keyCode === 229) return;
  const target = event.target;
  const editable = target instanceof HTMLElement && target.isContentEditable;
  if (target !== document.body && !editable && !insidePopup(target)) return;

  const styles = props.availableStyles;
  if (styles === undefined) {
    // Still loading: swallow Enter so the draft is not sent behind the popup.
    if (event.key === 'Enter' && !event.shiftKey) event.preventDefault();
    return;
  }
  const rows = options.value;
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length > 0) userNavigated.value = true;
  if (event.key === 'ArrowDown' && rows.length > 0) {
    event.preventDefault();
    const at = rows.findIndex((row) => sameOption(row, active.value));
    active.value = rows[at < rows.length - 1 ? at + 1 : 0] ?? null;
    return;
  }
  if (event.key === 'ArrowUp' && rows.length > 0) {
    event.preventDefault();
    const at = rows.findIndex((row) => sameOption(row, active.value));
    active.value = rows[at > 0 ? at - 1 : rows.length - 1] ?? null;
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (buildActive.value && props.onBuildCustomStyle) {
      build();
      return;
    }
    const chosen = styles.find((style) => style === activeStyleName.value);
    if (chosen !== undefined) pick(chosen);
  }
}

/** The official focusout close: leaving for anything outside the popup dismisses it. */
function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  const editable = next instanceof HTMLElement && next.isContentEditable;
  if (next instanceof Node && !editable && !insidePopup(next)) props.onClose();
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('focusout', onFocusOut);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('focusout', onFocusOut);
  props.onActiveOptionChange?.(undefined);
});
</script>
