<template>
  <SettingsTab title="Sandbox">
    <SettingsSection title="Sandbox Isolation">
      <SettingsSubSection>
        <SettingsCell
          label="Enable Sandbox"
          description="Run Bash commands in an OS-level sandbox that limits what they can read, write and reach on the network."
        >
          <template #trailing>
            <Switch :model-value="sandbox.enabled ?? false" aria-label="Enable Sandbox" @update:model-value="patch({ enabled: $event })" />
          </template>
        </SettingsCell>

        <!--
          The two rules below only act while the sandbox is on. They stay
          editable so they can be set up before switching it on; the
          description says so rather than greying them out.
        -->
        <SettingsCell
          label="Auto-approve Bash when Sandboxed"
          :description="`Sandboxed commands run without a permission prompt.${offNote}`"
          :divider="true"
        >
          <template #trailing>
            <Switch
              :model-value="sandbox.autoAllowBashIfSandboxed ?? true"
              aria-label="Auto-approve Bash when Sandboxed"
              @update:model-value="patch({ autoAllowBashIfSandboxed: $event })"
            />
          </template>
        </SettingsCell>

        <SettingsCell
          label="Allow Unsandboxed Commands"
          :description="`Commands may ask to run outside the sandbox (dangerouslyDisableSandbox). Off means every command stays sandboxed.${offNote}`"
          :divider="true"
        >
          <template #trailing>
            <Switch
              :model-value="sandbox.allowUnsandboxedCommands ?? true"
              aria-label="Allow Unsandboxed Commands"
              @update:model-value="patch({ allowUnsandboxedCommands: $event })"
            />
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection title="Excluded Commands">
      <SettingsSubSection>
        <SettingsCell
          label="Commands to Run Outside Sandbox"
          description="Commands that always run outside the sandbox, such as docker or git."
        >
          <template #bottom>
            <ListEditor
              label="Excluded commands"
              monospace
              placeholder="e.g. docker"
              :items="own.excludedCommands"
              :inherited="inherited.excludedCommands"
              @add="patch({ excludedCommands: [...own.excludedCommands, $event] })"
              @remove="patch({ excludedCommands: without(own.excludedCommands, $event) })"
            />
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection title="Network Configuration">
      <SettingsSubSection>
        <SettingsCell
          label="Allow Local Binding"
          description="Sandboxed commands may listen on localhost ports, for dev servers. macOS only."
        >
          <template #trailing>
            <Switch
              :model-value="network.allowLocalBinding ?? false"
              aria-label="Allow Local Binding"
              @update:model-value="patchNetwork({ allowLocalBinding: $event })"
            />
          </template>
        </SettingsCell>

        <SettingsCell
          label="Allowed Unix Sockets"
          description="Socket paths sandboxed commands may connect to, such as the SSH agent. macOS only."
          :divider="true"
        >
          <template #bottom>
            <ListEditor
              label="Allowed Unix sockets"
              monospace
              placeholder="e.g. /private/tmp/ssh-agent.sock"
              add-label="Allow"
              :items="own.allowUnixSockets"
              :inherited="inherited.allowUnixSockets"
              :validate="validateSocket"
              @add="patchNetwork({ allowUnixSockets: [...own.allowUnixSockets, $event] })"
              @remove="patchNetwork({ allowUnixSockets: without(own.allowUnixSockets, $event) })"
            />
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection title="Proxy Configuration">
      <SettingsSubSection caption="Leave a port empty to let the sandbox pick one.">
        <SettingsCell label="HTTP Proxy Port" description="Port of your own HTTP proxy for sandboxed network access.">
          <template #trailing>
            <NumberInput
              :model-value="network.httpProxyPort ?? 0"
              :min="1"
              :max="65535"
              width="88px"
              empty-when-zero
              placeholder="Auto"
              aria-label="HTTP proxy port"
              @update:model-value="patchNetwork({ httpProxyPort: $event || undefined })"
            />
          </template>
        </SettingsCell>

        <SettingsCell label="SOCKS Proxy Port" description="Port of your own SOCKS5 proxy for sandboxed network access." :divider="true">
          <template #trailing>
            <NumberInput
              :model-value="network.socksProxyPort ?? 0"
              :min="1"
              :max="65535"
              width="88px"
              empty-when-zero
              placeholder="Auto"
              aria-label="SOCKS proxy port"
              @update:model-value="patchNetwork({ socksProxyPort: $event || undefined })"
            />
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Switch from '../../Common/Switch.vue';
import NumberInput from '../../Common/NumberInput.vue';
import ListEditor from '../../Common/ListEditor.vue';
import { useSettingsStore } from '../../../composables/useSettingsStore';
import { useSettingsScope } from '../../../composables/useSettingsScope';

interface SandboxNetwork {
  allowLocalBinding?: boolean;
  allowUnixSockets?: string[];
  httpProxyPort?: number;
  socksProxyPort?: number;
  [key: string]: unknown;
}

interface SandboxConfig {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  allowUnsandboxedCommands?: boolean;
  excludedCommands?: string[];
  network?: SandboxNetwork;
  [key: string]: unknown;
}

const { settings, activeProfile, inspect, updateSetting } = useSettingsStore();
const scope = useSettingsScope();

/** What applies: every layer merged, shown in the controls. */
const sandbox = computed<SandboxConfig>(() => {
  const value = settings.value?.sandbox;
  return value && typeof value === 'object' ? (value as SandboxConfig) : {};
});
const network = computed<SandboxNetwork>(() => sandbox.value.network ?? {});

/** What the scope being edited holds, which is what a change is written into. */
const scopeSandbox = computed<SandboxConfig>(() => {
  void settings.value;
  const values = inspect('sandbox')?.values ?? {};
  const layer = activeProfile.value && scope.value === 'global' ? values.profile : values[scope.value];
  return layer && typeof layer === 'object' ? (layer as SandboxConfig) : {};
});

/*
 * The lists: entries the edited scope holds are editable; entries that come
 * from another layer are shown after them, locked, as the Permissions lists do.
 */
const own = computed(() => ({
  excludedCommands: scopeSandbox.value.excludedCommands ?? [],
  allowUnixSockets: scopeSandbox.value.network?.allowUnixSockets ?? [],
}));
const inherited = computed(() => ({
  excludedCommands: (sandbox.value.excludedCommands ?? []).filter((c) => !own.value.excludedCommands.includes(c)),
  allowUnixSockets: (network.value.allowUnixSockets ?? []).filter((c) => !own.value.allowUnixSockets.includes(c)),
}));

const offNote = computed(() => (sandbox.value.enabled ? '' : ' Applies once the sandbox is on.'));

/*
 * Every write merges into the scope's own object, so keys this page does not
 * show (filesystem, credentials, ignoreViolations) survive an edit. Nothing is
 * written until the user changes something.
 */
function patch(change: Partial<SandboxConfig>): void {
  updateSetting('sandbox', { ...scopeSandbox.value, ...change }, scope.value);
}

function patchNetwork(change: Partial<SandboxNetwork>): void {
  const next: SandboxNetwork = { ...(scopeSandbox.value.network ?? {}), ...change };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  patch({ network: next });
}

function without(list: string[] | undefined, index: number): string[] {
  return (list ?? []).filter((_, i) => i !== index);
}

function validateSocket(value: string): string | undefined {
  return value.startsWith('/') ? undefined : 'Use an absolute socket path, starting with /.';
}
</script>
