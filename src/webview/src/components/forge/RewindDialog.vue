<template>
  <!--
    The official rewind confirm dialog (`mo`, reference module n2luCQ -> the
    already-ported `fg-changes__*`), element for element:

      i7 (ForgeDialog)
        title           willForkAfter ? "Fork and rewind" : "Rewind code"
        buttons         [{label: willForkAfter ? "Continue" : "Rewind",
                          shortcut "1", primary, disabled unless B},
                         {label:"Never mind", shortcut "2"}]
        showCloseButton false, closeOnClickOutside false
        children
          willForkAfter && p.forkNote
          loading       && p.loading
          !loading && error && div.error > p
          !loading && result.canRewind &&
            (hasChanges
              ? p.summary (span.deletions, span.additions, file count)
                ul.fileList > li.fileItem per file, cwd-relative
              : p.noChanges "The code <strong>has not changed</strong>, …")
            p.warning > D21.warningIcon + the manual-edit caveat

    The dry run is fired on mount, exactly as the official's effect does, and
    re-fired when the session or the message changes.
  -->
  <ForgeDialog
    :title="willForkAfter ? 'Fork and rewind' : 'Rewind code'"
    :on-close="onClose"
    :buttons="buttons"
    :show-close-button="false"
    :close-on-click-outside="false"
  >
    <p v-if="willForkAfter" class="fg-changes__forkNote">
      A new forked conversation will be created after rewinding.
    </p>
    <p v-if="loading" class="fg-changes__loading">Checking code changes&#8230;</p>
    <div v-if="!loading && error" class="fg-changes__error"><p>{{ error }}</p></div>
    <template v-if="!loading && result?.canRewind">
      <template v-if="hasChanges">
        <p class="fg-changes__summary">
          <span class="fg-changes__deletions">{{ result!.deletions || 0 }} line{{ result!.deletions !== 1 ? 's' : '' }}</span>
          will be removed and
          <span class="fg-changes__additions">{{ result!.insertions || 0 }} line{{ result!.insertions !== 1 ? 's' : '' }}</span>
          will be added across {{ result!.filesChanged!.length }} file{{ result!.filesChanged!.length !== 1 ? 's' : '' }}:
        </p>
        <ul class="fg-changes__fileList">
          <li v-for="file in result!.filesChanged" :key="file" class="fg-changes__fileItem">
            {{ relativeToCwd(file, cwd) }}
          </li>
        </ul>
      </template>
      <p v-else class="fg-changes__noChanges">
        The code <strong>has not changed</strong>, so no code will be restored.
      </p>
      <p class="fg-changes__warning">
        <InfoCircleIcon class="fg-changes__warningIcon" />Rewinding does not affect files edited manually or via bash.
      </p>
    </template>
  </ForgeDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { RewindCodeResponse } from '../../../../shared/messages';
import ForgeDialog, { type DialogButton } from './ForgeDialog.vue';
import InfoCircleIcon from './icons/InfoCircleIcon.vue';
import { relativeToCwd, rewindConfirmEnabled } from '../../core/rewind';

interface Props {
  /** The conversation whose files are being rewound. */
  session: {
    cwd: () => string | undefined;
    rewindCode: (userMessageId: string, options?: { dryRun?: boolean }) => Promise<RewindCodeResponse>;
  };
  userMessageId: string;
  /** `willForkAfter`: a fork follows the rewind, so a no-change rewind is still worth doing. */
  willForkAfter?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const props = withDefaults(defineProps<Props>(), { willForkAfter: false });

const loading = ref(true);
const result = ref<RewindCodeResponse | null>(null);
const error = ref<string | null>(null);

const cwd = computed(() => props.session.cwd());
const hasChanges = computed(() => !!result.value?.filesChanged && result.value.filesChanged.length > 0);

/**
 * `e(()=>{G(!0),q(null),V(null),$.rewindCode(J,{dryRun:!0}).then(q)
 *          .catch((D)=>V(D instanceof Error?D.message:String(D))).finally(()=>G(!1))},[$,J])`
 *
 * The host **throws** `result.error`, so a checkpoint failure arrives here as a
 * rejection, not as a shaped response.
 */
watch(
  () => [props.session, props.userMessageId] as const,
  () => {
    loading.value = true;
    result.value = null;
    error.value = null;
    props.session
      .rewindCode(props.userMessageId, { dryRun: true })
      .then((r) => {
        result.value = r;
      })
      .catch((e: unknown) => {
        error.value = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        loading.value = false;
      });
  },
  { immediate: true }
);

const buttons = computed<DialogButton[]>(() => [
  {
    label: props.willForkAfter ? 'Continue' : 'Rewind',
    shortcut: '1',
    onClick: props.onConfirm,
    disabled: !rewindConfirmEnabled(result.value, loading.value, props.willForkAfter),
    primary: true,
  },
  { label: 'Never mind', shortcut: '2', onClick: props.onClose },
]);
</script>
