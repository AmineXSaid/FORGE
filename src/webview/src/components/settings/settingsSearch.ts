/**
 * What the Settings search box matches, per tab.
 *
 * The tabs mount one at a time, so their rows cannot be searched in the DOM;
 * this is the index instead: each tab's setting labels (taken from the tab
 * files) plus the words someone would type looking for them ("proxy", "env",
 * "CLAUDE.md"). Kept beside the sidebar, and tested, so a new setting that is
 * not findable is a visible gap rather than a silent one.
 */

export const SETTINGS_INDEX: Record<string, readonly string[]> = {
  general: [
    'default permission mode', 'extended thinking', 'language', 'output style', 'respect .gitignore',
    'gitignore', 'teammate mode', 'plans directory', 'show turn duration', 'system notifications',
    'notifications', 'completion sound', 'sound', 'commit message', 'pr description', 'git attribution',
    'cleanup period', 'chat history', 'updates channel', 'login method', 'api key helper',
  ],
  models: [
    'default model', 'model', 'custom model', 'always thinking', 'thinking', 'effort level', 'effort',
    'model routing', 'sonnet', 'opus', 'haiku', 'fable', 'subagent model', 'max thinking tokens',
    'max output tokens', 'tokens',
  ],
  profiles: ['profile', 'profiles', 'switch profile', 'create profile'],
  plugins: ['plugin', 'plugins', 'marketplace', 'install', 'uninstall', 'enable', 'disable'],
  environments: ['environment variables', 'env', 'variable', 'environment'],
  'memory-and-rules': [
    'memory', 'claude.md', 'user memory', 'project memory', 'local memory', 'rules', 'instructions',
    'announcements', 'company announcements', 'custom agents',
  ],
  permissions: [
    'permission mode', 'default mode', 'deny', 'ask', 'allow', 'rules', 'permission rules',
    'additional directories', 'directories', 'bypass',
  ],
  sandbox: [
    'sandbox', 'enable sandbox', 'isolation', 'excluded commands', 'unsandboxed', 'unix sockets',
    'local binding', 'proxy port', 'socks',
  ],
  network: [
    'proxy', 'http proxy', 'https proxy', 'no proxy', 'mtls', 'client certificate', 'certificate',
    'client key', 'passphrase', 'tls',
  ],
  hooks: [
    'hooks', 'hook', 'pretooluse', 'posttooluse', 'userpromptsubmit', 'stop', 'notification',
    'sessionstart', 'lifecycle', 'disable all hooks',
  ],
  skills: ['skill', 'skills', 'skill.md', 'create skill'],
  agents: ['agent', 'agents', 'subagent', 'subagents', 'create agent'],
  'mcp-servers': [
    'mcp', 'mcp servers', 'server', 'add server', '.mcp.json', 'approved servers', 'rejected servers',
    'tool timeout', 'server timeout', 'auto-approve',
  ],
  'slash-commands': ['slash commands', 'commands', 'custom commands', 'create command'],
  endpoints: [
    'endpoint', 'endpoints', 'gateway', 'ollama', 'lm studio', 'vllm', 'openai', 'relay', 'model health',
    'diagnostics', 'capabilities', 'list models',
  ],
};

export interface SearchableTab {
  id: string;
  label: string;
}

/**
 * Tabs matching the query, best first: the tab's own name, then a setting
 * whose name starts with the query, then any setting containing it.
 * An empty query returns every tab, in order.
 */
export function searchSettings<T extends SearchableTab>(query: string, tabs: readonly T[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...tabs];
  const scored = tabs
    .map((tab, order) => {
      const label = tab.label.toLowerCase();
      const words = SETTINGS_INDEX[tab.id] ?? [];
      let score = -1;
      if (label === q) score = 0;
      else if (label.startsWith(q)) score = 1;
      else if (words.some((w) => w === q)) score = 2;
      else if (label.includes(q) || words.some((w) => w.startsWith(q))) score = 3;
      else if (words.some((w) => w.includes(q))) score = 4;
      return { tab, score, order };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.map((x) => x.tab);
}
