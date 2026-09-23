<template>
  <SettingsTab title="MCP Servers">
    <!-- Section 1: Server Status (SDK probe, read-only) -->
    <SettingsSection title="Server Status">
      <SettingsSubSection>
        <!-- Loading state -->
        <SettingsCell v-if="loading">
          <template #label>
            <div class="mcp-loading">
              <span class="codicon codicon-loading mcp-spin" />
              <span>Probing MCP servers...</span>
            </div>
          </template>
        </SettingsCell>

        <!-- Server list -->
        <SettingsCell
          v-for="(server, index) in mcpServers"
          :key="server.name"
          :divider="index > 0"
        >
          <template #label>
            <div class="mcp-server-row">
              <span class="mcp-server-name">{{ server.name }}</span>
              <Badge :variant="statusVariant(server.status)" size="small">
                {{ statusLabel(server.status) }}
              </Badge>
            </div>
          </template>
          <template #trailing>
            <span v-if="server.serverInfo" class="mcp-server-version">
              {{ server.serverInfo.name }} v{{ server.serverInfo.version }}
            </span>
          </template>
        </SettingsCell>

        <!-- Empty state -->
        <div v-if="!loading && mcpServers.length === 0" class="mcp-empty">
          <span class="codicon codicon-server-process mcp-empty__icon" aria-hidden="true" />
          <p class="mcp-empty__title">No MCP servers yet</p>
          <p class="mcp-empty__text">
            Give Forge new tools: a local command such as
            <code>npx -y @modelcontextprotocol/server-memory</code>, or a remote URL.
            Add server asks four questions and writes the config.
          </p>
        </div>

        <!-- Action buttons -->
        <SettingsCell :divider="mcpServers.length > 0 || loading">
          <template #label>
            <div class="mcp-actions">
              <!--
                The one way in that needs no JSON: a few prompts (how it runs,
                its name, the command or URL, who gets it) and Forge writes the
                config. The status list above re-probes when it finishes.
              -->
              <Button variant="primary" :disabled="adding" :aria-busy="adding" @click="handleAddServer">
                <template #icon>
                  <span class="codicon" :class="adding ? 'codicon-loading mcp-spin' : 'codicon-add'" aria-hidden="true" />
                </template>
                Add server
              </Button>
              <Tooltip content="Re-probe MCP servers">
                <Button variant="secondary" :disabled="loading" :aria-busy="loading" @click="handleRefresh">
                  <template #icon>
                    <span class="codicon codicon-refresh" :class="{ 'mcp-spin': loading }" aria-hidden="true" />
                  </template>
                  Refresh
                </Button>
              </Tooltip>
              <Tooltip content="Open ~/.claude.json (global MCP config)">
                <Button variant="tertiary" @click="openGlobalConfig">
                  <template #icon><span class="codicon codicon-globe" aria-hidden="true" /></template>
                  Global config
                </Button>
              </Tooltip>
              <Tooltip v-if="hasWorkspace" content="Open .mcp.json (project MCP config)">
                <Button variant="tertiary" @click="openProjectConfig">
                  <template #icon><span class="codicon codicon-folder" aria-hidden="true" /></template>
                  Project config
                </Button>
              </Tooltip>
            </div>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <!-- Section 2: Project Server Policy -->
    <SettingsSection title="Project Server Policy">
      <SettingsSubSection caption="Control which MCP servers from .mcp.json files are automatically approved.">
        <!-- enableAllProjectMcpServers -->
        <SettingsItem
          setting-key="enableAllProjectMcpServers"
          label="Auto-Approve All Project Servers"
          description="Automatically approve all MCP servers defined in .mcp.json"
        >
          <template #default="{ effectiveValue, update }">
            <div class="cursor-settings-cell-switch-container">
              <span class="switch-tooltip-wrapper">
                <Switch
                  :model-value="effectiveValue ?? false"
                  @update:model-value="update"
                />
              </span>
            </div>
          </template>
        </SettingsItem>

        <!-- enabledMcpjsonServers -->
        <SettingsItem
          setting-key="enabledMcpjsonServers"
          label="Approved Servers"
          description="Explicitly approved MCP servers from .mcp.json"
          :divider="true"
        >
          <template #content="{ effectiveValue, update }">
            <ListEditor
              label="Approved servers"
              tone="success"
              placeholder="Server name from .mcp.json"
              add-label="Approve"
              :items="effectiveValue || []"
              @add="update(addToArray(effectiveValue, $event))"
              @remove="update(removeFromArray(effectiveValue, $event))"
            />
          </template>
        </SettingsItem>

        <!-- disabledMcpjsonServers -->
        <SettingsItem
          setting-key="disabledMcpjsonServers"
          label="Rejected Servers"
          description="Explicitly rejected MCP servers from .mcp.json"
          :divider="true"
        >
          <template #content="{ effectiveValue, update }">
            <ListEditor
              label="Rejected servers"
              tone="danger"
              placeholder="Server name from .mcp.json"
              add-label="Reject"
              :items="effectiveValue || []"
              @add="update(addToArray(effectiveValue, $event))"
              @remove="update(removeFromArray(effectiveValue, $event))"
            />
          </template>
        </SettingsItem>
      </SettingsSubSection>
    </SettingsSection>

    <!-- Section 3: Enterprise Policy (conditional) -->
    <SettingsSection v-if="hasEnterprisePolicies" title="Enterprise Policy">
      <SettingsSubSection>
        <SettingsCell v-if="managedAllowedServers.length" label="Allowed Servers">
          <template #label>
            <div class="flex items-center gap-2">
              <span>Allowed Servers</span>
              <Tooltip content="Controlled by managed policy">
                <Badge variant="danger">Managed</Badge>
              </Tooltip>
            </div>
          </template>
          <template #bottom>
            <div class="mcp-pill-container">
              <div
                v-for="(server, index) in managedAllowedServers"
                :key="'ma-' + index"
                class="mcp-pill mcp-pill--enabled mcp-pill--readonly"
              >
                <span>{{ server.serverName }}</span>
              </div>
            </div>
          </template>
        </SettingsCell>

        <SettingsCell
          v-if="managedDeniedServers.length"
          label="Denied Servers"
          :divider="managedAllowedServers.length > 0"
        >
          <template #label>
            <div class="flex items-center gap-2">
              <span>Denied Servers</span>
              <Tooltip content="Controlled by managed policy">
                <Badge variant="danger">Managed</Badge>
              </Tooltip>
            </div>
          </template>
          <template #bottom>
            <div class="mcp-pill-container">
              <div
                v-for="(server, index) in managedDeniedServers"
                :key="'md-' + index"
                class="mcp-pill mcp-pill--disabled mcp-pill--readonly"
              >
                <span>{{ server.serverName }}</span>
              </div>
            </div>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <!-- Section 4: MCP Environment Variables -->
    <SettingsSection title="MCP Environment Variables">
      <SettingsSubSection caption="Environment variables for MCP server configuration. Written to the env object in settings.json.">
        <SettingsCell
          v-for="(field, index) in MCP_ENV_FIELDS"
          :key="field.key"
          :description="field.description"
          :divider="index > 0"
        >
          <template #label>
            <div class="flex items-center gap-2">
              <span>{{ field.label }}</span>
              <Tooltip v-if="isEnvInherited(field.key)" content="Inherited from a lower-priority scope">
                <Badge variant="subtle">inherited</Badge>
              </Tooltip>
            </div>
          </template>
          <template #trailing>
            <TextInput
              v-model="fieldValues[field.key]"
              :type="field.type || 'text'"
              :placeholder="field.placeholder"
              monospace
              @change="updateEnvVar(field.key, $event)"
            />
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watchEffect } from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import SettingsItem from '../SettingsItem.vue';
import Badge from '../../Common/Badge.vue';
import Switch from '../../Common/Switch.vue';
import TextInput from '../../Common/TextInput.vue';
import Tooltip from '../../Common/Tooltip.vue';
import { useSettingsStore } from '../../../composables/useSettingsStore';
import { useSettingsScope } from '../../../composables/useSettingsScope';
import { runHostAction, transport } from '../../../core/runtimeTransport';
import Button from '../../Common/Button.vue';
import ListEditor from '../../Common/ListEditor.vue';

const {
  settings, activeProfile, inspect, updateSetting,
  sdkCapabilities, sdkCapabilitiesLoading, refreshSdkCapabilities,
  hasWorkspace
} = useSettingsStore();
const scope = useSettingsScope();

// ── Server Status (SDK probe, read-only) ──

const mcpServers = computed(() => sdkCapabilities.value.mcpServerStatus || []);
const loading = computed(() => sdkCapabilitiesLoading.value);

type BadgeVariant = 'success' | 'danger' | 'warning' | 'subtle' | 'default';

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'connected': return 'success';
    case 'failed': return 'danger';
    case 'needs-auth': return 'warning';
    case 'pending': return 'subtle';
    default: return 'default';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'connected': return 'Connected';
    case 'failed': return 'Failed';
    case 'needs-auth': return 'Needs Auth';
    case 'pending': return 'Pending';
    default: return status;
  }
}

const handleRefresh = () => refreshSdkCapabilities();

/** The add flow is open; the host answers when it ends, saved or not. */
const adding = ref(false);
const handleAddServer = () => {
  adding.value = true;
  runHostAction('add an MCP server', () =>
    transport.runForgeAction('add-mcp-server').finally(() => {
      adding.value = false;
      refreshSdkCapabilities();
    }),
  );
};

// ── Config File Opening ──

const openGlobalConfig = () => transport.openConfigFile('mcp-global');
const openProjectConfig = () => transport.openConfigFile('mcp-project');

// ── Policy: Pill list helpers ──

function removeFromArray(arr: string[] | undefined, index: number): string[] {
  const list = [...(arr || [])];
  list.splice(index, 1);
  return list;
}

function addToArray(arr: string[] | undefined, item: string): string[] | undefined {
  const trimmed = item.trim();
  if (!trimmed) return arr;
  const list = [...(arr || [])];
  if (list.includes(trimmed)) return arr;
  list.push(trimmed);
  return list;
}

// ── Enterprise Policy (managed scope, read-only) ──

const hasEnterprisePolicies = computed(() => {
  void settings.value;
  const allowedMeta = inspect('allowedMcpServers');
  const deniedMeta = inspect('deniedMcpServers');
  return (allowedMeta?.values?.managed !== undefined)
    || (deniedMeta?.values?.managed !== undefined);
});

const managedAllowedServers = computed(() => {
  void settings.value;
  const meta = inspect('allowedMcpServers');
  return (meta?.values?.managed || []) as Array<{ serverName: string }>;
});

const managedDeniedServers = computed(() => {
  void settings.value;
  const meta = inspect('deniedMcpServers');
  return (meta?.values?.managed || []) as Array<{ serverName: string }>;
});

// ── MCP Environment Variables (Network Tab pattern) ──

interface McpEnvField {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  type?: 'text' | 'password';
}

const MCP_ENV_FIELDS: McpEnvField[] = [
  { key: 'MCP_TIMEOUT', label: 'Server Timeout', description: 'Timeout for MCP server startup (ms)', placeholder: '10000' },
  { key: 'MCP_TOOL_TIMEOUT', label: 'Tool Timeout', description: 'Timeout for individual MCP tool calls (ms)', placeholder: '300000' },
  { key: 'MAX_MCP_OUTPUT_TOKENS', label: 'Max Output Tokens', description: 'Maximum tokens in MCP server response (default 25000)', placeholder: '25000' },
  { key: 'ENABLE_TOOL_SEARCH', label: 'Tool Search', description: 'Enable tool search: auto, auto:N, true, or false', placeholder: 'auto' },
  { key: 'MCP_OAUTH_CALLBACK_PORT', label: 'OAuth Callback Port', description: 'Fixed port for MCP OAuth redirect', placeholder: '8080' },
  { key: 'MCP_CLIENT_SECRET', label: 'Client Secret', description: 'OAuth client secret for MCP authentication', placeholder: '••••••', type: 'password' },
];

const MCP_ENV_KEYS = MCP_ENV_FIELDS.map(f => f.key);

// Scope-aware env (same pattern as Network Tab)
const scopeEnv = computed<Record<string, string>>(() => {
  void settings.value;
  const meta = inspect('env');
  const values = meta?.values || {};
  if (activeProfile.value && scope.value === 'global') {
    return (values.profile as Record<string, string>) || {};
  }
  return (values[scope.value] as Record<string, string>) || {};
});

const effectiveEnv = computed<Record<string, string>>(() => {
  const val = settings.value?.env;
  return (val && typeof val === 'object' ? val : {}) as Record<string, string>;
});

const fieldValues = reactive<Record<string, string>>({});

watchEffect(() => {
  const env = effectiveEnv.value;
  for (const key of MCP_ENV_KEYS) {
    fieldValues[key] = env[key] || '';
  }
});

function isEnvInherited(key: string): boolean {
  return !!effectiveEnv.value[key] && !(key in scopeEnv.value);
}

function updateEnvVar(key: string, value: string) {
  const env: Record<string, string> = { ...scopeEnv.value };
  if (value) {
    env[key] = value;
  } else {
    delete env[key];
  }
  updateSetting('env', env, scope.value);
}
</script>

<style scoped>
/* ── Server Status ── */

.mcp-server-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mcp-server-name {
  font-family: var(--app-monospace-font-family);
  font-size: 12px;
  color: var(--cursor-text-primary);
}

.mcp-server-version {
  font-size: 11px;
  color: var(--cursor-text-tertiary);
  font-family: var(--app-monospace-font-family);
}

.mcp-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--cursor-text-secondary);
  font-size: 12px;
}

.mcp-empty {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 26px 16px 18px;
  text-align: center;
}

.mcp-empty__icon {
  color: var(--forge-brand);
  font-size: 22px;
  margin-bottom: 6px;
}

.mcp-empty__title {
  color: var(--cursor-text-primary);
  font-size: 13px;
  font-weight: 500;
  margin: 0;
}

.mcp-empty__text {
  color: var(--cursor-text-secondary);
  font-size: 12px;
  line-height: 18px;
  margin: 0;
  max-width: 46ch;
}

.mcp-empty__text code {
  background: var(--forge-chip-bg);
  border: 1px solid var(--forge-chip-border);
  border-radius: var(--corner-radius-small);
  font-family: var(--app-monospace-font-family);
  font-size: 11px;
  padding: 0 4px;
}

/* ── Actions ── */

.mcp-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

/* ── Pill containers ── */

.mcp-pill-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  align-items: center;
}

.mcp-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border-radius: var(--corner-radius-medium);
  font-size: 11.5px;
  font-family: var(--app-monospace-font-family);
  user-select: none;
  line-height: 1.5;
}

.mcp-pill--enabled {
  background-color: color-mix(in srgb, var(--forge-success) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--forge-success) 32%, transparent);
  color: var(--forge-success);
}

.mcp-pill--disabled {
  background-color: color-mix(in srgb, var(--forge-danger) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--forge-danger) 32%, transparent);
  color: var(--forge-danger);
}

/* ── Spinner ── */

.mcp-spin {
  animation: mcp-spin 1s linear infinite;
}

@keyframes mcp-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ── Switch wrapper (isolate Tooltip as-child from Switch data-state) ── */

.switch-tooltip-wrapper {
  display: inline-flex;
  align-items: center;
}
</style>
