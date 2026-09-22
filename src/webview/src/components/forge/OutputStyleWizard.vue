<template>
  <!--
    The official "Build a custom style" wizard (`jU0`, reference modules 6c6QYQ
    for the fields and f3sAzg for the dialog), step for step:

      i7 {title:"Build a custom style", closeOnClickOutside:false}
        div.stepCounter          "Step n of 4"
        div.field                one of name / description / instructions / save
          label.label
          input.searchInput      (textarea.searchInput.textarea on instructions)
          div.problem | div.help
        div.actions
          button.primaryButton   Next | Save | Replace | Done
          button.secondaryButton Back, from step 2 on

    Four steps, `lo` in order. The name and description checks are the same
    functions the host refuses the write with; the host is still the one that
    decides, which is why "exists" comes back from it rather than being guessed
    here.
  -->
  <ForgeDialog
    :title="COPY.title"
    :on-close="onClose"
    :show-close-button="true"
    :close-on-click-outside="false"
  >
    <div class="fg-stylewizard__stepCounter">{{ COPY.step(stepIndex + 1, STEPS.length) }}</div>

    <div v-if="step === 'name'" class="fg-stylewizard__field">
      <label :for="fieldId" class="fg-stylewizard__label">{{ COPY.name.label }}</label>
      <input
        ref="textInputEl"
        :id="fieldId"
        type="text"
        class="fg-dialoginput__searchInput"
        :value="draft.name"
        :placeholder="COPY.name.placeholder"
        autocomplete="off"
        spellcheck="false"
        @input="draft.name = ($event.target as HTMLInputElement).value"
        @keydown="onFieldKeyDown"
      />
      <div v-if="showProblems && nameProblem !== null" class="fg-stylewizard__problem" role="alert">
        {{
          nameProblem === 'taken'
            ? COPY.name.problems.taken(draft.name.trim())
            : nameProblem === 'empty'
              ? COPY.name.problems.empty
              : COPY.name.problems.characters
        }}
      </div>
      <div v-else class="fg-stylewizard__help">{{ COPY.name.help }}</div>
    </div>

    <div v-if="step === 'description'" class="fg-stylewizard__field">
      <label :for="fieldId" class="fg-stylewizard__label">{{ COPY.description.label }}</label>
      <input
        ref="textInputEl"
        :id="fieldId"
        type="text"
        class="fg-dialoginput__searchInput"
        :value="draft.description"
        :placeholder="COPY.description.placeholder"
        autocomplete="off"
        @input="draft.description = ($event.target as HTMLInputElement).value"
        @keydown="onFieldKeyDown"
      />
      <div v-if="showProblems && descriptionProblem !== null" class="fg-stylewizard__problem" role="alert">
        {{ COPY.description.fence }}
      </div>
      <div v-else class="fg-stylewizard__help">{{ COPY.description.help }}</div>
    </div>

    <div v-if="step === 'instructions'" class="fg-stylewizard__field">
      <label :for="fieldId" class="fg-stylewizard__label">{{ COPY.instructions.label }}</label>
      <textarea
        ref="textareaEl"
        :id="fieldId"
        class="fg-dialoginput__searchInput fg-stylewizard__textarea"
        :value="draft.instructions"
        :placeholder="COPY.instructions.placeholder"
        rows="6"
        @input="draft.instructions = ($event.target as HTMLTextAreaElement).value"
        @keydown="onFieldKeyDown"
      />
      <div v-if="showProblems && instructionsEmpty" class="fg-stylewizard__problem" role="alert">
        {{ COPY.instructions.empty }}
      </div>
      <div v-else class="fg-stylewizard__help">{{ COPY.instructions.help }}</div>
      <label class="fg-stylewizard__checkboxRow">
        <input
          type="checkbox"
          class="fg-checkbox__checkbox"
          :checked="draft.keepCodingInstructions"
          @change="draft.keepCodingInstructions = ($event.target as HTMLInputElement).checked"
        />
        <span>{{ COPY.instructions.keepCodingInstructions }}</span>
      </label>
      <div class="fg-stylewizard__checkboxHelp">{{ COPY.instructions.keepCodingInstructionsHelp }}</div>
    </div>

    <div v-if="step === 'save'" class="fg-stylewizard__field">
      <div class="fg-stylewizard__label">{{ COPY.save.label }}</div>
      <div role="radiogroup" :aria-label="COPY.save.label">
        <div
          v-for="choice in saveChoices"
          :key="choice.level"
          :ref="(el) => setLevelRef(choice.level, el)"
          role="radio"
          tabindex="0"
          :aria-checked="level === choice.level"
          :class="`fg-outputstyle__styleItem ${level === choice.level ? 'fg-outputstyle__activeStyleItem' : ''}`"
          @click="chooseLevel(choice.level)"
          @keydown="onLevelKeyDown($event, choice.level)"
        >
          <div class="fg-modelmenu__modelContent">
            <span class="fg-outputstyle__styleLabel">{{ choice.label }}</span>
            <span class="fg-modelmenu__modelDescription">
              {{ choice.path !== null ? `${choice.path} · ${choice.help}` : choice.help }}
            </span>
          </div>
          <div class="fg-outputstyle__checkIcon">
            <CheckIcon v-if="level === choice.level" />
          </div>
        </div>
      </div>
      <label class="fg-stylewizard__checkboxRow">
        <input
          type="checkbox"
          class="fg-checkbox__checkbox"
          :checked="switchNow"
          @change="switchNow = ($event.target as HTMLInputElement).checked"
        />
        <span>{{ COPY.save.switchNow }}</span>
      </label>
      <div v-if="status.kind === 'exists'" class="fg-stylewizard__problem" role="alert">
        {{ COPY.save.exists(fileName) }}
      </div>
      <div v-if="status.kind === 'failed'" class="fg-stylewizard__problem" role="alert">
        {{ COPY.save.failed(status.message) }}
      </div>
      <div v-if="savedWithoutReload" class="fg-stylewizard__help" role="status">
        {{ COPY.save.savedWithoutReload }}
      </div>
    </div>

    <div class="fg-dialog__actions">
      <button v-if="savedWithoutReload" type="button" class="fg-dialog__primaryButton" @click="onSaved">
        {{ COPY.done }}
      </button>
      <template v-else>
        <button
          type="button"
          class="fg-dialog__primaryButton"
          :disabled="saving"
          @click="onPrimary"
        >
          {{ !isLastStep ? COPY.next : status.kind === 'exists' ? COPY.replace : COPY.saveButton }}
        </button>
        <button
          v-if="stepIndex > 0"
          type="button"
          class="fg-dialog__secondaryButton"
          :disabled="saving"
          @click="back"
        >
          {{ COPY.back }}
        </button>
      </template>
    </div>
  </ForgeDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { Session } from '../../core/Session';
import ForgeDialog from './ForgeDialog.vue';
import CheckIcon from './icons/CheckIcon.vue';
import {
  OUTPUT_STYLE_COPY as COPY,
  OUTPUT_STYLE_STEPS as STEPS,
  outputStyleDescriptionProblem,
  outputStyleFileName,
  outputStyleNameProblem,
} from './outputStyle';

interface Props {
  session: Session;
  /** `J`: the names already taken, so "taken" is caught before the write. */
  existingStyles?: string[];
  onClose: () => void;
  /** `Y`: the wizard is finished -- close it and put the picker away. */
  onSaved: () => void;
}

const props = defineProps<Props>();

type SaveLevel = 'project' | 'user';
type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'exists' }
  | { kind: 'failed'; message: string }
  | { kind: 'savedWithoutReload' };

const stepIndex = ref(0);
const draft = reactive({ name: '', description: '', instructions: '', keepCodingInstructions: true });
const level = ref<SaveLevel>('project');
const switchNow = ref(true);
const showProblems = ref(false);
const locations = ref<{ project: string; user: string } | null>(null);
const status = ref<Status>({ kind: 'idle' });

const textInputEl = ref<HTMLInputElement | null>(null);
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const levelEls = new Map<SaveLevel, HTMLElement>();
function setLevelRef(value: SaveLevel, el: unknown): void {
  if (el instanceof HTMLElement) levelEls.set(value, el);
  else levelEls.delete(value);
}

/** The official `O`: a save that lands after the dialog closed changes nothing. */
let unmounted = false;
onBeforeUnmount(() => {
  unmounted = true;
});

/** `useId`: one id shared by the step's label and its field, as the official does. */
const fieldId = `fg-style-field-${Math.random().toString(36).slice(2)}`;

const step = computed(() => STEPS[stepIndex.value] ?? 'name');
const isLastStep = computed(() => stepIndex.value === STEPS.length - 1);
const saving = computed(() => status.value.kind === 'saving');
const savedWithoutReload = computed(() => status.value.kind === 'savedWithoutReload');

/** `E`, `I`, `f`. */
const nameProblem = computed(() => outputStyleNameProblem(draft.name, props.existingStyles));
const descriptionProblem = computed(() => outputStyleDescriptionProblem(draft.description));
const instructionsEmpty = computed(() => draft.instructions.trim().length === 0);

/** `m`: what the file will be called, shown in both "Save to" rows. */
const fileName = computed(() => outputStyleFileName(draft.name));

/**
 * `G1`: the two destinations with the full path the file will take. The
 * separator comes from the project path the host sent, so a Windows host shows
 * backslashes and a POSIX one does not.
 */
const saveChoices = computed(() => {
  const sep = locations.value?.project.includes('\\') ? '\\' : '/';
  return (
    [
      { level: 'project' as const, ...COPY.save.project, base: locations.value?.project },
      { level: 'user' as const, ...COPY.save.user, base: locations.value?.user },
    ] satisfies Array<{ level: SaveLevel; label: string; help: string; base: string | undefined }>
  ).map((choice) => ({
    level: choice.level,
    label: choice.label,
    help: choice.help,
    path: choice.base === undefined ? null : `${choice.base}${sep}${fileName.value}`,
  }));
});

/** `e(()=>{…$.getOutputStyleLocations().then(…)},[$])`: a failure just leaves the paths off. */
onMounted(() => {
  props.session
    .getOutputStyleLocations()
    .then((value) => {
      if (!unmounted) locations.value = value;
    })
    .catch(() => {});
});

/** `e(()=>{let V1=setTimeout((i1,d,z0)=>(i1.current??d.current??z0.current)?.focus(),0,M,w,N)},[T])`. */
watch(
  step,
  () => {
    void nextTick(() => {
      setTimeout(() => {
        (textInputEl.value ?? textareaEl.value ?? levelEls.get(level.value))?.focus();
      }, 0);
    });
  },
  { immediate: true }
);

/** `y()`. */
function back(): void {
  showProblems.value = false;
  status.value = { kind: 'idle' };
  stepIndex.value = Math.max(0, stepIndex.value - 1);
}

/** `i()`: the step's own check decides whether Next moves. */
function next(): void {
  if (
    (step.value === 'name' && nameProblem.value !== null) ||
    (step.value === 'description' && descriptionProblem.value !== null) ||
    (step.value === 'instructions' && instructionsEmpty.value)
  ) {
    showProblems.value = true;
    return;
  }
  showProblems.value = false;
  stepIndex.value = Math.min(STEPS.length - 1, stepIndex.value + 1);
}

/**
 * `s(V1)`: the save. `replace` is only ever true on the second press, after the
 * host answered `{kind:"exists"}` and the button relabelled itself "Replace" --
 * nothing here overwrites a file on the first try.
 */
async function save(replace: boolean): Promise<void> {
  status.value = { kind: 'saving' };
  let result;
  try {
    result = await props.session.createOutputStyle({ ...draft }, level.value, replace);
  } catch (error) {
    if (!unmounted) {
      status.value = { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
    return;
  }
  if (unmounted) return;
  if (result.kind === 'exists') {
    status.value = { kind: 'exists' };
    return;
  }
  // The CLI could not reload its list, so the style is on disk but not usable
  // in this session: say so rather than ticking a style the CLI does not know.
  if (result.availableStyles === undefined || !result.availableStyles.includes(draft.name.trim())) {
    status.value = { kind: 'savedWithoutReload' };
    return;
  }
  if (switchNow.value) void props.session.setOutputStyle(draft.name.trim());
  props.onSaved();
}

function onPrimary(): void {
  if (!isLastStep.value) next();
  else void save(status.value.kind === 'exists');
}

/**
 * `S(V1)`: Enter advances, except inside the textarea, where it needs a
 * modifier -- otherwise a multi-line instruction could not be typed.
 */
function onFieldKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key !== 'Enter' || event.shiftKey) return;
  const tag = (event.currentTarget as HTMLElement).tagName;
  if (tag !== 'TEXTAREA' || event.metaKey || event.ctrlKey) {
    event.preventDefault();
    event.stopPropagation();
    next();
  }
}

function chooseLevel(value: SaveLevel): void {
  level.value = value;
  status.value = { kind: 'idle' };
}

function onLevelKeyDown(event: KeyboardEvent, value: SaveLevel): void {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    chooseLevel(value);
  }
}
</script>
