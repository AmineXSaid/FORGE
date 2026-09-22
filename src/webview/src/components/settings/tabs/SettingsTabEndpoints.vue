<template>
  <SettingsTab title="Endpoints">
    <SettingsSection>
      <SettingsCell label="Custom model endpoint">
        <template #description>
          Route Forge through an OpenAI- or Anthropic-compatible endpoint instead of
          api.anthropic.com: a company gateway, a self-hosted vLLM, a local Ollama.
          Profiles are YAML files in <code>forge.endpointProfilesDir</code>, and
          <code>forge.endpointProfile</code> selects the active one by name.
        </template>
        <template #trailing>
          <Button variant="primary" size="small" @click="addEndpoint">Add…</Button>
        </template>
      </SettingsCell>
    </SettingsSection>

    <!--
      What the gateway's models did when asked to serve. Below the cell above,
      because it reports on what that cell set up.

      The guided flows the endpoints line has here (select, diagnostics,
      capability probing, status) are not on this branch, and B4 says a row
      appears only when its backend works, so they are left out rather than
      shown dead.
    -->
    <EndpointHealthTable />
  </SettingsTab>
</template>

<script setup lang="ts">
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsCell from '../SettingsCell.vue';
import EndpointHealthTable from '../EndpointHealthTable.vue';
import Button from '../../Common/Button.vue';
import { transport, runHostAction } from '../../../core/runtimeTransport';

/**
 * Opens a filled-in profile template for the folder the loader reads, and
 * creates that folder, so "save it here" is true when the user tries.
 *
 * Through `runHostAction`, so a host that cannot answer says so instead of
 * leaving a button that looks dead.
 */
function addEndpoint(): void {
  runHostAction('open an endpoint profile', () => transport.openConfigFile('endpoints'));
}
</script>
