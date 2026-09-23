<template>
  <SettingsTab title="Permissions">
    <!-- Section 1: Default Mode -->
    <SettingsSection title="Default Mode">
      <SettingsSubSection>
        <SettingsCell
          label="Permission Mode"
          description="Default behavior when Forge requests permission for an operation"
        >
          <template #label>
            <div class="flex items-center gap-2">
              <span>Permission Mode</span>
              <Tooltip v-if="isModeInherited" content="Inherited from a lower-priority scope">
                <Badge variant="subtle">inherited</Badge>
              </Tooltip>
              <Tooltip v-if="isModeOverridden" :content="`Overridden by ${modeOverriddenByLabel} scope`">
                <Badge variant="warning">overridden</Badge>
              </Tooltip>
            </div>
          </template>
          <template #trailing>
            <Dropdown
              :model-value="defaultMode"
              @update:model-value="updateDefaultMode"
              :options="defaultModeOptions"
              menu-align="right"
            >
              <template #trigger="{ selected }">
                {{ selected?.label || defaultMode }}
              </template>
            </Dropdown>
          </template>
        </SettingsCell>

        <!-- Managed: disableBypassPermissionsMode -->
        <SettingsCell
          v-if="bypassDisabledByManaged"
          label="Bypass Mode Disabled"
          description="The ability to bypass permission prompts has been disabled by managed policy"
          :divider="true"
        >
          <template #label>
            <div class="flex items-center gap-2">
              <span>Bypass Mode Disabled</span>
              <Tooltip content="Controlled by managed policy">
                <Badge variant="danger">Managed</Badge>
              </Tooltip>
            </div>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <!-- Section 2: Permission Rules -->
    <SettingsSection title="Permission Rules">
      <SettingsSubSection caption="Evaluation order: Deny → Ask → Allow (first match wins). Rules use the format: ToolName or ToolName(pattern) or mcp__server__tool.">
        <!-- Deny Rules -->
        <SettingsCell label="Deny Rules" description="Operations that are always blocked">
          <template #label>
            <div class="flex items-center gap-2">
              <span>Deny Rules</span>
              <Tooltip v-if="isListInherited('deny')" content="Inherited from a lower-priority scope">
                <Badge variant="subtle">inherited</Badge>
              </Tooltip>
            </div>
          </template>
          <template #bottom>
            <ListEditor
              label="Deny rules"
              tone="danger"
              monospace
              placeholder="e.g. Bash(rm:*)"
              :items="scopeDenyRules"
              :inherited="inheritedDenyRules"
              :validate="validateRule"
              @add="addRule('deny', $event)"
              @remove="removeScopeRule('deny', $event)"
            />
          </template>
        </SettingsCell>

        <!-- Ask Rules -->
        <SettingsCell label="Ask Rules" description="Operations that always require confirmation" :divider="true">
          <template #label>
            <div class="flex items-center gap-2">
              <span>Ask Rules</span>
              <Tooltip v-if="isListInherited('ask')" content="Inherited from a lower-priority scope">
                <Badge variant="subtle">inherited</Badge>
              </Tooltip>
            </div>
          </template>
          <template #bottom>
            <ListEditor
              label="Ask rules"
              tone="warning"
              monospace
              placeholder="e.g. Bash(git push:*)"
              :items="scopeAskRules"
              :inherited="inheritedAskRules"
              :validate="validateRule"
              @add="addRule('ask', $event)"
              @remove="removeScopeRule('ask', $event)"
            />
          </template>
        </SettingsCell>

        <!-- Allow Rules -->
        <SettingsCell label="Allow Rules" description="Operations that are auto-approved" :divider="true">
          <template #label>
            <div class="flex items-center gap-2">
              <span>Allow Rules</span>
              <Tooltip v-if="isListInherited('allow')" content="Inherited from a lower-priority scope">
                <Badge variant="subtle">inherited</Badge>
              </Tooltip>
            </div>
          </template>
          <template #bottom>
            <ListEditor
              label="Allow rules"
              tone="success"
              monospace
              placeholder="e.g. Bash(npm run *)"
              :items="scopeAllowRules"
              :inherited="inheritedAllowRules"
              :validate="validateRule"
              @add="addRule('allow', $event)"
              @remove="removeScopeRule('allow', $event)"
            />
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>

    <!-- Section 3: Additional Directories -->
    <SettingsSection title="Additional Directories">
      <SettingsSubSection caption="Extra directories to include in the permission scope, allowing Forge to access files outside the project root.">
        <SettingsCell label="Directories" description="Paths to additional allowed directories">
          <template #label>
            <div class="flex items-center gap-2">
              <span>Directories</span>
              <Tooltip v-if="isListInherited('additionalDirectories')" content="Inherited from a lower-priority scope">
                <Badge variant="subtle">inherited</Badge>
              </Tooltip>
            </div>
          </template>
          <template #bottom>
            <ListEditor
              label="Additional directories"
              monospace
              placeholder="e.g. ~/docs or ../shared"
              add-label="Add directory"
              :items="scopeAdditionalDirs"
              :inherited="inheritedAdditionalDirs"
              @add="addDir"
              @remove="removeScopeDir"
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
import Badge from '../../Common/Badge.vue';
import Dropdown from '../../Common/Dropdown.vue';
import Tooltip from '../../Common/Tooltip.vue';
import ListEditor from '../../Common/ListEditor.vue';
import { useSettingsStore } from '../../../composables/useSettingsStore';
import { useSettingsScope } from '../../../composables/useSettingsScope';

const { settings, activeProfile, inspect, updateSetting } = useSettingsStore();
const scope = useSettingsScope();

// ── Types ──

interface PermissionsConfig {
  allow?: string[];
  deny?: string[];
  ask?: string[];
  defaultMode?: string;
  additionalDirectories?: string[];
  disableBypassPermissionsMode?: string;
}

// ── Scope-aware computed ──

// Permissions at the current editing scope only (profile layer when active)
const scopePermissions = computed<PermissionsConfig>(() => {
  void settings.value;
  const meta = inspect('permissions');
  const values = meta?.values || {};
  if (activeProfile.value && scope.value === 'global') {
    return (values.profile as PermissionsConfig) || {};
  }
  return (values[scope.value] as PermissionsConfig) || {};
});

// Effective permissions (merged from all layers)
const effectivePermissions = computed<PermissionsConfig>(() => {
  const val = settings.value?.permissions;
  return (val && typeof val === 'object' ? val : {}) as PermissionsConfig;
});

// ── Default Mode ──

const defaultModeOptions = [
  { label: 'Default', value: 'default', description: 'Prompts on first use' },
  { label: 'Accept Edits', value: 'acceptEdits', description: 'Auto-accept file edits' },
  { label: 'Plan', value: 'plan', description: 'Read-only, no modifications' },
  { label: 'Delegate', value: 'delegate', description: 'Coordination-only for agent teams' },
  { label: "Don't Ask", value: 'dontAsk', description: 'Auto-deny unless pre-approved' },
  { label: 'Bypass', value: 'bypassPermissions', description: 'Skip all prompts (isolated environments only)' },
];

const defaultMode = computed(() => effectivePermissions.value.defaultMode || 'default');

const isModeInherited = computed(() => {
  return scopePermissions.value.defaultMode === undefined
    && effectivePermissions.value.defaultMode !== undefined;
});

const isModeOverridden = computed(() => {
  void settings.value;
  const meta = inspect('permissions');
  const values = meta?.values || {};
  if (scope.value === 'global') {
    const local = values.local as PermissionsConfig | undefined;
    const shared = values.shared as PermissionsConfig | undefined;
    if (local?.defaultMode !== undefined) return true;
    if (shared?.defaultMode !== undefined) return true;
  } else if (scope.value === 'shared') {
    const local = values.local as PermissionsConfig | undefined;
    if (local?.defaultMode !== undefined) return true;
  }
  return false;
});

const SCOPE_MAP: Record<string, string> = { global: 'User', shared: 'Workspace', local: 'Local' };

const modeOverriddenByLabel = computed(() => {
  void settings.value;
  const meta = inspect('permissions');
  const values = meta?.values || {};
  if (scope.value === 'global') {
    if ((values.local as PermissionsConfig)?.defaultMode !== undefined) return SCOPE_MAP.local;
    if ((values.shared as PermissionsConfig)?.defaultMode !== undefined) return SCOPE_MAP.shared;
  } else if (scope.value === 'shared') {
    if ((values.local as PermissionsConfig)?.defaultMode !== undefined) return SCOPE_MAP.local;
  }
  return '';
});

function updateDefaultMode(val: string) {
  const current = { ...scopePermissions.value };
  if (val === 'default') {
    delete current.defaultMode;
  } else {
    current.defaultMode = val;
  }
  savePermissions(current);
}

// Managed: disableBypassPermissionsMode
const bypassDisabledByManaged = computed(() => {
  void settings.value;
  const meta = inspect('permissions');
  const managed = (meta?.values?.managed as PermissionsConfig) || {};
  return managed.disableBypassPermissionsMode === 'disable';
});

// ── Rule Lists (scope-separated) ──

// Rules that exist at the current editing scope (editable)
const scopeAllowRules = computed(() => scopePermissions.value.allow || []);
const scopeDenyRules = computed(() => scopePermissions.value.deny || []);
const scopeAskRules = computed(() => scopePermissions.value.ask || []);
const scopeAdditionalDirs = computed(() => scopePermissions.value.additionalDirectories || []);

// Rules that exist in the effective value but NOT in the current scope (inherited, read-only)
const inheritedAllowRules = computed(() => {
  const effective = effectivePermissions.value.allow || [];
  const scopeSet = new Set(scopeAllowRules.value);
  return effective.filter(r => !scopeSet.has(r));
});

const inheritedDenyRules = computed(() => {
  const effective = effectivePermissions.value.deny || [];
  const scopeSet = new Set(scopeDenyRules.value);
  return effective.filter(r => !scopeSet.has(r));
});

const inheritedAskRules = computed(() => {
  const effective = effectivePermissions.value.ask || [];
  const scopeSet = new Set(scopeAskRules.value);
  return effective.filter(r => !scopeSet.has(r));
});

const inheritedAdditionalDirs = computed(() => {
  const effective = effectivePermissions.value.additionalDirectories || [];
  const scopeSet = new Set(scopeAdditionalDirs.value);
  return effective.filter(d => !scopeSet.has(d));
});

// Inherited detection per list
function isListInherited(prop: 'allow' | 'deny' | 'ask' | 'additionalDirectories'): boolean {
  const scopeArr = scopePermissions.value[prop];
  const effectiveArr = effectivePermissions.value[prop];
  return (!scopeArr || scopeArr.length === 0) && !!effectiveArr && effectiveArr.length > 0;
}

// ── Validation ──

/**
 * The shape the CLI accepts: a tool name, optionally with a parenthesised
 * pattern, or an MCP tool id. Caught here rather than written as a rule that
 * silently never matches.
 */
function validateRule(value: string): string | undefined {
  if (/^mcp__[\w-]+(__[\w-]+)?$/.test(value)) return undefined;
  if (/^[A-Z][A-Za-z]*(\(.+\))?$/.test(value)) return undefined;
  return 'Write it as a tool name, e.g. Read, or with a pattern, e.g. Bash(npm run test:*).';
}

// ── CRUD operations ──

function savePermissions(config: PermissionsConfig) {
  // Clean up: remove empty arrays and default values for delta-only writes
  const clean: PermissionsConfig = {};
  if (config.allow?.length) clean.allow = config.allow;
  if (config.deny?.length) clean.deny = config.deny;
  if (config.ask?.length) clean.ask = config.ask;
  if (config.defaultMode && config.defaultMode !== 'default') clean.defaultMode = config.defaultMode;
  if (config.additionalDirectories?.length) clean.additionalDirectories = config.additionalDirectories;
  if (config.disableBypassPermissionsMode) clean.disableBypassPermissionsMode = config.disableBypassPermissionsMode;

  updateSetting('permissions', Object.keys(clean).length ? clean : undefined, scope.value);
}

function addRule(type: 'allow' | 'deny' | 'ask', ruleRef: string) {
  const rule = ruleRef.trim();
  if (!rule) return;

  const current = { ...scopePermissions.value };
  const list = [...(current[type] || [])];
  if (list.includes(rule)) return;

  list.push(rule);
  current[type] = list;
  savePermissions(current);
}

function removeScopeRule(type: 'allow' | 'deny' | 'ask', index: number) {
  const current = { ...scopePermissions.value };
  const list = [...(current[type] || [])];
  list.splice(index, 1);
  current[type] = list;
  savePermissions(current);
}

function addDir(value: string) {
  const dir = value.trim();
  if (!dir) return;

  const current = { ...scopePermissions.value };
  const list = [...(current.additionalDirectories || [])];
  if (list.includes(dir)) return;

  list.push(dir);
  current.additionalDirectories = list;
  savePermissions(current);
}

function removeScopeDir(index: number) {
  const current = { ...scopePermissions.value };
  const list = [...(current.additionalDirectories || [])];
  list.splice(index, 1);
  current.additionalDirectories = list;
  savePermissions(current);
}
</script>

<style scoped>
/* The lists are ListEditor; the inherited row is marked by its badge, not dimmed. */
</style>
