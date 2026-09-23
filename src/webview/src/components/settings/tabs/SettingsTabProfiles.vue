<template>
  <SettingsTab title="Profiles">
    <!--
      A profile is a named settings file layered over your user settings; the
      one in use decides what every other tab reads and writes. Switch, create
      and delete all go to the host. There is no rename: the host has no such
      request, and a button that does nothing is worse than none (B4).
    -->
    <SettingsSection>
      <SettingsSubSection caption="A profile is a set of settings you can switch between, for example one per client or per project. Changes in the other tabs go to the profile in use.">
        <SettingsCell
          v-for="(profile, index) in profileList"
          :key="profile.name"
          :divider="index > 0"
        >
          <template #label>
            <span>{{ profile.name }}</span>
            <span v-if="profile.isActive" class="profiles__inUse">In use</span>
          </template>
          <template #description>{{ profile.path }}</template>
          <template #trailing>
            <div class="profiles__actions">
              <Button
                v-if="!profile.isActive"
                variant="secondary"
                size="small"
                :aria-busy="busy === profile.name"
                @click="handleSwitch(profile)"
              >
                Use
              </Button>
              <button
                v-if="profile.name !== DEFAULT && !profile.isActive"
                type="button"
                class="profiles__delete"
                :aria-label="`Delete ${profile.name}`"
                :title="`Delete ${profile.name}`"
                @click="handleDelete(profile.name)"
              >
                <span class="codicon codicon-trash" aria-hidden="true" />
              </button>
            </div>
          </template>
        </SettingsCell>

        <SettingsCell :divider="true" label="New profile" description="Starts empty: anything it does not set comes from your user settings.">
          <template #bottom>
            <form class="profiles__add" @submit.prevent="handleCreate">
              <TextInput
                v-model="newProfileName"
                placeholder="e.g. client-acme"
                aria-label="New profile name"
                :invalid="!!error"
                class="profiles__addInput"
              />
              <Button type="submit" variant="secondary" :aria-busy="creating">
                <template #icon><span class="codicon codicon-add" aria-hidden="true" /></template>
                Create
              </Button>
            </form>
            <p v-if="error" class="profiles__error" role="alert">{{ error }}</p>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import TextInput from '../../Common/TextInput.vue';
import Button from '../../Common/Button.vue';
import { useSettingsStore } from '../../../composables/useSettingsStore';

const { profiles, activeProfile, createProfile, deleteProfile, switchProfile } = useSettingsStore();

const DEFAULT = 'Default';
const newProfileName = ref('');
const error = ref('');
const creating = ref(false);
const busy = ref<string | null>(null);

watch(newProfileName, () => { error.value = ''; });

const profileList = computed(() => [
  { name: DEFAULT, path: 'Your user settings file, in your home folder', isActive: !activeProfile.value },
  ...(profiles.value ?? []).map((p) => ({
    name: p,
    path: `The ${p} profile's settings file, in your home folder`,
    isActive: activeProfile.value === p,
  })),
]);

function validate(name: string): string | undefined {
  if (!name) return 'Enter a name for the profile.';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return 'Use letters, digits, dash or underscore.';
  if (name === DEFAULT || (profiles.value ?? []).includes(name)) return `"${name}" already exists.`;
  return undefined;
}

const handleCreate = async () => {
  const name = newProfileName.value.trim();
  const problem = validate(name);
  if (problem) {
    error.value = problem;
    return;
  }
  if (creating.value) return;
  creating.value = true;
  try {
    await createProfile(name);
    newProfileName.value = '';
  } catch (e: any) {
    error.value = e?.message || 'Could not create the profile.';
  } finally {
    creating.value = false;
  }
};

const handleSwitch = async (profile: { name: string }) => {
  if (busy.value) return;
  busy.value = profile.name;
  error.value = '';
  try {
    await switchProfile(profile.name === DEFAULT ? null : profile.name);
  } finally {
    busy.value = null;
  }
};

const handleDelete = async (name: string) => {
  error.value = '';
  try {
    await deleteProfile(name);
  } catch (e: any) {
    error.value = e?.message || 'Could not delete the profile.';
  }
};
</script>

<style scoped>
/* A badge is weighted text, not a box (forge-style). */
.profiles__inUse {
  color: var(--forge-success);
  font-size: 11px;
  font-weight: 600;
  margin-left: 8px;
}

.profiles__actions {
  align-items: center;
  display: flex;
  gap: 6px;
}

.profiles__delete {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: var(--corner-radius-small);
  color: var(--forge-text-subtle);
  cursor: pointer;
  display: inline-flex;
  height: 26px;
  justify-content: center;
  padding: 0;
  transition: background-color 120ms cubic-bezier(0.22, 1, 0.36, 1), color 120ms cubic-bezier(0.22, 1, 0.36, 1);
  width: 26px;
}

.profiles__delete:hover {
  background: var(--forge-surface-hover);
  color: var(--forge-danger);
}

.profiles__delete:focus-visible {
  outline: 2px solid var(--forge-focus-ring);
  outline-offset: 1px;
}

.profiles__add {
  display: flex;
  gap: 8px;
  margin: 0;
}

.profiles__addInput {
  flex: 1 1 auto;
}

.profiles__error {
  color: var(--forge-field-invalid);
  font-size: 11px;
  margin: 6px 0 0;
}

@media (prefers-reduced-motion: reduce) {
  .profiles__delete {
    transition: none;
  }
}
</style>
