<template>
  <SettingsTab title="Plugins">
    <!--
      The official "Manage Plugins" dialog (`fH0`), as a Settings tab: the same
      two views, rows, copy and requests, drawn in Forge's Settings style. Its
      "Restart Claude to apply plugin changes" bar becomes a note, because a
      Settings page has no session to restart; new conversations load the
      change.
    -->
    <div class="plugins__tabs" role="tablist" aria-label="Plugins and marketplaces">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="plugins__tab"
        :class="{ 'plugins__tab--active': view === tab.id }"
        :aria-selected="view === tab.id"
        @click="view = tab.id"
      >
        {{ tab.label }}<span v-if="tab.count > 0" class="plugins__tabCount">{{ tab.count }}</span>
      </button>
    </div>

    <p v-if="changed" class="plugins__note" role="status">
      <span class="codicon codicon-info" aria-hidden="true" />
      Plugin changes load in new conversations.
    </p>
    <p v-if="actionError" class="plugins__error" role="alert">
      <span>{{ actionError }}</span>
      <button type="button" class="plugins__dismiss" aria-label="Dismiss" @click="actionError = null">
        <span class="codicon codicon-close" aria-hidden="true" />
      </button>
    </p>
    <p v-if="notice" class="plugins__note" role="status">{{ notice }}</p>

    <!-- The failed update, with the official's title, message and actions. -->
    <div v-if="failure" class="plugins__failure" role="alert">
      <p class="plugins__failureTitle">{{ failure.title }}</p>
      <p class="plugins__failureMessage">{{ failure.message }}</p>
      <p v-if="failure.kind === 'needs_consent' || failure.kind === 'network' || failure.kind === 'other'" class="plugins__failureDetail">{{ failure.detail }}</p>
      <div class="plugins__failureActions">
        <Button v-if="failure.kind === 'timeout' || failure.kind === 'network' || failure.kind === 'other'" variant="secondary" size="small" @click="retryFailure">Try again</Button>
        <Button v-if="failure.kind === 'network' || failure.kind === 'other'" variant="tertiary" size="small" @click="copyFailure">Copy error</Button>
        <Button v-if="failure.kind === 'disabled'" variant="secondary" size="small" @click="enableAndUpdate">Turn on and update</Button>
        <Button v-if="failure.kind === 'not_installed'" variant="secondary" size="small" @click="failure = null; load()">Refresh list</Button>
        <Button v-if="failure.kind === 'not_found'" variant="secondary" size="small" @click="refreshAndRetry">Refresh the marketplace and retry</Button>
        <Button variant="tertiary" size="small" @click="failure = null">{{ failure.kind === 'policy' || failure.kind === 'needs_consent' ? 'OK' : 'Cancel' }}</Button>
      </div>
    </div>

    <!-- Plugins -->
    <template v-if="view === 'plugins'">
      <SettingsSection>
        <SettingsSubSection>
          <div v-if="loading && !loaded" class="plugins__state" role="status">
            <span class="codicon codicon-loading plugins__spin" aria-hidden="true" />
            Loading plugins…
          </div>
          <div v-else-if="loadError" class="plugins__state" role="alert">
            <span>Failed to load plugins: {{ loadError }}</span>
            <Button variant="tertiary" size="small" @click="load">Retry</Button>
          </div>
          <div v-else-if="!installed.length && !available.length" class="plugins__empty">
            <span class="codicon codicon-extensions plugins__emptyIcon" aria-hidden="true" />
            <p class="plugins__emptyText">No plugins available. Add a marketplace to discover plugins.</p>
            <Button variant="secondary" @click="view = 'marketplaces'">
              <template #icon><span class="codicon codicon-add" aria-hidden="true" /></template>
              Add a marketplace
            </Button>
          </div>
          <template v-else>
            <div class="plugins__search">
              <span class="codicon codicon-search plugins__searchIcon" aria-hidden="true" />
              <TextInput v-model="query" class="plugins__searchInput" placeholder="Search plugins…" aria-label="Search plugins" />
            </div>

            <template v-if="shownInstalled.length">
              <p class="plugins__sectionHeader">Installed</p>
              <ul class="plugins__list">
                <li v-for="plugin in shownInstalled" :key="installedKey(plugin)" class="plugins__item">
                  <div class="plugins__info">
                    <div class="plugins__name">
                      <span class="plugins__dot" :class="plugin.enabled ? 'plugins__dot--on' : 'plugins__dot--off'" aria-hidden="true" />
                      {{ plugin.manifest.name }}
                      <span v-if="plugin.manifest.version" class="plugins__meta">{{ plugin.manifest.version }}</span>
                    </div>
                    <div v-if="plugin.manifest.description" class="plugins__description">{{ plugin.manifest.description }}</div>
                    <div v-if="mcpServersOf(plugin).length" class="plugins__servers">
                      <span v-for="server in mcpServersOf(plugin)" :key="server" class="plugins__server" :title="`MCP server: ${server}`">
                        <span class="codicon codicon-server-process" aria-hidden="true" />{{ server }}
                      </span>
                    </div>
                  </div>
                  <div class="plugins__actions">
                    <span :title="plugin.enabled ? 'Disable plugin (stays installed but will not load)' : 'Enable plugin'">
                      <Switch
                        :model-value="plugin.enabled"
                        :aria-label="plugin.enabled ? 'Disable plugin' : 'Enable plugin'"
                        @update:model-value="setEnabled(plugin.source, $event)"
                      />
                    </span>
                    <button
                      v-if="plugin.scope && plugin.scope !== 'managed'"
                      type="button"
                      class="plugins__iconButton"
                      :aria-label="updating === installedKey(plugin) ? 'Updating…' : 'Update plugin'"
                      :title="updating === installedKey(plugin) ? 'Updating…' : 'Update plugin to the latest version'"
                      :aria-busy="updating === installedKey(plugin)"
                      @click="update(plugin)"
                    >
                      <span class="codicon" :class="updating === installedKey(plugin) ? 'codicon-loading plugins__spin' : 'codicon-refresh'" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="plugins__iconButton plugins__iconButton--danger"
                      aria-label="Uninstall plugin"
                      title="Uninstall and remove plugin"
                      @click="uninstall(plugin.source)"
                    >
                      <span class="codicon codicon-trash" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              </ul>
            </template>

            <template v-if="shownAvailable.length">
              <p class="plugins__sectionHeader">Available</p>
              <ul class="plugins__list">
                <li v-for="plugin in shownAvailable" :key="plugin.pluginId" class="plugins__item plugins__item--available">
                  <div class="plugins__info">
                    <div class="plugins__header">
                      <span class="plugins__name">{{ plugin.entry.name }}</span>
                      <span v-if="plugin.installCount" class="plugins__meta">{{ formatInstallCount(plugin.installCount) }} installs</span>
                    </div>
                    <div v-if="plugin.entry.description" class="plugins__description">{{ plugin.entry.description }}</div>
                    <div class="plugins__from">
                      from {{ plugin.marketplaceName }}
                      <span v-if="officialMarketplace(plugin.marketplaceName)" class="plugins__official" title="Official Claude Code marketplace">Official</span>
                    </div>
                    <div v-if="sourceUrlOf(plugin)" class="plugins__from">
                      Source:
                      <a :href="sourceUrlOf(plugin)!" class="plugins__link" @click.prevent="openLink(sourceUrlOf(plugin)!)">{{ sourceUrlOf(plugin) }}</a>
                    </div>

                    <Transition name="plugins-scope">
                      <div v-if="choosingScope === plugin.pluginId" class="plugins__scope">
                        <p class="plugins__trust">
                          Make sure you trust a plugin before installing, updating, or using it. Anthropic does not control what MCP servers, files, or other software are included in plugins and cannot verify that they will work as intended or that they won't change.
                        </p>
                        <button
                          v-for="option in scopeOptions"
                          :key="option.scope"
                          type="button"
                          class="plugins__scopeOption"
                          :aria-busy="installing === plugin.pluginId + option.scope"
                          @click="install(plugin.pluginId, option.scope)"
                        >
                          <span class="plugins__scopeLabel">{{ option.label }}</span>
                          <span class="plugins__scopeDescription">{{ option.description }}</span>
                          <span v-if="installing === plugin.pluginId + option.scope" class="codicon codicon-loading plugins__spin plugins__scopeSpin" aria-hidden="true" />
                        </button>
                        <button type="button" class="plugins__cancel" @click="choosingScope = null">Cancel</button>
                      </div>
                    </Transition>
                  </div>
                  <div v-if="choosingScope !== plugin.pluginId" class="plugins__actions">
                    <Button variant="secondary" size="small" @click="chooseScope(plugin.pluginId)">Install</Button>
                  </div>
                </li>
              </ul>
            </template>

            <p v-if="!shownInstalled.length && !shownAvailable.length" class="plugins__state">No plugin matches "{{ query.trim() }}".</p>
          </template>
        </SettingsSubSection>
      </SettingsSection>
    </template>

    <!-- Marketplaces -->
    <template v-else>
      <SettingsSection>
        <SettingsSubSection>
          <div v-if="loading && !loaded" class="plugins__state" role="status">
            <span class="codicon codicon-loading plugins__spin" aria-hidden="true" />
            Loading marketplaces…
          </div>
          <div v-else-if="loadError" class="plugins__state" role="alert">
            <span>Failed to load marketplaces: {{ loadError }}</span>
            <Button variant="tertiary" size="small" @click="load">Retry</Button>
          </div>
          <template v-else>
            <form class="plugins__addForm" @submit.prevent="addMarketplace">
              <TextInput
                v-model="newSource"
                class="plugins__addInput"
                placeholder="GitHub repo, URL, or path…"
                aria-label="Marketplace source"
                monospace
              />
              <Button type="submit" variant="secondary" :aria-busy="adding">
                <template #icon>
                  <span class="codicon" :class="adding ? 'codicon-loading plugins__spin' : 'codicon-add'" aria-hidden="true" />
                </template>
                {{ adding ? 'Adding…' : 'Add' }}
              </Button>
            </form>
            <p v-if="!marketplaces.length" class="plugins__state">No marketplaces configured. Add one above to discover plugins.</p>
            <ul v-else class="plugins__list">
              <li v-for="marketplace in marketplaces" :key="marketplace.name" class="plugins__item">
                <div class="plugins__info">
                  <div class="plugins__name">
                    {{ marketplace.name }}
                    <span v-if="isOfficialMarketplace(marketplace.config.source)" class="plugins__official" title="Official Claude Code marketplace">Official</span>
                  </div>
                  <div class="plugins__description">
                    <a
                      v-if="marketplaceUrl(marketplace.config.source)"
                      :href="marketplaceUrl(marketplace.config.source)!"
                      class="plugins__link"
                      @click.prevent="openLink(marketplaceUrl(marketplace.config.source)!)"
                    >{{ marketplaceSourceLabel(marketplace.config.source) }}</a>
                    <template v-else>{{ marketplaceSourceLabel(marketplace.config.source) }}</template>
                  </div>
                </div>
                <div class="plugins__actions">
                  <button
                    type="button"
                    class="plugins__iconButton"
                    aria-label="Refresh marketplace"
                    title="Refresh marketplace"
                    :aria-busy="refreshing === marketplace.name"
                    @click="refreshMarketplace(marketplace.name)"
                  >
                    <span class="codicon" :class="refreshing === marketplace.name ? 'codicon-loading plugins__spin' : 'codicon-refresh'" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="plugins__iconButton plugins__iconButton--danger"
                    :aria-label="removing === marketplace.name ? 'Removing…' : 'Remove marketplace'"
                    :title="removing === marketplace.name ? 'Removing…' : 'Remove marketplace'"
                    :aria-busy="removing === marketplace.name"
                    @click="removeMarketplace(marketplace.name)"
                  >
                    <span class="codicon" :class="removing === marketplace.name ? 'codicon-loading plugins__spin' : 'codicon-trash'" aria-hidden="true" />
                  </button>
                </div>
              </li>
            </ul>
          </template>
        </SettingsSubSection>
      </SettingsSection>
    </template>
  </SettingsTab>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import Button from '../../Common/Button.vue';
import Switch from '../../Common/Switch.vue';
import TextInput from '../../Common/TextInput.vue';
import { runHostAction, transport } from '../../../core/runtimeTransport';
import type { AvailablePlugin, InstalledPlugin, Marketplace, PluginInstallScope } from '../../../../../shared/messages';
import {
  classifyUpdateFailure,
  describeUpdateFailure,
  filterAvailable,
  filterInstalled,
  formatInstallCount,
  installedKey,
  isOfficialMarketplace,
  marketplaceSourceLabel,
  marketplaceUrl,
  pluginDisplayName,
  pluginMarketplace,
  pluginSourceUrl,
  sortAvailable,
  updateNotice,
  type UpdateFailureKind,
} from '../plugins';

const view = ref<'plugins' | 'marketplaces'>('plugins');
const loading = ref(false);
const loaded = ref(false);
const loadError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const notice = ref<string | null>(null);
const changed = ref(false);

const installed = ref<InstalledPlugin[]>([]);
const available = ref<AvailablePlugin[]>([]);
const marketplaces = ref<Marketplace[]>([]);
const query = ref('');

const choosingScope = ref<string | null>(null);
const installing = ref<string | null>(null);
const updating = ref<string | null>(null);
const refreshing = ref<string | null>(null);
const removing = ref<string | null>(null);
const newSource = ref('');
const adding = ref(false);

interface Failure {
  plugin: InstalledPlugin;
  scope: PluginInstallScope;
  kind: UpdateFailureKind;
  detail: string;
  title: string;
  message: string;
}
const failure = ref<Failure | null>(null);

const tabs = computed(() => [
  { id: 'plugins' as const, label: 'Plugins', count: installed.value.length },
  { id: 'marketplaces' as const, label: 'Marketplaces', count: marketplaces.value.length },
]);

const scopeOptions: Array<{ scope: PluginInstallScope; label: string; description: string }> = [
  { scope: 'user', label: 'Install for you', description: 'Available in all your projects' },
  { scope: 'project', label: 'Install for this project', description: 'Shared with all collaborators' },
  { scope: 'local', label: 'Install locally', description: 'Only for you, only in this repo' },
];

const shownInstalled = computed(() => filterInstalled(installed.value, query.value));
const shownAvailable = computed(() => sortAvailable(filterAvailable(available.value, query.value)));

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The official `v0`: plugins and marketplaces together; available minus what is installed. */
async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [plugins, markets] = await Promise.all([
      transport.listPlugins({ includeAvailable: true }),
      transport.listMarketplaces(),
    ]);
    const installedIds = new Set(plugins.installed.map((p) => p.source));
    installed.value = plugins.installed;
    available.value = plugins.available.filter((p) => !installedIds.has(p.pluginId));
    marketplaces.value = markets.marketplaces;
    loaded.value = true;
  } catch (error) {
    loadError.value = message(error);
  } finally {
    loading.value = false;
  }
}

/** The official `t0`: note the change, then reload the lists. */
async function afterChange(result: { needsRestart?: boolean }): Promise<void> {
  if (result.needsRestart) changed.value = true;
  await load();
}

function officialMarketplace(name: string): boolean {
  const market = marketplaces.value.find((m) => m.name === name);
  return !!market && isOfficialMarketplace(market.config.source);
}

function sourceUrlOf(plugin: AvailablePlugin): string | null {
  const market = marketplaces.value.find((m) => m.name === plugin.marketplaceName);
  return market ? pluginSourceUrl(market.config.source, plugin.source) : null;
}

function mcpServersOf(plugin: InstalledPlugin): string[] {
  return plugin.mcpServers ? Object.keys(plugin.mcpServers) : [];
}

function openLink(url: string): void {
  runHostAction('open the link', () => transport.openURL(url));
}

function chooseScope(pluginId: string): void {
  actionError.value = null;
  choosingScope.value = pluginId;
}

async function install(pluginId: string, scope: PluginInstallScope): Promise<void> {
  if (installing.value) return;
  actionError.value = null;
  installing.value = pluginId + scope;
  try {
    const result = await transport.installPlugin(pluginId, scope);
    choosingScope.value = null;
    await afterChange(result);
  } catch (error) {
    actionError.value = message(error);
  } finally {
    installing.value = null;
  }
}

async function uninstall(pluginId: string): Promise<void> {
  actionError.value = null;
  try {
    await afterChange(await transport.uninstallPlugin(pluginId));
  } catch (error) {
    actionError.value = message(error);
  }
}

async function setEnabled(pluginId: string, enabled: boolean): Promise<void> {
  if (updating.value !== null) return;
  actionError.value = null;
  try {
    await afterChange(await transport.setPluginEnabled(pluginId, enabled));
  } catch (error) {
    actionError.value = message(error);
  }
}

/** The official `L0`. */
async function update(plugin: InstalledPlugin, scope = plugin.scope as PluginInstallScope): Promise<void> {
  if (updating.value !== null) return;
  actionError.value = null;
  notice.value = null;
  failure.value = null;
  updating.value = installedKey(plugin);
  const name = pluginDisplayName(plugin);
  const fail = (reason: string) => {
    const { kind, detail } = classifyUpdateFailure(reason);
    // `B5`: "turned off" only when it really is.
    const effective = kind === 'disabled' && plugin.enabled ? 'other' : kind;
    failure.value = { plugin, scope, kind: effective, detail, ...describeUpdateFailure(effective, name, pluginMarketplace(plugin)) };
  };
  try {
    const result = await transport.updatePlugin(plugin.source, scope);
    if (result.outcome === 'failed') {
      fail(result.reason ?? '');
      return;
    }
    if (result.needsRestart) changed.value = true;
    else if (result.message !== undefined) notice.value = updateNotice(name, result.message, result.upstreamUnchecked);
    await load();
  } catch (error) {
    fail(message(error));
  } finally {
    updating.value = null;
  }
}

function retryFailure(): void {
  const f = failure.value;
  if (f) void update(f.plugin, f.scope);
}

function copyFailure(): void {
  const f = failure.value;
  if (f) void navigator.clipboard?.writeText(f.detail.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ').trim());
}

/** The official `y6`: turn it on, then update. */
async function enableAndUpdate(): Promise<void> {
  const f = failure.value;
  if (!f) return;
  failure.value = null;
  try {
    if ((await transport.setPluginEnabled(f.plugin.source, true)).needsRestart) changed.value = true;
    await load();
  } catch (error) {
    actionError.value = message(error);
    return;
  }
  await update({ ...f.plugin, enabled: true }, f.scope);
}

/** The official `C4`: refresh its marketplace, then update. */
async function refreshAndRetry(): Promise<void> {
  const f = failure.value;
  if (!f) return;
  failure.value = null;
  try {
    await transport.refreshMarketplace(pluginMarketplace(f.plugin));
  } catch (error) {
    fail2(f, message(error));
    return;
  }
  await update(f.plugin, f.scope);
}

function fail2(f: Failure, reason: string): void {
  const { kind, detail } = classifyUpdateFailure(reason);
  failure.value = { ...f, kind, detail, ...describeUpdateFailure(kind, pluginDisplayName(f.plugin), pluginMarketplace(f.plugin)) };
}

/** The official `W5`. */
async function addMarketplace(): Promise<void> {
  const source = newSource.value.trim();
  if (!source) {
    actionError.value = 'Enter a GitHub repo (owner/repo), a URL, or a path.';
    return;
  }
  if (adding.value) return;
  actionError.value = null;
  adding.value = true;
  try {
    await transport.addMarketplace(source);
    newSource.value = '';
    await load();
  } catch (error) {
    actionError.value = message(error);
  } finally {
    adding.value = false;
  }
}

/** The official `i5`. */
async function removeMarketplace(name: string): Promise<void> {
  if (removing.value) return;
  actionError.value = null;
  removing.value = name;
  try {
    await transport.removeMarketplace(name);
    await afterChange({ needsRestart: true });
  } catch (error) {
    actionError.value = message(error);
  } finally {
    removing.value = null;
  }
}

/** The official `s5`. */
async function refreshMarketplace(name: string): Promise<void> {
  if (refreshing.value) return;
  actionError.value = null;
  refreshing.value = name;
  try {
    await transport.refreshMarketplace(name);
    await load();
  } catch (error) {
    actionError.value = message(error);
  } finally {
    refreshing.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.plugins__tabs {
  border-bottom: 1px solid var(--forge-hairline);
  display: flex;
  gap: 20px;
  margin-top: -12px;
}

.plugins__tab {
  align-items: center;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--forge-text-muted);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  gap: 6px;
  margin-bottom: -1px;
  padding: 6px 0 9px;
  transition: color 120ms cubic-bezier(0.22, 1, 0.36, 1), border-color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}

.plugins__tab:hover {
  color: var(--forge-text);
}

.plugins__tab--active {
  border-bottom-color: var(--forge-text);
  color: var(--forge-text);
}

.plugins__tab:focus-visible {
  outline: 2px solid var(--forge-focus-ring);
  outline-offset: 2px;
}

.plugins__tabCount {
  color: var(--forge-text-subtle);
  font-size: 11px;
  font-weight: 600;
}

.plugins__note,
.plugins__error {
  align-items: center;
  border: 1px solid var(--forge-hairline);
  border-radius: var(--corner-radius-large);
  display: flex;
  font-size: 12px;
  gap: 8px;
  margin: -8px 0 0;
  padding: 9px 12px;
}

.plugins__note {
  background: var(--forge-surface);
  color: var(--forge-text-muted);
}

.plugins__error {
  background: var(--forge-danger-surface);
  border-color: var(--forge-danger-border);
  color: var(--forge-danger);
  justify-content: space-between;
}

.plugins__dismiss {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  padding: 0;
}

.plugins__failure {
  background: var(--forge-surface);
  border: 1px solid var(--forge-danger-border);
  border-radius: var(--corner-radius-large);
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: -8px;
  padding: 12px 14px;
}

.plugins__failureTitle {
  color: var(--forge-text);
  font-size: 12.5px;
  font-weight: 600;
  margin: 0;
}

.plugins__failureMessage {
  color: var(--forge-text-muted);
  font-size: 12px;
  margin: 0;
}

.plugins__failureDetail {
  color: var(--forge-text-subtle);
  font-family: var(--app-monospace-font-family);
  font-size: 11px;
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}

.plugins__failureActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.plugins__state {
  align-items: center;
  color: var(--forge-text-muted);
  display: flex;
  font-size: 12px;
  gap: 10px;
  margin: 0;
  padding: 14px;
}

.plugins__empty {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 30px 16px;
  text-align: center;
}

.plugins__emptyIcon {
  color: var(--forge-text-subtle);
  font-size: 22px;
}

.plugins__emptyText {
  color: var(--forge-text-muted);
  font-size: 12px;
  margin: 0;
  max-width: 44ch;
}

.plugins__search {
  padding: 12px 14px 4px;
  position: relative;
}

.plugins__searchIcon {
  color: var(--forge-field-placeholder);
  font-size: 13px;
  left: 23px;
  pointer-events: none;
  position: absolute;
  top: calc(50% + 4px);
  transform: translateY(-50%);
  z-index: 1;
}

.plugins__searchInput {
  padding-left: 28px;
  width: 100%;
}

.plugins__sectionHeader {
  color: var(--forge-text-subtle);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  margin: 0;
  padding: 14px 14px 4px;
}

.plugins__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.plugins__item {
  align-items: flex-start;
  border-top: 1px solid var(--forge-hairline);
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 12px 14px;
}

.plugins__sectionHeader + .plugins__list > .plugins__item:first-child,
.plugins__addForm + .plugins__list > .plugins__item:first-child {
  border-top: none;
}

.plugins__info {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.plugins__header {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.plugins__name {
  align-items: center;
  color: var(--forge-text);
  display: inline-flex;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-weight: 500;
  gap: 4px 8px;
}

.plugins__meta {
  color: var(--forge-text-subtle);
  font-size: 11px;
  font-weight: 600;
}

.plugins__description {
  color: var(--forge-text-muted);
  font-size: 12px;
  line-height: 17px;
}

.plugins__from {
  color: var(--forge-text-subtle);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}

.plugins__official {
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 600;
  margin-left: 6px;
}

.plugins__link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--forge-outline);
  text-underline-offset: 2px;
}

.plugins__link:hover {
  color: var(--forge-text);
  text-decoration-color: currentColor;
}

.plugins__dot {
  border-radius: 50%;
  display: inline-block;
  height: 7px;
  width: 7px;
}

.plugins__dot--on {
  background: var(--forge-success);
}

.plugins__dot--off {
  background: var(--forge-text-subtle);
}

.plugins__servers {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 2px;
}

.plugins__server {
  align-items: center;
  color: var(--forge-text-subtle);
  display: inline-flex;
  font-family: var(--app-monospace-font-family);
  font-size: 11px;
  gap: 4px;
}

.plugins__server .codicon {
  font-size: 12px;
}

.plugins__actions {
  align-items: center;
  display: flex;
  flex: none;
  gap: 6px;
}

.plugins__iconButton {
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

.plugins__iconButton:hover {
  background: var(--forge-surface-hover);
  color: var(--forge-text);
}

.plugins__iconButton--danger:hover {
  color: var(--forge-danger);
}

.plugins__iconButton[aria-busy='true'] {
  cursor: progress;
}

.plugins__iconButton:focus-visible {
  outline: 2px solid var(--forge-focus-ring);
  outline-offset: 1px;
}

.plugins__scope {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.plugins__trust {
  background: var(--forge-warning-surface);
  border: 1px solid var(--forge-warning-border);
  border-radius: var(--corner-radius-medium);
  color: var(--forge-text);
  font-size: 11.5px;
  line-height: 16px;
  margin: 0 0 2px;
  padding: 8px 10px;
}

.plugins__scopeOption {
  align-items: baseline;
  background: var(--forge-surface);
  border: 1px solid var(--forge-outline);
  border-radius: var(--corner-radius-medium);
  color: var(--forge-text);
  cursor: pointer;
  display: flex;
  flex-wrap: wrap;
  font: inherit;
  gap: 2px 10px;
  padding: 8px 10px;
  text-align: left;
  transition: background-color 120ms cubic-bezier(0.22, 1, 0.36, 1), border-color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}

.plugins__scopeOption:hover {
  background: var(--forge-surface-hover);
  border-color: var(--forge-text-subtle);
}

.plugins__scopeOption:focus-visible {
  outline: 2px solid var(--forge-focus-ring);
  outline-offset: 1px;
}

.plugins__scopeOption[aria-busy='true'] {
  cursor: progress;
}

.plugins__scopeLabel {
  font-size: 12px;
  font-weight: 500;
}

.plugins__scopeDescription {
  color: var(--forge-text-muted);
  font-size: 11.5px;
}

.plugins__scopeSpin {
  margin-left: auto;
}

.plugins__cancel {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--forge-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 2px 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.plugins__cancel:hover {
  color: var(--forge-text);
}

.plugins__addForm {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 14px;
}

.plugins__addInput {
  flex: 1 1 auto;
}

.plugins__spin {
  animation: plugins-spin 900ms linear infinite;
}

@keyframes plugins-spin {
  to { transform: rotate(360deg); }
}

.plugins-scope-enter-active {
  transition: opacity 160ms cubic-bezier(0.22, 1, 0.36, 1), transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.plugins-scope-enter-from {
  opacity: 0;
  transform: translateY(-3px);
}

@media (prefers-reduced-motion: reduce) {
  .plugins__tab,
  .plugins__iconButton,
  .plugins__scopeOption,
  .plugins-scope-enter-active {
    transition: none;
  }

  .plugins__spin {
    animation-duration: 2.4s;
  }
}
</style>
