/**
 * Minimal stand-in for the VS Code extension host, so the real built webview can
 * be rendered and inspected in a browser.
 *
 * It speaks just enough of the protocol for the app to reach "connected" and
 * paint a conversation: the init handshake, a few state queries, and a canned
 * transcript streamed over the io_message channel.
 */
(function () {
  const listeners = [];
  window.__forgeSent = [];

  // The webview picks its own channel id, so the harness learns it by watching
  // what goes out rather than inventing one. Driving a surface into a state
  // (a permission prompt, a transcript) needs to address that same channel.
  let lastChannelId = null;
  let nextRequestId = 9000;

  function toWebview(message) {
    window.postMessage({ type: 'from-extension', message }, '*');
  }

  function respond(requestId, response) {
    toWebview({ type: 'response', requestId, response });
  }

  /**
   * Endpoint profiles the stub host reports on `init`.
   *
   * `0` by default because the no-endpoint empty state is the one that needs
   * looking at; `?endpoints=2` shows the other branch.
   */
  const ENDPOINT_PROFILE_COUNT =
    Number(new URLSearchParams(location.search).get('endpoints') ?? '0') || 0;
  window.__forgeEndpointProfileCount = ENDPOINT_PROFILE_COUNT;

  /**
   * Endpoint health, and the three welcome states it drives.
   *
   * `?endpoints=2&health=none` is the one worth looking at: profiles exist,
   * they were measured, and nothing answered -- the state that used to read as
   * "101 models, all good" and drop the user into a chat where nothing replies.
   *
   *   health=never  profiles, never swept       -> "Check health"
   *   health=none   swept, zero healthy         -> plus "Skip to chat"
   *   health=mixed  swept, some answered        -> no welcome at all
   */
  const HEALTH_MODE = new URLSearchParams(location.search).get('health') ?? 'never';

  function seedHealth() {
    if (ENDPOINT_PROFILE_COUNT <= 0) return [];
    const names = ['nvidia-nim', 'company-llama', 'local-ollama'].slice(0, ENDPOINT_PROFILE_COUNT);
    return names.map((profileName, index) => {
      if (HEALTH_MODE === 'never') {
        return { profileName, listed: 0, models: [], active: index === 0 };
      }
      // The measured NVIDIA shape, scaled down: listed far more than it serves.
      const healthy = HEALTH_MODE === 'none' ? 0 : 3;
      const models = [
        ...Array.from({ length: healthy }, (_, i) => ({
          id: `served-${i}`,
          servable: true,
          ms: 280 + i * 90,
          checkedAt: Date.now() - 240_000,
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `listed-only-${i}`,
          servable: false,
          ms: 60,
          detail: i === 4 ? 'listed, but accepted the request and never answered' : 'HTTP 404',
          checkedAt: Date.now() - 240_000,
        })),
      ];
      return {
        profileName,
        lastSyncedAt: Date.now() - 240_000,
        listed: 101,
        models,
        active: index === 0,
      };
    });
  }

  /** The stub's health records, so a driven row is assertable. */
  window.__forgeEndpointHealth = seedHealth();
  /** Every sweep the UI asked for: `{profileName, cancel}`. */
  window.__forgeEndpointHealthSyncs = [];

  const healthyModels = () =>
    window.__forgeEndpointHealth.reduce(
      (total, row) => total + row.models.filter((m) => m.servable).length,
      0,
    );
  const checkedProfiles = () =>
    window.__forgeEndpointHealth.filter((row) => row.lastSyncedAt !== undefined).length;

  /** Request types this stub should answer as an out-of-date host would. */
  window.__forgeRejectRequests = new Set();
  /** Every `show_notification` the webview asked for, so a failure is assertable. */
  window.__forgeNotifications = [];

  /** Push the current records, as the host's coalesced `onDidChangeHealth` does. */
  function pushEndpointHealth() {
    toWebview({
      type: 'request',
      channelId: '',
      requestId: 'push-health-' + Math.random().toString(36).slice(2),
      request: { type: 'endpoint_health_update', health: window.__forgeEndpointHealth },
    });
  }

  /**
   * Say quietly what the real host would have done.
   *
   * The stub cannot open a settings tab or a terminal, so a row that hands off
   * to VS Code has no visible effect here and reads as broken. This confirms
   * the wiring fired. It sits outside the app root, so it cannot affect a
   * probe.
   */
  function hostToast(text) {
    let el = document.getElementById('forge-host-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'forge-host-toast';
      el.style.cssText =
        'position:fixed;right:8px;bottom:8px;z-index:99999;opacity:.75;' +
        'font:11px var(--vscode-font-family,sans-serif);padding:3px 7px;' +
        'border-radius:3px;background:var(--vscode-editorWidget-background,#333);' +
        'color:var(--vscode-editorWidget-foreground,#ddd);pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = text;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), 2200);
  }

  // The CLI's `ModelInfo` rows (`sdk.d.ts` L1313, plus the CLI's @internal
  // `disabled` / `promoListPrice`), in the initialize response's order. Mock
  // data, shaped to exercise every case the picker has: a model without effort
  // (haiku), models with different effort ranges (sonnet vs opus), one with fast
  // mode (opus), one on a launch promo (opus), and one unavailable row.
  const SONNET = { resolvedModel: 'claude-sonnet-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'], supportsAdaptiveThinking: true, supportsFastMode: false, supportsAutoMode: true };
  const CLAUDE_CONFIG = {
    models: [
      { value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 5 · Efficient for routine tasks', ...SONNET },
      { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 5 · Efficient for routine tasks', ...SONNET },
      { value: 'fable', resolvedModel: 'claude-fable-5-1', displayName: 'Fable', description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks · Requires usage credits', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true, supportsFastMode: false, supportsAutoMode: true },
      { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus', description: 'Opus 5 · Best for everyday, complex tasks · $2.50/$12.50 per Mtok', promoListPrice: '$5/$25', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true, supportsFastMode: true, supportsAutoMode: true },
      { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers', supportsEffort: false, supportsAdaptiveThinking: false, supportsFastMode: false, supportsAutoMode: false },
    ],
    unavailable_models: [
      { value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]', displayName: 'Opus (1M context)', description: "Opus 5 with 1M context · Not available with your organization's data retention settings", disabled: true, supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsFastMode: true },
    ],
    // The official `config.claudeSettings`, as far as the webview reads it: the
    // CLI's `get_settings` `effective` and `applied`. Workflows on, so Ultracode
    // is offered wherever the model lists xhigh.
    claudeSettings: {
      effective: { disableWorkflows: false },
      applied: { model: 'claude-sonnet-5', effort: 'medium', advisor: null, ultracode: false },
    },
    available_output_styles: ['default'],
    output_style: 'default',
    // The CLI's initialize `commands`, in its shape (name / description /
    // argumentHint). `context` and `usage` are present so the harness proves they
    // are left out; the two `review` entries prove the official `Y55` alias rule.
    commands: [
      { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<optional custom summarization instructions>' },
      { name: 'context', description: 'Visualize current context usage as a colored grid', argumentHint: '' },
      { name: 'usage', description: 'Show plan usage limits', argumentHint: '' },
      { name: 'init', description: 'Initialize a new CLAUDE.md file with codebase documentation', argumentHint: '' },
      { name: 'review', description: 'Review a pull request', argumentHint: '', aliases: [] },
      { name: 'review', description: 'Review with the team checklist', argumentHint: '[pr]', aliases: ['team-tools:review'] },
      { name: 'security-review', description: 'Complete a security review of the pending changes on the current branch', argumentHint: '' },
    ],
  };

  // What the stub CLI "runs at", so `applied` answers like the real one: the
  // model, the effort asked for (user settings / flag layer) and the ultracode
  // flag. Like the CLI, a level the model cannot run is downgraded to the
  // model's highest, a model without effort sends none, and ultracode needs xhigh.
  const cli = { model: 'default', effortLevel: 'medium', ultracode: false, thinkingLevel: 'default_on' };

  // The stub CLI's live permission rules (`SDKControlPermissionRulesState`,
  // sdk.d.ts L4522): one of each source kind the dialog words differently.
  // `rulesPending` makes the next add/remove answer `pending: true`, as the
  // host does when the session has not re-read its settings in 14 x 300 ms.
  cli.permissionRules = {
    rules: [
      { behavior: 'allow', source: 'localSettings', rule: 'Bash(npm run build:*)', editability: 'persistent' },
      { behavior: 'allow', source: 'session', rule: 'WebFetch(domain:docs.anthropic.com)', editability: 'session' },
      { behavior: 'allow', source: 'cliArg', rule: 'Read', editability: 'session' },
      { behavior: 'deny', source: 'projectSettings', rule: 'Read(./.env)', editability: 'persistent', description: { prefix: 'Reading ', emphasis: './.env' } },
      // A profile's rule, synced into ~/.claude/forge.json (the --settings flag layer): read-only (B6).
      { behavior: 'deny', source: 'flagSettings', rule: 'Bash(rm -rf:*)', editability: 'readonly' },
    ],
    workspaceDirectories: [{ path: 'C:/Users/med-a/Music/shared', source: 'localSettings' }],
    originalCwd: 'C:/Users/med-a/Music/Claudix',
    managedOnly: false,
  };
  cli.rulesPending = false;
  // Step 17: the stub CLI's mode, whether bypass is allowed (forge.cliArgs), the
  // plan previews opened, and the page side of the preview panel.
  cli.permissionMode = 'default';
  cli.allowBypass = false;
  window.__forgePlanPreviews = [];
  window.__forgePreviewComments = [];
  const MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'];
  // What the host's `marked` makes of a plan, for the preview page.
  const PLAN_HTML =
    '<h1>Refactor the settings loader</h1>\n<p>Split <code>loadSettings</code> so each layer is read once.</p>\n' +
    '<h2>Steps</h2>\n<ol>\n<li>Add a <code>readLayer</code> helper</li>\n<li>Cache the merged result</li>\n</ol>\n' +
    '<h2>Risks</h2>\n<blockquote>\n<p>Profiles write forge.json while it is being read.</p>\n</blockquote>\n' +
    '<pre><code class="language-ts">const merged = mergeLayers(layers);\n</code></pre>\n' +
    '<table>\n<thead>\n<tr>\n<th>Layer</th>\n<th>File</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>user</td>\n<td>~/.claude/settings.json</td>\n</tr>\n</tbody></table>\n' +
    '<p>See <a href="https://code.claude.com/docs">the docs</a>.</p>\n';
  const isPreviewPage = new URLSearchParams(location.search).get('page') === 'plan-preview';
  /** Send the preview page a message as its panel would (`panel.webview.postMessage`). */
  window.__forgePreviewSend = function (message) {
    window.postMessage(message, '*');
  };
  /** Every tool-permission answer the webview sent, in order. */
  window.__forgeAnswers = [];

  // Step 18: two listed conversations and the host's per-session mode store
  // (`sessionPermissionMode:<id>` in globalState), kept in localStorage so it
  // survives a reload the way globalState survives a window reload. Opt in with
  // `?mockSessions`, so every other window's baseline keeps an empty list.
  const mockSessions = new URLSearchParams(location.search).has('mockSessions');
  const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STORED_MODES = ['default', 'acceptEdits', 'bypassPermissions'];
  const STORE_KEY = 'forge.mock.sessionPermissionModes';
  const MOCK_SESSIONS = [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', summary: 'Session A: split the settings loader', lastModified: Date.now() - 60000, gitBranch: 'feature/Settings-Loader', cwd: '/repo', fileSize: 2048, createdAt: Date.now() - 3600000, firstPrompt: 'split the settings loader' },
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', summary: 'Session B: tidy the docs', lastModified: Date.now() - 120000, gitBranch: 'docs/tidy', cwd: '/repo', fileSize: 1024, createdAt: Date.now() - 7200000, firstPrompt: 'tidy the docs' },
  ];
  // Step 20: the `custom-title` lines the host appended, kept the way the
  // transcript keeps them. `summary` prefers the latest one, as the SDK's
  // `Nu` does (`customTitle || lastPrompt || summary || firstPrompt`).
  const TITLES_KEY = 'forge.mock.sessionTitles';
  const readTitles = () => JSON.parse(localStorage.getItem(TITLES_KEY) || '{}');
  const writeTitles = (titles) => localStorage.setItem(TITLES_KEY, JSON.stringify(titles));
  window.__forgeSessionTitles = readTitles;
  window.__forgeResetSessionTitles = () => localStorage.removeItem(TITLES_KEY);
  // Step 21: the host's `hiddenSessionIds` and `sessionUnarchivedAt`
  // (globalState), kept in localStorage so they survive a reload.
  const ARCHIVED_KEY = 'forge.mock.hiddenSessionIds';
  const UNARCHIVED_AT_KEY = 'forge.mock.sessionUnarchivedAt';
  const readArchived = () => { const v = JSON.parse(localStorage.getItem(ARCHIVED_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; };
  const writeArchived = (ids) => localStorage.setItem(ARCHIVED_KEY, JSON.stringify(ids));
  const readUnarchivedAt = () => { const v = JSON.parse(localStorage.getItem(UNARCHIVED_AT_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  window.__forgeArchived = readArchived;
  window.__forgeUnarchivedAt = readUnarchivedAt;
  window.__forgeResetArchived = () => { localStorage.removeItem(ARCHIVED_KEY); localStorage.removeItem(UNARCHIVED_AT_KEY); };
  // Step 22: the host's unread keys (`sessionUnread:<scope root>` in
  // globalState), kept in localStorage so they survive a reload. The key is a
  // 1..200 character string (`bJ()`), not a UUID, so a `remote:` key
  // round-trips -- which is what the real store does.
  const UNREAD_KEY = 'forge.mock.unreadSessionKeys';
  const MAX_UNREAD = 500;
  const MAX_KEY_LEN = 200;
  const readUnread = () => {
    const v = JSON.parse(localStorage.getItem(UNREAD_KEY) || '[]');
    if (!Array.isArray(v)) return [];
    const kept = [];
    for (const k of v) if (typeof k === 'string' && k.length >= 1 && k.length <= MAX_KEY_LEN && !kept.includes(k)) kept.push(k);
    return kept.slice(-MAX_UNREAD);
  };
  const writeUnread = (keys) => localStorage.setItem(UNREAD_KEY, JSON.stringify(keys.slice(-MAX_UNREAD)));
  window.__forgeResetUnread = () => localStorage.removeItem(UNREAD_KEY);
  /** Every set_session_unread request, with whether the store changed. */
  window.__forgeUnreadLog = [];
  /**
   * The official `sendSessionStates($,Q,X,J,Y)`. `openSessionIds` is whatever
   * the harness has been told to report (the mock host runs no channels of its
   * own until `launch_claude`), so a test can seed "this session is open".
   */
  window.__forgeOpenSessionIds = [];
  const sendSessionStates = () => {
    toWebview({
      type: 'request',
      requestId: 'session-states-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      request: {
        type: 'session_states_update',
        sessions: [],
        openSessionIds: [...window.__forgeOpenSessionIds],
        unreadSessionKeys: readUnread(),
      },
    });
  };
  window.__forgeSendSessionStates = sendSessionStates;
  /** Every archive_session / unarchive_session request, with what the host did. */
  window.__forgeArchiveCalls = [];
  /** Every rename_session request, with what the host did. */
  window.__forgeRenames = [];
  /** How long list_sessions_request waits, so the spinner can be seen (step 23). */
  window.__forgeListDelayMs = 0;
  /** sessionIdentity.ts `plannedRename`: the id and title the host would write. */
  const DOS_DEVICE = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]) *(?:\.|$)/i;
  function plannedRename(sessionId, title) {
    if (typeof sessionId !== 'string' || typeof title !== 'string') return null;
    const safe = !sessionId.includes('/') && !sessionId.includes('\\') && !sessionId.includes('..')
      && !sessionId.includes('\u0000') && !/[:<>"|?*\u0000-\u001f]/.test(sessionId)
      && !DOS_DEVICE.test(sessionId) && !/[. ]$/.test(sessionId);
    if (!safe || !SESSION_ID.test(sessionId)) return null;
    const capped = [...title].slice(0, 200).join('').trim();
    return capped ? { sessionId, title: capped } : null;
  }
  const readModes = () => JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  const writeModes = (modes) => localStorage.setItem(STORE_KEY, JSON.stringify(modes));
  /** Every persist_session_permission_mode request, with what the host did. */
  window.__forgePersisted = [];
  window.__forgeSessionModes = readModes;
  // Settings > General > "Default Permission Mode" (~/.forge.json), and what the
  // host's handleUpdateExtensionConfig broadcasts when it changes.
  cli.defaultPermissionMode = 'default';
  window.__forgeSetDefaultPermissionMode = function (mode) {
    cli.defaultPermissionMode = mode;
    toWebview({ type: 'request', requestId: 'config-changed-' + Date.now(), request: { type: 'extension_config_changed', key: 'defaultPermissionMode', value: mode } });
  };
  /** sessionPermissionModes.ts `initialPermissionModeFrom`. */
  const initialPermissionMode = () => {
    const mode = cli.defaultPermissionMode === 'manual' ? 'default' : cli.defaultPermissionMode;
    if (!MODES.includes(mode) || mode === 'auto') return undefined;
    return mode === 'bypassPermissions' && !cli.allowBypass ? 'default' : mode;
  };
  window.__forgeResetSessionModes = () => localStorage.removeItem(STORE_KEY);
  /** The host's `bypassPersistGateOpen()`: allowed, and the settings read does not disable it. */
  const gateOpen = () => cli.allowBypass && CLAUDE_CONFIG.claudeSettings.effective.permissions?.disableBypassPermissionsMode !== 'disable';
  /** sessionPermissionModes.ts `persistSessionPermissionMode`, check for check. */
  function persistSessionMode({ sessionId, mode, previousSessionId, carriedFromStore }) {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return 'ignored';
    if (!MODES.includes(mode)) return 'ignored';
    const carried = carriedFromStore === true;
    const previous = typeof previousSessionId === 'string' && SESSION_ID.test(previousSessionId) ? previousSessionId : null;
    const moving = previous !== null && previous !== sessionId;
    const bypassRefused = mode === 'bypassPermissions' && !(carried && moving) && !gateOpen();
    if (bypassRefused && !moving) return 'ignored';
    const modes = readModes();
    if (moving) {
      if (carried) {
        const entry = modes[previous];
        delete modes[previous];
        if (entry && (entry.mode !== 'bypassPermissions' || gateOpen())) modes[sessionId] = { mode: entry.mode, updatedAt: Date.now() };
        writeModes(modes);
        return 'moved';
      }
      delete modes[previous];
      if (bypassRefused) { writeModes(modes); return 'cleared'; }
    }
    if (STORED_MODES.includes(mode)) modes[sessionId] = { mode, updatedAt: Date.now() };
    else delete modes[sessionId];
    writeModes(modes);
    return STORED_MODES.includes(mode) ? 'stored' : 'cleared';
  }
  /** What each channel runs: its session id and mode, for the CLI's init. */
  const channels = new Map();
  function cliInit(channelId) {
    const channel = channels.get(channelId);
    if (!channel || channel.initSent) return;
    channel.initSent = true;
    toWebview({ type: 'io_message', channelId, message: { type: 'system', subtype: 'init', session_id: channel.sessionId, permissionMode: channel.permissionMode } });
  }

  const EDITABLE = ['userSettings', 'projectSettings', 'localSettings'];
  const SOURCE_WORDS = { userSettings: 'user settings', projectSettings: 'shared project settings', localSettings: 'project local settings' };
  const isBehavior = (v) => v === 'allow' || v === 'deny' || v === 'ask';
  const rulesState = () => JSON.parse(JSON.stringify(cli.permissionRules));

  /** What `claude edit-permission-rules` does with an add: the CLI's own checks and warnings. */
  function cliAddRules(rules, behavior, destination) {
    const stored = [];
    const warnings = [];
    for (const raw of rules) {
      const rule = raw.trim();
      if (rule.length === 0) return { error: 'rules must not be empty' };
      const call = rule.match(/^([^(\s]+)\((.*)\)$/);
      const value = call && call[2] === '*' ? call[1] : rule;
      if (call && call[2] === '*') {
        warnings.push('"' + rule + '" was saved as the tool-wide rule "' + value + '", which matches every use of the tool. To limit it, put a specific pattern inside the parentheses.');
      }
      if (cli.permissionRules.rules.some((r) => r.behavior === behavior && r.source === destination && r.rule === value)) {
        return { error: '"' + value + '" is already in the ' + behavior + ' rules in ' + SOURCE_WORDS[destination] };
      }
      stored.push(value);
    }
    for (const rule of stored) cli.permissionRules.rules.push({ behavior, source: destination, rule, editability: 'persistent' });
    return { stored, warnings };
  }

  /** The CLI applying a prompt answer's `updatedPermissions` (addRules / addDirectories / setMode). */
  function applyPermissionUpdates(updates) {
    for (const u of updates || []) {
      const editability = EDITABLE.includes(u.destination) ? 'persistent' : 'session';
      if (u.type === 'addRules') {
        for (const r of u.rules) {
          const rule = r.ruleContent ? r.toolName + '(' + r.ruleContent + ')' : r.toolName;
          if (!cli.permissionRules.rules.some((e) => e.behavior === u.behavior && e.source === u.destination && e.rule === rule)) {
            cli.permissionRules.rules.push({ behavior: u.behavior, source: u.destination, rule, editability });
          }
        }
      } else if (u.type === 'addDirectories') {
        for (const path of u.directories) cli.permissionRules.workspaceDirectories.push({ path, source: u.destination });
      } else if (u.type === 'setMode') {
        cli.permissionMode = u.mode;
      }
    }
  }
  function modelRow(value) {
    return CLAUDE_CONFIG.models.find((m) => m.value === value) || CLAUDE_CONFIG.models[0];
  }
  function applied() {
    const row = modelRow(cli.model);
    const levels = row.supportsEffort ? row.supportedEffortLevels || ['low', 'medium', 'high'] : [];
    const effort = !row.supportsEffort
      ? null
      : levels.includes(cli.effortLevel)
        ? cli.effortLevel
        : levels[levels.length - 1];
    return {
      model: row.resolvedModel || row.value,
      effort,
      advisor: null,
      ultracode: cli.ultracode && levels.includes('xhigh'),
    };
  }
  window.__forgeCli = cli;

  window.acquireVsCodeApi = function () {
    return {
      postMessage(msg) {
        // Every outgoing message, so a click can be proven by what it sent.
        window.__forgeSent.push(JSON.parse(JSON.stringify(msg)));
        if (msg.channelId) lastChannelId = msg.channelId;
        // The plan preview page talks to its panel directly (`yS`), outside the transport.
        if (isPreviewPage && msg.type === 'ready') {
          window.__forgePreviewSend({ type: 'updateContent', html: PLAN_HTML });
          window.__forgePreviewSend({ type: 'setCommentsEnabled', enabled: true });
          return;
        }
        if (isPreviewPage && msg.type === 'comment') {
          window.__forgePreviewComments.push(JSON.parse(JSON.stringify(msg)));
          return;
        }
        // A prompt answer: the CLI applies what it grants (step 16).
        if (msg.type === 'response' && msg.response && msg.response.type === 'tool_permission_response') {
          window.__forgeAnswers.push(JSON.parse(JSON.stringify(msg.response.result)));
          if (msg.response.result.behavior === 'allow') applyPermissionUpdates(msg.response.result.updatedPermissions);
        }
        // The stub CLI for listed conversations (step 18): a launch opens a
        // channel; the first message makes the CLI report its init, then reply.
        if (mockSessions && msg.type === 'launch_claude') {
          channels.set(msg.channelId, {
            sessionId: msg.resume || crypto.randomUUID(),
            permissionMode: msg.permissionMode || 'default',
            initSent: false,
          });
          return;
        }
        if (mockSessions && msg.type === 'io_message' && channels.has(msg.channelId)) {
          cliInit(msg.channelId);
          const send = (m) => toWebview({ type: 'io_message', channelId: msg.channelId, message: m });
          send({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Noted.' }] } });
          send({ type: 'result', subtype: 'success' });
          return;
        }
        if (msg.type !== 'request') return;
        const { requestId, request } = msg;

        /**
         * Simulate a host that does not know a request type.
         *
         * `window.__forgeRejectRequests.add('sync_endpoint_health')` makes this
         * stub answer exactly as an out-of-date extension host does: the real
         * dispatcher ends in `default: throw new Error("Unknown request type")`.
         * That is what a VSIX with a stale `extension.cjs` did, and reproducing
         * it here is how `runHostAction` gets proved -- the row must report the
         * failure instead of looking dead.
         */
        if (window.__forgeRejectRequests?.has(request.type)) {
          console.warn('[mock-host] simulating an out-of-date host for', request.type);
          respond(requestId, { type: 'error', error: `Unknown request type: ${request.type}` });
          return;
        }

        switch (request.type) {
          case 'init':
            respond(requestId, {
              type: 'init_response',
              state: {
                defaultCwd: 'C:/Users/med-a/Music/Claudix',
                openNewInTab: false,
                modelSetting: 'default',
                platform: 'win32',
                thinkingLevel: 'default_on',
                // Settings > General > "Default Permission Mode", as the host gates it.
                initialPermissionMode: initialPermissionMode(),
                allowDangerouslySkipPermissions: cli.allowBypass,
                // How many endpoint profiles parse. `?endpoints=2` on the URL
                // drives the other branch, so both empty states are reachable.
                endpointProfileCount: ENDPOINT_PROFILE_COUNT,
                // What the welcome gate decides on: a count of models that
                // answered a real request, not of models a gateway listed.
                endpointHealthyModelCount: healthyModels(),
                endpointHealthCheckedProfileCount: checkedProfiles(),
              },
            });
            // The official `onClientInit`: broadcast the feed straight away, so
            // the list stops showing "no dot at all" (step 22).
            sendSessionStates();
            break;

          case 'get_claude_state':
            // `?models=none` serves an empty list, which is what the real host
            // sends when a profile is active and nothing it lists answered.
            respond(requestId, {
              type: 'get_claude_state_response',
              config:
                new URLSearchParams(location.search).get('models') === 'none'
                  ? { ...CLAUDE_CONFIG, models: [], unavailable_models: [] }
                  : CLAUDE_CONFIG,
            });
            break;

          case 'get_endpoint_health': {
            const { profileName } = request;
            if (profileName !== undefined) {
              const known = window.__forgeEndpointHealth.some((row) => row.profileName === profileName);
              if (!known) {
                console.warn('[mock-host] get_endpoint_health REJECTED:', profileName);
                respond(requestId, { type: 'error', error: `Unknown endpoint profile: ${profileName}` });
                break;
              }
            }
            respond(requestId, {
              type: 'get_endpoint_health_response',
              health: profileName
                ? window.__forgeEndpointHealth.filter((row) => row.profileName === profileName)
                : window.__forgeEndpointHealth,
            });
            break;
          }

          /**
           * A sweep. On the real host this is one small completion per model,
           * so the stub does the one thing that matters for the UI: it reports
           * progress, then a finished record.
           */
          case 'sync_endpoint_health': {
            const { profileName, cancel } = request;
            if (profileName !== undefined) {
              const known = window.__forgeEndpointHealth.some((row) => row.profileName === profileName);
              if (!known) {
                console.warn('[mock-host] sync_endpoint_health REJECTED:', profileName);
                respond(requestId, { type: 'error', error: `Unknown endpoint profile: ${profileName}` });
                break;
              }
            }
            window.__forgeEndpointHealthSyncs.push({ profileName, cancel: Boolean(cancel) });
            console.log('[mock-host] sync_endpoint_health', JSON.stringify({ profileName, cancel: Boolean(cancel) }));

            const targets = window.__forgeEndpointHealth.filter(
              (row) => !profileName || row.profileName === profileName,
            );

            if (cancel) {
              for (const row of targets) { delete row.syncing; delete row.checked; delete row.total; }
              hostToast('Would cancel the health check');
              respond(requestId, { type: 'sync_endpoint_health_response', health: window.__forgeEndpointHealth });
              break;
            }

            // Show the in-flight state for a beat, then the finished one, so
            // the progress counter and the Cancel button are both drivable.
            for (const row of targets) { row.syncing = true; row.checked = 0; row.total = 8; }
            pushEndpointHealth();
            hostToast(`Would sweep ${profileName ? `"${profileName}"` : 'every endpoint'}`);

            setTimeout(() => {
              for (const row of targets) {
                delete row.syncing;
                delete row.checked;
                delete row.total;
                row.lastSyncedAt = Date.now();
                row.listed = 101;
                // A re-sweep finds one model alive, whatever the row said
                // before: the transition from "none answered" to a working
                // endpoint is the thing worth being able to drive.
                row.models = [
                  { id: 'served-0', servable: true, ms: 310, checkedAt: Date.now() },
                  { id: 'listed-only-0', servable: false, ms: 55, detail: 'HTTP 404', checkedAt: Date.now() },
                ];
              }
              pushEndpointHealth();
              respond(requestId, { type: 'sync_endpoint_health_response', health: window.__forgeEndpointHealth });
            }, 400);
            break;
          }

          /**
           * `vscode.window.showInformationMessage` and friends.
           *
           * Answered here so the *failure* path is provable: when a row's
           * request is rejected, `runHostAction` reports it through this, and
           * a harness that could not answer it would make the report itself
           * disappear -- which is the bug being guarded against.
           */
          /**
           * `runHostAction`'s failure path ends here. Recorded rather than
           * rendered, because the point of the check is that the webview
           * *asked* -- a row whose request the host cannot answer must not
           * look like a row wired to nothing.
           */
          case 'show_notification':
            window.__forgeNotifications.push({
              message: request.message,
              severity: request.severity,
            });
            console.log('[mock-host] show_notification', request.severity, request.message);
            respond(requestId, { type: 'show_notification_response' });
            break;

          case 'get_current_selection':
            respond(requestId, {
              type: 'get_current_selection_response',
              selection: {
                filePath: 'src/webview/src/styles/forge-tokens.css',
                startLine: 22,
                endLine: 33,
                selectedText: ':root { --forge-brand: ... }',
              },
            });
            break;

          case 'sdk_probe':
            // `supportedModels()` is the initialize response's `models` alone.
            respond(requestId, {
              type: 'sdk_probe_response',
              data: { supportedModels: CLAUDE_CONFIG.models },
            });
            break;

          // The official `setModel`: only a malformed row is refused; the answer
          // carries no `success` (a failure is an error response).
          case 'set_model': {
            const { model } = request;
            if (typeof model !== 'object' || model === null || typeof model.value !== 'string') {
              respond(requestId, { type: 'error', error: 'set_model: malformed request' });
            } else {
              cli.model = model.value;
              console.log('[mock-host] set_model', JSON.stringify(request));
              respond(requestId, { type: 'set_model_response', applied: applied() });
            }
            break;
          }

          case 'get_asset_uris':
            respond(requestId, { type: 'asset_uris_response', assetUris: {} });
            break;

          case 'list_sessions_request': {
            if (!mockSessions) {
              respond(requestId, { type: 'list_sessions_response', sessions: [] });
              break;
            }
            // The host's list: each session's stored mode as `permissionMode`.
            const modes = readModes();
            const bypassDisabled = CLAUDE_CONFIG.claudeSettings.effective.permissions?.disableBypassPermissionsMode === 'disable';
            const titles = readTitles();
            const archivedIds = readArchived();
            const sessions = MOCK_SESSIONS.map((s) => {
              const entry = modes[s.id];
              const mode = entry && STORED_MODES.includes(entry.mode) && (entry.mode !== 'bypassPermissions' || cli.allowBypass) ? entry.mode : undefined;
              const customTitle = titles[s.id];
              const row = {
                ...s,
                archived: archivedIds.includes(s.id),
                customTitle,
                summary: customTitle || s.summary,
                worktree: undefined,
                isCurrentWorkspace: true,
              };
              return mode && !(mode === 'bypassPermissions' && bypassDisabled) ? { ...row, permissionMode: mode } : row;
            });
            const answer = () => respond(requestId, { type: 'list_sessions_response', sessions });
            if (window.__forgeListDelayMs > 0) setTimeout(answer, window.__forgeListDelayMs);
            else answer();
            break;
          }

          case 'set_session_unread': {
            // handlers.ts `handleSetSessionUnread` -> `UnreadSessionStore`:
            // a 1..200 character key and a real boolean, otherwise refused; the
            // feed is rebroadcast only when the set actually changed
            // (`return this.broadcastSessionStates(), !0`).
            const key = request.sessionKey;
            const unread = request.unread;
            const validKey = typeof key === 'string' && key.length >= 1 && key.length <= MAX_KEY_LEN;
            const validFlag = unread === true || unread === false;
            let changed = false;
            if (validKey && validFlag) {
              const keys = readUnread();
              const has = keys.includes(key);
              if (has !== unread) {
                writeUnread(unread ? [...keys.slice(Math.max(0, keys.length - (MAX_UNREAD - 1))), key] : keys.filter((k) => k !== key));
                changed = true;
              }
            }
            window.__forgeUnreadLog.push({ sessionKey: key, unread, changed });
            console.log('[mock-host] set_session_unread', JSON.stringify(request), 'changed=' + changed);
            respond(requestId, { type: 'set_session_unread_response' });
            if (changed) sendSessionStates();
            break;
          }

          case 'archive_session':
          case 'unarchive_session': {
            // handlers.ts `handleArchiveSession` / `handleUnarchiveSession`:
            // `y0($)` first, then the globalState write. Never errors.
            const archiving = request.type === 'archive_session';
            const id = typeof request.sessionId === 'string' && SESSION_ID.test(request.sessionId) ? request.sessionId : null;
            let applied = false;
            if (id !== null) {
              const ids = readArchived();
              if (archiving) {
                if (!ids.includes(id)) { writeArchived([...ids, id]); applied = true; }
              } else {
                const now = Date.now();
                const cutoff = now - 14 * 86400000;
                const times = {};
                for (const [k, v] of Object.entries(readUnarchivedAt())) if (typeof v === 'number' && Number.isFinite(v) && v > cutoff) times[k] = v;
                localStorage.setItem(UNARCHIVED_AT_KEY, JSON.stringify({ ...times, [id]: now }));
                if (ids.includes(id)) { writeArchived(ids.filter((x) => x !== id)); }
                applied = true;
              }
            }
            window.__forgeArchiveCalls.push({ ...request, applied });
            console.log('[mock-host] ' + request.type, JSON.stringify(request), 'applied=' + applied);
            respond(requestId, { type: request.type + '_response' });
            break;
          }

          case 'rename_session': {
            // handlers.ts `handleRenameSession`: validate, append one
            // custom-title line, then push `session_renamed`.
            const planned = plannedRename(request.sessionId, request.title);
            let skipped = true;
            if (planned && MOCK_SESSIONS.some((s) => s.id === planned.sessionId)) {
              const titles = readTitles();
              titles[planned.sessionId] = planned.title;
              writeTitles(titles);
              skipped = false;
            }
            window.__forgeRenames.push({ ...request, skipped });
            console.log('[mock-host] rename_session', JSON.stringify(request), 'skipped=' + skipped);
            respond(requestId, { type: 'rename_session_response', skipped });
            if (!skipped) {
              toWebview({ type: 'request', requestId: 'session-renamed-' + Date.now(), request: { type: 'session_renamed', sessionId: planned.sessionId, title: planned.title } });
            }
            break;
          }

          case 'persist_session_permission_mode': {
            const outcome = persistSessionMode(request);
            window.__forgePersisted.push({ ...request, outcome });
            console.log('[mock-host] persist_session_permission_mode', JSON.stringify(request), outcome);
            respond(requestId, { type: 'persist_session_permission_mode_response' });
            break;
          }

          case 'get_extension_config':
            respond(requestId, { type: 'get_extension_config_response', config: {} });
            break;

          case 'get_settings':
            respond(requestId, { type: 'get_settings_response', settings: {} });
            break;

          case 'get_mcp_servers':
            respond(requestId, { type: 'get_mcp_servers_response', servers: [] });
            break;

          case 'list_files_request':
            respond(requestId, { type: 'list_files_response', files: [] });
            break;

          // The same whitelist the host enforces (`tu$`, restricted to Forge's
          // scope): key must be writable, and to the layer being targeted.
          case 'apply_settings': {
            // settingsWhitelist.ts, check for check: the request shape, then each
            // key's layer and its own value check, then flagsOnly+localSettings.
            const WRITABLE = {
              effortLevel: { layer: 'userSettings', value: (v) => typeof v === 'string' },
              ultracode: { layer: 'flags', value: (v) => v === null || typeof v === 'boolean' },
            };
            const { settings, flagsOnly, scope } = request;
            let error = null;
            if (
              typeof settings !== 'object' || settings === null || Array.isArray(settings) ||
              (flagsOnly !== undefined && typeof flagsOnly !== 'boolean') ||
              (scope !== undefined && scope !== 'userSettings' && scope !== 'localSettings')
            ) {
              error = 'apply_settings: malformed request';
            } else {
              const target = flagsOnly ? 'flags' : scope === 'localSettings' ? 'localSettings' : 'userSettings';
              for (const [key, value] of Object.entries(settings)) {
                const entry = Object.hasOwn(WRITABLE, key) ? WRITABLE[key] : undefined;
                if (!entry) {
                  error =
                    `apply_settings: ${JSON.stringify(key)} cannot be written from the webview; ` +
                    'add it to WEBVIEW_WRITABLE_SETTINGS in settingsWhitelist.ts if a webview control needs it';
                  break;
                }
                if (entry.layer !== target || !entry.value(value)) {
                  error = `apply_settings: unexpected value or target for ${JSON.stringify(key)}`;
                  break;
                }
              }
              if (!error && flagsOnly && scope === 'localSettings') error = 'flagsOnly and localSettings scope are exclusive';
            }
            if (error) {
              respond(requestId, { type: 'error', error });
            } else {
              if (typeof settings.effortLevel === 'string') cli.effortLevel = settings.effortLevel;
              if ('ultracode' in settings) cli.ultracode = settings.ultracode === true;
              console.log('[mock-host] apply_settings', JSON.stringify(request));
              respond(requestId, { type: 'apply_settings_response' });
            }
            break;
          }

          // The official `setThinkingLevel`, with the host's check: only the two
          // levels the webview sends. The answer carries no `success`.
          case 'set_thinking_level': {
            const { thinkingLevel } = request;
            if (thinkingLevel !== 'off' && thinkingLevel !== 'default_on') {
              respond(requestId, {
                type: 'error',
                error: `set_thinking_level: unexpected thinking level ${JSON.stringify(thinkingLevel)}`,
              });
            } else {
              cli.thinkingLevel = thinkingLevel;
              console.log('[mock-host] set_thinking_level', JSON.stringify(request));
              respond(requestId, { type: 'set_thinking_level_response' });
            }
            break;
          }

          // The official permission-rule requests (step 16). Every answer is
          // in-band: a bad shape is `error: "invalid request"`, a refused write
          // is the CLI's message, never an error response.
          case 'list_permission_rules':
            respond(requestId, { type: 'list_permission_rules_response', state: rulesState() });
            break;

          case 'add_permission_rules': {
            const { rules, behavior, destination } = request;
            const ok =
              Array.isArray(rules) && rules.length >= 1 && rules.length <= 100 &&
              !rules.some((r) => typeof r !== 'string' || r.length > 1e4) &&
              isBehavior(behavior) && EDITABLE.includes(destination);
            if (!ok) {
              respond(requestId, { type: 'add_permission_rules_response', error: 'invalid request' });
              break;
            }
            const result = cliAddRules(rules, behavior, destination);
            console.log('[mock-host] add_permission_rules', JSON.stringify(request));
            if (result.error) {
              respond(requestId, { type: 'add_permission_rules_response', error: result.error });
            } else {
              respond(requestId, {
                type: 'add_permission_rules_response',
                state: rulesState(),
                ...(cli.rulesPending && { pending: true }),
                ...(result.warnings.length > 0 && { warnings: result.warnings }),
              });
            }
            break;
          }

          case 'remove_permission_rule': {
            const { rule, behavior, source } = request;
            const ok = typeof rule === 'string' && rule.length > 0 && rule.length <= 1e4 && isBehavior(behavior) && EDITABLE.includes(source);
            if (!ok) {
              respond(requestId, { type: 'remove_permission_rule_response', error: 'invalid request' });
              break;
            }
            const at = cli.permissionRules.rules.findIndex((r) => r.behavior === behavior && r.source === source && r.rule === rule);
            console.log('[mock-host] remove_permission_rule', JSON.stringify(request));
            if (at === -1) {
              respond(requestId, {
                type: 'remove_permission_rule_response',
                error: 'rule not found: no ' + behavior + ' rule with this exact value in ' + SOURCE_WORDS[source] + ' (rules are matched verbatim, as the listing reports them; the file may have been changed outside this dialog)',
              });
            } else {
              cli.permissionRules.rules.splice(at, 1);
              respond(requestId, { type: 'remove_permission_rule_response', state: rulesState(), ...(cli.rulesPending && { pending: true }) });
            }
            break;
          }

          // The official `setPermissionMode` (step 17): an unknown mode, or bypass
          // while it is not allowed, is `success: false`; the answer always says.
          case 'set_permission_mode': {
            const { mode, userInitiated } = request;
            const ok = MODES.includes(mode) && (mode !== 'bypassPermissions' || cli.allowBypass);
            if (ok) cli.permissionMode = mode;
            if (ok && channels.has(msg.channelId)) channels.get(msg.channelId).permissionMode = mode;
            console.log('[mock-host] set_permission_mode', JSON.stringify({ mode, userInitiated }), ok);
            respond(requestId, { type: 'set_permission_mode_response', success: ok });
            break;
          }

          // The plan preview requests (step 17).
          case 'open_markdown_preview':
            window.__forgePlanPreviews.push({ ...request, open: true });
            respond(requestId, { type: 'open_markdown_preview_response' });
            break;
          case 'close_plan_preview':
            for (const preview of window.__forgePlanPreviews) if (preview.channelId === request.channelId) preview.open = false;
            respond(requestId, { type: 'close_plan_preview_response' });
            break;
          case 'remove_plan_comment':
            respond(requestId, { type: 'remove_plan_comment_response' });
            break;
          case 'get_plan_comments':
            respond(requestId, { type: 'get_plan_comments_response', comments: [] });
            break;

          // The official `get_applied_settings`: what the CLI says it runs at.
          case 'get_applied_settings':
            respond(requestId, { type: 'get_applied_settings_response', applied: applied() });
            break;

          // The official host validates with `JI0` before it launches anything,
          // so the stub validates too: a rejection here is a rejection there.
          case 'open_claude_in_terminal': {
            const slashCommand = /^\/[a-z][a-z-]{0,63}$/;
            const sessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const { prompt, args } = request;
            const promptOk = prompt === undefined || (typeof prompt === 'string' && slashCommand.test(prompt));
            const argsOk =
              args === undefined ||
              (Array.isArray(args) &&
                (args.length === 0 ||
                  (args.length === 2 && args[0] === '--resume' && typeof args[1] === 'string' && sessionId.test(args[1]))));
            if (!promptOk || !argsOk) {
              respond(requestId, {
                type: 'error',
                error:
                  'open_claude_in_terminal: only a bare slash command and --resume <session id> can be passed from the webview',
              });
            } else {
              console.log('[mock-host] open_claude_in_terminal', JSON.stringify(request));
              respond(requestId, { type: 'open_claude_in_terminal_response' });
            }
            break;
          }

          default:
            // Everything else gets an empty acknowledgement so nothing hangs.
            respond(requestId, { type: (request.type || 'unknown') + '_response' });
        }
      },
      getState() { return undefined; },
      setState() {},
    };
  };

  // A canned transcript, pushed in once the app has connected.
  window.__forgeSeedTranscript = function (channelId) {
    const send = (m) => toWebview({ type: 'io_message', channelId, message: m });
    send({
      type: 'user',
      message: { role: 'user', content: 'Is this the same chatbox as the Claude Code VS Code extension?' },
    });
    send({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'It is now - the structure came from the official index.js, not from guessing at the CSS.' }],
      },
    });
  };

  /**
   * Push a tool-permission request at the webview, exactly as the extension host
   * does: a `request` message whose `request.type` is `tool_permission_request`.
   * The app answers with a `response`, which this stub simply drops -- the point
   * is to hold the dialog on screen long enough to measure it.
   */
  window.__forgeSeedPermission = function (options) {
    const opts = options || {};
    toWebview({
      type: 'request',
      requestId: String(nextRequestId++),
      channelId: opts.channelId ?? lastChannelId,
      request: {
        type: 'tool_permission_request',
        toolName: opts.toolName ?? 'Bash',
        inputs: opts.inputs ?? {
          command: 'pnpm run build',
          description: 'Build the extension and webview',
        },
        suggestions: opts.suggestions ?? [],
        // The `CanUseTool` options the official host forwards (step 16).
        ...(opts.defaultToNo !== undefined && { defaultToNo: opts.defaultToNo }),
        ...(opts.suppressAlwaysAllowRule !== undefined && { suppressAlwaysAllowRule: opts.suppressAlwaysAllowRule }),
        ...(opts.toolUseId !== undefined && { toolUseId: opts.toolUseId }),
        ...(opts.agentId !== undefined && { agentId: opts.agentId }),
      },
    });
  };

  /** A comment made in the plan preview, as the host pushes it (`plan_comment`). */
  window.__forgeSeedPlanComment = function (comment, channelId) {
    toWebview({ type: 'plan_comment', channelId: channelId ?? lastChannelId, comment });
  };

  /** The channel the app actually opened, for callers driving it by hand. */
  window.__forgeChannelId = function () {
    return lastChannelId;
  };

  console.log('[mock-host] ready');
})();
