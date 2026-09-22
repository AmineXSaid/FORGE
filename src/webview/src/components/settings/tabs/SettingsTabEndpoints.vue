<template>
  <SettingsTab title="Endpoints">
    <SettingsSection>
      <SettingsCell label="Custom model endpoint">
        <template #description>
          Route Forge through an OpenAI- or Anthropic-compatible endpoint instead of
          api.anthropic.com: a company gateway, a self-hosted vLLM, a local Ollama.
          Effort, thinking, workflows and compaction are all client-side, so they
          keep working wherever you point it.
        </template>
        <template #trailing>
          <Button variant="secondary" size="small" @click="run('select')">Select…</Button>
        </template>
      </SettingsCell>

      <SettingsCell label="Add an endpoint">
        <template #description>
          Forge looks for a model server already running here (Ollama, LM Studio,
          vLLM, llama.cpp, Jan) and offers it with its own model list. For anything
          else it asks five questions and writes the profile for you.
          <strong>Paste the token straight in</strong>: it goes to your OS keychain,
          never to <code>settings.json</code>.
        </template>
        <template #trailing>
          <Button variant="primary" size="small" @click="run('add')">Add…</Button>
        </template>
      </SettingsCell>

      <SettingsCell label="Edit endpoints by hand">
        <template #description>
          Opens <code>settings.json</code> at <code>forge.endpoints</code>, with the
          full schema for completion as you type. Everything the guided flow leaves
          out lives here: TLS, proxies, header maps, model maps, capability blocks.
        </template>
        <template #trailing>
          <Button variant="secondary" size="small" @click="run('edit')">Open</Button>
        </template>
      </SettingsCell>
    </SettingsSection>

    <SettingsSection>
      <SettingsCell label="Run diagnostics">
        <template #description>
          Walks outward from this machine to the model: profile, certificates, DNS,
          TCP, TLS, authentication, completion, streaming. The <em>first</em> rung to
          fail is the real problem, and each one carries its own fix.
        </template>
        <template #trailing>
          <Button variant="secondary" size="small" @click="run('diagnostics')">Run</Button>
        </template>
      </SettingsCell>

      <SettingsCell label="Detect capabilities">
        <template #description>
          Probes what the endpoint actually does: streaming, tools, parallel calls,
          vision, reasoning, and whether it honours <code>reasoning_effort</code>.
          Proposes a capability block; nothing is written until you accept it.
        </template>
        <template #trailing>
          <Button variant="secondary" size="small" @click="run('capabilities')">Probe</Button>
        </template>
      </SettingsCell>

      <SettingsCell label="List models">
        <template #description>
          Asks the gateway which models it serves, then checks that the one you pick
          actually answers. Being listed is not the same as being servable.
        </template>
        <template #trailing>
          <Button variant="secondary" size="small" @click="run('models')">List</Button>
        </template>
      </SettingsCell>

      <SettingsCell label="Show status">
        <template #description>
          Reports the active profile, the resolved transport, the capabilities the UI
          gates on, and any profile that failed to parse, so a typo is visible rather
          than silent.
        </template>
        <template #trailing>
          <Button variant="secondary" size="small" @click="run('status')">Show</Button>
        </template>
      </SettingsCell>
    </SettingsSection>

    <!--
      What the gateway's models did when asked to serve. Below the existing
      cells, because it reports on what they set up.
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
import type { EndpointAction } from '../../../../../shared/messages';
import { transport, runHostAction } from '../../../core/runtimeTransport';

/** What each button says it does, for the message when it cannot. */
const LABELS: Record<EndpointAction, string> = {
  select: 'select an endpoint',
  add: 'add an endpoint',
  edit: 'open settings.json',
  status: 'show the endpoint status',
  diagnostics: 'run the endpoint diagnostics',
  capabilities: 'probe the endpoint capabilities',
  models: 'list the endpoint models',
};

/**
 * Every action here is an existing Forge command, so the page stays a surface
 * over the endpoint layer rather than a second implementation of it.
 *
 * The page names the *action*, never the command: the host owns that mapping,
 * which is why `open_config_file` no longer carries a `command:` escape hatch
 * at all (B3, step 32). Through `runHostAction`, so an action the host rejects
 * says so instead of leaving a button that looks dead.
 */
function run(action: EndpointAction): void {
  runHostAction(LABELS[action], () => transport.runEndpointAction(action));
}
</script>
