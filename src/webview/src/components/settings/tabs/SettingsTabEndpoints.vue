<template>
  <SettingsTab title="Endpoints">
    <!--
      An endpoint and its model are one entry: the chat's model menu lists
      these pairs, and nothing else (no Anthropic defaults). A second model
      from the same endpoint is a second entry, one step in "Add".
    -->
    <SettingsSection title="Endpoints and Models">
      <SettingsSubSection>
        <SettingsCell label="Add an endpoint or a model">
          <template #description>
            Pick a model server running here (Ollama, LM Studio, vLLM, llama.cpp, Jan),
            a gateway, or another model from an endpoint you already have. Forge lists
            the models, checks the one you choose really answers, then saves it and
            switches to it. Keys go to your OS keychain, never to
            <code>settings.json</code>.
          </template>
          <template #trailing>
            <Button variant="primary" size="small" @click="run('add')">
              <template #icon><span class="codicon codicon-add" aria-hidden="true" /></template>
              Add
            </Button>
          </template>
        </SettingsCell>

        <SettingsCell label="Switch endpoint and model" :divider="true">
          <template #description>
            The same list as the chat's model menu. A switch applies to new
            conversations, and to an open one from its next message.
          </template>
          <template #trailing>
            <Button variant="secondary" size="small" @click="run('select')">Switch</Button>
          </template>
        </SettingsCell>

        <SettingsCell label="Edit endpoints by hand" :divider="true">
          <template #description>
            Opens <code>settings.json</code> at <code>forge.endpoints</code>, with completion
            as you type. Everything the guided flow leaves out lives here: TLS, proxies,
            header maps, capability blocks.
          </template>
          <template #trailing>
            <Button variant="secondary" size="small" @click="run('edit')">Open</Button>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <SettingsSection title="Troubleshooting">
      <SettingsSubSection>
        <SettingsCell label="Run diagnostics">
          <template #description>
            Walks outward from this machine to the model: profile, certificates, DNS,
            TCP, TLS, authentication, completion, streaming. The first step to fail is
            the real problem, and each one says how to fix it.
          </template>
          <template #trailing>
            <Button variant="secondary" size="small" @click="run('diagnostics')">Run</Button>
          </template>
        </SettingsCell>

        <SettingsCell label="Detect capabilities" :divider="true">
          <template #description>
            Probes what the endpoint actually does: streaming, tools, parallel calls,
            vision, reasoning, and whether it honours <code>reasoning_effort</code>.
            Nothing is written until you accept the result.
          </template>
          <template #trailing>
            <Button variant="secondary" size="small" @click="run('capabilities')">Probe</Button>
          </template>
        </SettingsCell>

        <SettingsCell label="List models" :divider="true">
          <template #description>
            Asks an endpoint which models it serves and checks that the one you pick
            answers. Being listed is not the same as being servable.
          </template>
          <template #trailing>
            <Button variant="secondary" size="small" @click="run('models')">List</Button>
          </template>
        </SettingsCell>

        <SettingsCell label="Show status" :divider="true">
          <template #description>
            The endpoint in use, the resolved transport, the capabilities the UI reads,
            and any entry that failed to load, so a typo is visible rather than silent.
          </template>
          <template #trailing>
            <Button variant="secondary" size="small" @click="run('status')">Show</Button>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <!--
      What each endpoint's model did when last asked to serve. Below the cells,
      because it reports on what they set up.
    -->
    <EndpointHealthTable />
  </SettingsTab>
</template>

<script setup lang="ts">
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import EndpointHealthTable from '../EndpointHealthTable.vue';
import Button from '../../Common/Button.vue';
import type { EndpointAction } from '../../../../../shared/messages';
import { transport, runHostAction } from '../../../core/runtimeTransport';

/** What each button says it does, for the message when it cannot. */
const LABELS: Record<EndpointAction, string> = {
  select: 'switch the endpoint',
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
