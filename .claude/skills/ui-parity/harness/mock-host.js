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

  /** What the rows that hand off to VS Code did, for assertions. */
  window.__forgeConfigOpens = [];
  window.__forgeSettingsOpens = [];
  window.__forgeOpenedUrls = [];
  /** Search strings `open_config` would filter the settings editor by. */
  window.__forgeConfigSearches = [];
  /** Endpoint actions the Endpoints tab asked for, by name. */
  window.__forgeEndpointActions = [];
  /** `reveal_chat` asks, so the sessions view's routing is assertable. */
  window.__forgeRevealChat = [];
  /** Every `show_notification` the webview asked for, so a failure is assertable. */
  window.__forgeNotifications = [];
  /**
   * Endpoint profiles the stub host reports on `init`.
   *
   * `0` by default because the no-endpoint empty state is the one that needs
   * looking at; `?endpoints=2` shows the other branch.
   */
  let ENDPOINT_PROFILE_COUNT =
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

  /** The init state, as `buildInitState` builds it on the real host. */
  function initState() {
    return {
      defaultCwd: 'C:/Users/med-a/Music/Claudix',
      openNewInTab: false,
      modelSetting: 'omniroute',
      platform: 'win32',
      thinkingLevel: 'default_on',
      initialPermissionMode: initialPermissionMode(),
      allowDangerouslySkipPermissions: cli.allowBypass,
      endpointProfileCount: ENDPOINT_PROFILE_COUNT,
      endpointHealthyModelCount: healthyModels(),
      endpointHealthCheckedProfileCount: checkedProfiles(),
      browserIntegrationSupported,
      focusViewEnabled: focusView.enabled,
    };
  }

  /** The real host's `pushStateUpdate()`: the whole state and the model config. */
  function pushStateUpdate() {
    toWebview({
      type: 'request',
      channelId: '',
      requestId: `push-${nextRequestId++}`,
      request: { type: 'update_state', state: initState(), config: CLAUDE_CONFIG },
    });
  }
  window.__forgePushStateUpdate = pushStateUpdate;

  /**
   * Any host push, as the real host's `notifyClient` sends it: e.g.
   * `{type:'ui_command', command:'arrive'}` then `{type:'visibility_changed',
   * isVisible:true}` plays the chat's side of the history hand-off.
   */
  window.__forgeHostPush = (request) =>
    toWebview({ type: 'request', channelId: '', requestId: `push-${nextRequestId++}`, request });

  /** The real host's `sendSessionStoreChanged()`: a transcript appeared or went. */
  window.__forgePushStoreChanged = () =>
    toWebview({
      type: 'request',
      channelId: '',
      requestId: `push-${nextRequestId++}`,
      request: { type: 'session_store_changed' },
    });

  /**
   * Endpoint profiles appearing or disappearing, as a settings edit does: the
   * count changes and the host pushes `update_state`.
   */
  window.__forgeSetEndpointCount = (count) => {
    ENDPOINT_PROFILE_COUNT = count;
    window.__forgeEndpointProfileCount = count;
    pushStateUpdate();
  };

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

  /** Skills and agents the stub lists; empty by default, the state worth seeing first. */
  window.__forgeItems = { skills: [], agents: [], commands: [] };
  // Settings > Plugins: the stub CLI's marketplace, catalog and installs.
  window.__plugins = {
    marketplaces: [
      { name: 'claude-plugins-official', config: { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } }, pluginCount: 0, installedCount: 0 },
    ],
    catalog: [
      { entry: { name: 'github', description: 'Work with GitHub issues, pull requests and reviews from the conversation.' }, marketplaceName: 'claude-plugins-official', pluginId: 'github@claude-plugins-official', source: './plugins/github', installCount: 48210 },
      { entry: { name: 'commit-commands', description: 'Commands for committing, pushing and opening pull requests.' }, marketplaceName: 'claude-plugins-official', pluginId: 'commit-commands@claude-plugins-official', source: './plugins/commit-commands', installCount: 12944 },
      { entry: { name: 'code-review', description: 'Review a diff for bugs, missing tests and style before it is merged.' }, marketplaceName: 'claude-plugins-official', pluginId: 'code-review@claude-plugins-official', source: './plugins/code-review', installCount: 3211 },
    ],
    installed: [],
  };

  /** Request types this stub should answer as an out-of-date host would. */
  window.__forgeRejectRequests = new Set();
  window.__forgeNewTabs = [];

  /**
   * Say quietly what the real host would have done.
   *
   * The stub cannot open a settings tab or a browser, so a row that hands off
   * to VS Code has no visible effect here and reads as broken. This confirms
   * the wiring fired.
   *
   * It sits outside the app root, so it cannot affect a probe, and it is
   * styled to disappear into the theme rather than shout: the first cut was a
   * green-on-black terminal banner across the middle of the window, which read
   * as an error to anyone actually driving the UI instead of measuring it.
   */
  function hostToast(text) {
    let el = document.getElementById('mock-host-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mock-host-toast';
      el.setAttribute('data-mock-host', '1');
      el.style.cssText =
        'position:fixed;right:10px;bottom:10px;z-index:2147483647;' +
        'background:rgba(40,40,40,.92);color:#9d9d9d;' +
        'border:1px solid rgba(255,255,255,.09);border-radius:5px;' +
        'font:10.5px/1.5 -apple-system,system-ui,sans-serif;padding:5px 9px;' +
        'pointer-events:none;max-width:60vw;white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis;box-shadow:0 2px 10px rgba(0,0,0,.35);' +
        'transition:opacity .3s ease';
      document.documentElement.appendChild(el);
    }
    // The label is dimmer than the value: the value is the thing being checked.
    el.innerHTML =
      '<span style="opacity:.55">harness · </span>' +
      String(text).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 2200);
  }

  function respond(requestId, response) {
    toWebview({ type: 'response', requestId, response });
  }

  // The picker's rows, as the real host serves them since 2026-09-23: one per
  // endpoint profile, each the endpoint with its one model (`pairRow`). The
  // value is the profile name; what the user reads is the model. Shaped to keep
  // every case the picker has: a pair without effort (the local model), pairs
  // with different effort ranges, one with fast mode and xhigh (Ultracode), and
  // one whose last health check failed (it stays, with the reason).
  const PAIR = { supportsAdaptiveThinking: true, supportsAutoMode: false };
  const CLAUDE_CONFIG = {
    models: [
      { value: 'omniroute', resolvedModel: 'auto', displayName: 'auto', description: 'omniroute · localhost:20128 · answered in 1.4s', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'], supportsFastMode: false, ...PAIR, active: true },
      { value: 'gateway-opus', resolvedModel: 'claude-opus-5', displayName: 'claude-opus-5', description: 'gateway-opus · llm.internal.example · answered in 2.1s', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsFastMode: true, ...PAIR },
      { value: 'ollama-qwen', resolvedModel: 'qwen3-coder', displayName: 'qwen3-coder', description: 'ollama-qwen · localhost:11434 · answered in 820ms', supportsEffort: false, supportsFastMode: false, supportsAdaptiveThinking: false, supportsAutoMode: false },
      { value: 'vllm-llama', resolvedModel: 'llama-3.3-70b', displayName: 'llama-3.3-70b', description: 'vllm-llama · gpu-box:8000 · did not answer: connect ECONNREFUSED', supportsEffort: false, supportsFastMode: false, supportsAdaptiveThinking: false, supportsAutoMode: false },
    ],
    // Never the CLI's Anthropic table: the real host deletes it.
    unavailable_models: [],
    // The official `config.claudeSettings`, as far as the webview reads it: the
    // CLI's `get_settings` `effective` and `applied`. Workflows on, so Ultracode
    // is offered wherever the model lists xhigh.
    claudeSettings: {
      // `?bypassPolicy=disable`: a managed policy that bars bypass, so the mode
      // menu hides the row and `enable_bypass_permissions` refuses.
      effective: {
        disableWorkflows: false,
        ...(new URLSearchParams(location.search).get('bypassPolicy') === 'disable' && {
          permissions: { disableBypassPermissionsMode: 'disable' },
        }),
      },
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
  const cli = { model: 'omniroute', effortLevel: 'medium', ultracode: false, thinkingLevel: 'default_on' };

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
  // Step 28: the host's `browserIntegrationSupported` on the init state. On by
  // default so the "+" row is reachable; `?noBrowser` is the unsupported build
  // (no Claude binary), where the row must not appear at all.
  const browserIntegrationSupported = !new URLSearchParams(location.search).has('noBrowser');
  // The host's chrome state per channel (`chromeMcpState`), and the tabs the
  // stub `tabs_context_mcp {createIfEmpty:true}` hands back.
  const chromeMcpState = new Map();
  let nextTabId = 100;
  /** Every browser request the webview sent, in order. */
  window.__forgeBrowserLog = [];
  /** Step 29: the CLI's style list, and the style `getSettings().effective` reports. */
  const outputStyles = { current: 'default', available: ['default', 'Explanatory', 'Learning'] };
  /**
   * Exposed so a harness run can put the two sides out of step on purpose --
   * a style on disk that this webview has not been told about is the only way
   * to reach the host's `{kind:"exists"}` answer, since the wizard's own check
   * would otherwise catch the name first.
   */
  window.__forgeOutputStyles = outputStyles;
  /** Step 31: every `open_forge_settings`, with the tab asked for and the tab opened. */
  window.__forgeSettingsOpens = [];
  /** Step 32: what `open_config` searched for, what `open_help` opened, and every `open_config_file`. */
  window.__forgeConfigOpens = [];
  window.__forgeHelpOpens = [];
  window.__forgeConfigFileOpens = [];
  /** Every output-style request the webview sent, in order. */
  window.__forgeOutputStyleLog = [];
  /** Make the next `create_output_style` answer without `availableStyles` (the CLI did not reload). */
  window.__forgeOutputStyleNoReload = false;
  /** Step 30: the persisted `focusView` preference the init state reports. */
  const focusView = { enabled: false };
  window.__forgeFocusView = focusView;
  /** Every `set_focus_view` the webview sent, in order. */
  window.__forgeFocusViewLog = [];
  /** Make the next `ensure_chrome_mcp_enabled` fail the way `setMcpServers` errors do. */
  window.__forgeChromeMcpError = null;
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

  // Step 24: the stub CLI's file checkpoints, i.e. what `query.rewindFiles()`
  // would answer. Keyed by the user message uuid the transcript carries, so a
  // dry run and the real run that follows it agree. Overwrite an entry to drive
  // a case: `canRewind:false` for "no checkpoint", `error` for the official's
  // throwing path, `skippedLinks` for the link-safety warning.
  const MSG_U1 = '11111111-0000-4000-8000-000000000001';
  const MSG_A1 = '22222222-0000-4000-8000-000000000001';
  const MSG_U2 = '11111111-0000-4000-8000-000000000002';
  const MSG_A2 = '22222222-0000-4000-8000-000000000002';
  window.__forgeMessageUuids = { U1: MSG_U1, A1: MSG_A1, U2: MSG_U2, A2: MSG_A2 };
  window.__forgeCheckpoints = {
    [MSG_U1]: {
      canRewind: true,
      filesChanged: ['/repo/src/settings/loader.ts', '/repo/src/settings/index.ts', '/repo/test/loader.spec.ts'],
      insertions: 42,
      deletions: 17,
    },
    // The "code has not changed" branch of the `mo` dialog: it can rewind, but
    // there is nothing to restore.
    [MSG_U2]: { canRewind: true, filesChanged: [], insertions: 0, deletions: 0 },
  };
  /** Every rewind_code request, with what the stub did about it. */
  window.__forgeRewindLog = [];
  /** Every fork_conversation request, with whether the stub refused it (step 25). */
  window.__forgeForks = [];
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

  /**
   * The host's `endpoint_health_update` push, on the same shape: a `request`
   * nothing answers. It is how a sweep started in Settings fills in the welcome
   * page behind it, so the stub sends it rather than making the UI poll.
   */
  const pushEndpointHealth = () => {
    toWebview({
      type: 'request',
      requestId: 'endpoint-health-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      request: { type: 'endpoint_health_update', health: window.__forgeEndpointHealth },
    });
  };
  window.__forgePushEndpointHealth = pushEndpointHealth;
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
          const sessionId = msg.resume || crypto.randomUUID();
          channels.set(msg.channelId, {
            sessionId,
            permissionMode: msg.permissionMode || 'default',
            initSent: false,
          });
          // A live session has a transcript on disk like any other, so it is
          // listable and forkable. Without this the stub refused to fork the
          // conversation you are actually in (step 25).
          if (!MOCK_SESSIONS.some((s) => s.id === sessionId)) {
            MOCK_SESSIONS.push({
              id: sessionId,
              summary: 'Untitled',
              lastModified: Date.now(),
              gitBranch: 'feature/Settings-Loader',
              cwd: '/repo',
              fileSize: 512,
              createdAt: Date.now(),
              firstPrompt: '',
            });
          }
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
         * `window.__forgeRejectRequests.add('open_forge_settings')` makes this stub
         * answer exactly as an out-of-date extension host does -- the real
         * dispatcher ends in `default: throw new Error("Unknown request type:
         * " + type)`. That is what a VSIX with a stale `extension.cjs` did, and
         * the point of reproducing it here is to prove the row now reports the
         * failure instead of silently closing the menu.
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
              state: initState(),
            });
            // The official `onClientInit`: broadcast the feed straight away, so
            // the list stops showing "no dot at all" (step 22).
            sendSessionStates();
            break;

          case '__unused_init_shape':
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
                // drives the other branch, so both empty states are reachable:
                // 0 offers to set one up, anything else falls back to the
                // rotation. Defaults to 0, the state worth looking at.
                endpointProfileCount: ENDPOINT_PROFILE_COUNT,
                // What the welcome gate decides on: a count of models that
                // answered a real request, not of models a gateway listed.
                endpointHealthyModelCount: healthyModels(),
                endpointHealthCheckedProfileCount: checkedProfiles(),
                // Step 28: `isBrowserIntegrationSupported()` -- for Forge, "the
                // Claude binary resolves", since the browser MCP server is that
                // binary run with `--claude-in-chrome-mcp`.
                browserIntegrationSupported,
                // Step 30: the persisted `focusView`, so a reload comes back in
                // focus view exactly as the host reports it.
                focusViewEnabled: focusView.enabled,
              },
            });
            // The official `onClientInit`: broadcast the feed straight away, so
            // the list stops showing "no dot at all" (step 22).
            sendSessionStates();
            break;

          case 'get_claude_state':
            // `provisional: false` is the honest answer here: this config is
            // complete, so the webview has nothing to chase. Flip it (and empty
            // `models`) to watch the picker recover from a cut-short probe --
            // the real host sends it when a budget ran out mid-handshake.
            //
            // `?models=none` serves an empty list, which is what the real host
            // sends when a profile is active and nothing it lists is offered.
            // It is the only way to reach welcome state B in the harness: the
            // gate reads the picker, and this stub's picker is always full.
            respond(requestId, {
              type: 'get_claude_state_response',
              config:
                new URLSearchParams(location.search).get('models') === 'none'
                  ? { ...CLAUDE_CONFIG, models: [], unavailable_models: [] }
                  : CLAUDE_CONFIG,
              provisional: false,
            });
            break;

          case 'get_current_selection':
            // The official `Ri(...)` shape. Drop `selectedText` (and set
            // `endLine === startLine`) to get the other arm: that is a cursor
            // with nothing highlighted, which sends `<ide_opened_file>` rather
            // than `<ide_selection>`. Returning `null` here is "no editor at
            // all", not "nothing selected" -- the two used to be conflated.
            respond(requestId, {
              type: 'get_current_selection_response',
              selection: {
                filePath: 'src/webview/src/styles/forge-tokens.css',
                sourceUri: 'file:///src/webview/src/styles/forge-tokens.css',
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
              data: { supportedModels: CLAUDE_CONFIG.models, supportedCommands: CLAUDE_CONFIG.commands, mcpServerStatus: [] },
            });
            break;

          // The official `setModel`: only a malformed row is refused; the answer
          // carries no `success` (a failure is an error response).
          case 'set_model': {
            const { model } = request;
            if (typeof model !== 'object' || model === null || typeof model.value !== 'string') {
              respond(requestId, { type: 'error', error: 'set_model: malformed request' });
            } else if (!CLAUDE_CONFIG.models.some((m) => m.value === model.value)) {
              // As the host refuses it: only a pair it knows (B3).
              respond(requestId, { type: 'error', error: `Unknown endpoint: ${model.value}` });
            } else {
              // A row is an endpoint and its model: choosing one selects that
              // endpoint (the host writes forge.endpointProfile), with or
              // without a channel, and the in-use mark moves with it.
              cli.model = model.value;
              for (const row of CLAUDE_CONFIG.models) row.active = row.value === model.value;
              console.log('[mock-host] set_model', JSON.stringify(request));
              respond(requestId, { type: 'set_model_response' });
            }
            break;
          }

          case 'get_asset_uris':
            respond(requestId, { type: 'asset_uris_response', assetUris: {} });
            break;

          case 'list_sessions_request': {
            // `__forgeListFails` answers as the host does when the store cannot
            // be read: an empty list with an error beside it. `__forgeListHangs`
            // never answers, which is what a stopped message loop looked like.
            if (window.__forgeListHangs) break;
            if (window.__forgeListFails) {
              respond(requestId, { type: 'list_sessions_response', sessions: [], error: 'EACCES: permission denied' });
              break;
            }
            if (!mockSessions) {
              respond(requestId, { type: 'list_sessions_response', sessions: window.__forgeExtraSessions ?? [] });
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

          case 'rewind_code': {
            // ClaudeAgentService.rewindCode -> planRewindCode -> withChannel ->
            // query.rewindFiles(userMessageId, {dryRun}). A bad uuid or a
            // non-boolean dryRun is refused locally as `canRewind:false`;
            // `result.error` is **thrown**, which on the wire is the host's
            // `{type:"error",error}` -- the official `if(z.error)throw Error(z.error)`.
            const id = request.userMessageId;
            const dryRun = request.dryRun;
            const validId = typeof id === 'string' && SESSION_ID.test(id);
            const validFlag = dryRun === undefined || dryRun === true || dryRun === false;
            const cp = validId ? window.__forgeCheckpoints[id] : undefined;
            const refused = !validId || !validFlag;
            window.__forgeRewindLog.push({ userMessageId: id, dryRun, refused, found: !!cp });
            console.log('[mock-host] rewind_code', JSON.stringify(request), 'refused=' + refused);
            if (refused || !cp) {
              respond(requestId, { type: 'rewind_code_response', canRewind: false });
              break;
            }
            if (cp.error) {
              respond(requestId, { type: 'error', error: cp.error });
              break;
            }
            const out = { type: 'rewind_code_response', canRewind: cp.canRewind !== false };
            if (cp.filesChanged !== undefined) out.filesChanged = cp.filesChanged;
            if (cp.insertions !== undefined) out.insertions = cp.insertions;
            if (cp.deletions !== undefined) out.deletions = cp.deletions;
            // sdk.d.ts:3131 -- only ever populated by a real (non-dryRun) rewind.
            if (dryRun !== true && cp.skippedLinks !== undefined) out.skippedLinks = cp.skippedLinks;
            respond(requestId, out);
            break;
          }

          // Step 28. The two chrome requests are channel-scoped and the host
          // throws `channelId is required for <type>` without one;
          // `create_new_browser_tab` is not scoped at all.
          case 'ensure_chrome_mcp_enabled': {
            if (!msg.channelId) {
              respond(requestId, { type: 'error', error: 'channelId is required for ensure_chrome_mcp_enabled' });
              break;
            }
            const state = chromeMcpState.get(msg.channelId) || 'disconnected';
            const wasDisabled = state === 'disconnected';
            window.__forgeBrowserLog.push({ type: 'ensure_chrome_mcp_enabled', channelId: msg.channelId, wasDisabled });
            console.log('[mock-host] ensure_chrome_mcp_enabled', msg.channelId, 'wasDisabled=' + wasDisabled);
            if (window.__forgeChromeMcpError) {
              // `setMcpServers` reporting an error: the official joins the map
              // and throws, which reaches the webview as `{type:"error"}`.
              chromeMcpState.set(msg.channelId, 'error');
              respond(requestId, { type: 'error', error: window.__forgeChromeMcpError });
              break;
            }
            chromeMcpState.set(msg.channelId, 'connected');
            respond(requestId, { type: 'ensure_chrome_mcp_enabled_response', wasDisabled });
            break;
          }

          case 'disable_chrome_mcp': {
            if (!msg.channelId) {
              respond(requestId, { type: 'error', error: 'channelId is required for disable_chrome_mcp' });
              break;
            }
            const wasEnabled = (chromeMcpState.get(msg.channelId) || 'disconnected') === 'connected';
            chromeMcpState.set(msg.channelId, 'disconnected');
            window.__forgeBrowserLog.push({ type: 'disable_chrome_mcp', channelId: msg.channelId, wasEnabled });
            console.log('[mock-host] disable_chrome_mcp', msg.channelId, 'wasEnabled=' + wasEnabled);
            respond(requestId, { type: 'disable_chrome_mcp_response', wasEnabled });
            break;
          }

          case 'create_new_browser_tab': {
            const tab = { tabGroupId: 'group-1', tabId: nextTabId++ };
            window.__forgeBrowserLog.push({ type: 'create_new_browser_tab', ...tab });
            console.log('[mock-host] create_new_browser_tab', JSON.stringify(tab));
            respond(requestId, { type: 'create_new_browser_tab_response', ...tab });
            break;
          }

          // Step 29. All three are channel-scoped in the host (`withChannel`),
          // so one sent without a channelId gets the host's own error string.
          case 'get_output_style': {
            if (!msg.channelId) {
              respond(requestId, { type: 'error', error: 'channelId is required for get_output_style' });
              break;
            }
            window.__forgeOutputStyleLog.push({ type: 'get_output_style', channelId: msg.channelId });
            console.log('[mock-host] get_output_style', msg.channelId);
            // The host omits `outputStyle` unless the CLI reports a string.
            respond(requestId, {
              type: 'get_output_style_response',
              ...(typeof outputStyles.current === 'string' && { outputStyle: outputStyles.current }),
              availableStyles: [...outputStyles.available],
            });
            break;
          }

          case 'get_output_style_locations': {
            if (!msg.channelId) {
              respond(requestId, { type: 'error', error: 'channelId is required for get_output_style_locations' });
              break;
            }
            window.__forgeOutputStyleLog.push({ type: 'get_output_style_locations', channelId: msg.channelId });
            console.log('[mock-host] get_output_style_locations');
            // The project path is relative and the user path is tildified, the
            // way ClaudeAgentService.getOutputStyleLocations sends them.
            respond(requestId, {
              type: 'get_output_style_locations_response',
              project: '.claude/output-styles',
              user: '~/.claude/output-styles',
            });
            break;
          }

          case 'create_output_style': {
            if (!msg.channelId) {
              respond(requestId, { type: 'error', error: 'channelId is required for create_output_style' });
              break;
            }
            const { draft, level, replace } = request;
            window.__forgeOutputStyleLog.push({ type: 'create_output_style', draft, level, replace });
            console.log('[mock-host] create_output_style', JSON.stringify({ draft, level, replace }));
            // outputStyles.ts, check for check, in the host's order. The
            // character checks are spelled out rather than written as regexes,
            // so what they reject is readable in the harness.
            const BACKSLASH = String.fromCharCode(92);
            const name = typeof draft?.name === 'string' ? draft.name.trim() : '';
            const separators = [...':*?"<>|/', BACKSLASH];
            const control = [...name].some((ch) => {
              const code = ch.codePointAt(0);
              return code < 0x20 || code === 0x7f;
            });
            const badName =
              typeof draft !== 'object' || draft === null ||
              typeof draft.name !== 'string' || typeof draft.description !== 'string' ||
              typeof draft.instructions !== 'string' ||
              name.length === 0 || separators.some((ch) => name.includes(ch)) || control ||
              name.startsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])($|[.])/i.test(name) ||
              name.includes('---');
            if (badName) {
              respond(requestId, { type: 'error', error: 'Invalid output style name' });
              break;
            }
            if (draft.description.includes('---')) {
              respond(requestId, { type: 'error', error: 'Invalid output style description' });
              break;
            }
            if (level !== 'project' && level !== 'user') {
              respond(requestId, { type: 'error', error: 'Invalid output style level' });
              break;
            }
            // The host's `O_EXCL` create: an existing file is only overwritten
            // when `replace` is true; otherwise the answer is `{kind:"exists"}`.
            const taken = outputStyles.available.some((s) => s.toLowerCase() === name.toLowerCase());
            if (taken && replace !== true) {
              respond(requestId, { type: 'create_output_style_response', result: { kind: 'exists' } });
              break;
            }
            if (!taken) outputStyles.available.push(name);
            const dir = level === 'user' ? '~/.claude/output-styles' : '.claude/output-styles';
            respond(requestId, {
              type: 'create_output_style_response',
              result: {
                kind: 'saved',
                filePath: dir + '/' + name + '.md',
                ...(window.__forgeOutputStyleNoReload ? {} : { availableStyles: [...outputStyles.available] }),
              },
            });
            break;
          }

          // Step 30. Not channel-scoped. The host refuses a non-boolean before
          // anything is written, persists, pushes `viewMode` to the running
          // channels, and broadcasts the config change back.
          case 'set_focus_view': {
            const { enabled } = request;
            if (typeof enabled !== 'boolean') {
              respond(requestId, { type: 'error', error: 'set_focus_view: enabled must be a boolean' });
              break;
            }
            focusView.enabled = enabled;
            window.__forgeFocusViewLog.push(enabled);
            console.log('[mock-host] set_focus_view', enabled);
            respond(requestId, { type: 'set_focus_view_response' });
            // The official `pushStateUpdate()`; Forge's host sends this push.
            toWebview({
              type: 'request',
              channelId: '',
              requestId: 'focus-view-push-' + Date.now(),
              request: { type: 'extension_config_changed', key: 'focusView', value: enabled },
            });
            break;
          }

          // Step 32. The typed replacements for the `command:` allow-list. The
          // host's checks, verbatim: a `searchString` must be a string and is
          // length-capped, and `open_help` carries no payload at all.
          case 'open_config': {
            const { searchString } = request;
            if (searchString !== undefined && typeof searchString !== 'string') {
              respond(requestId, { type: 'error', error: 'open_config: searchString must be a string' });
              break;
            }
            if (typeof searchString === 'string' && searchString.length > 200) {
              respond(requestId, { type: 'error', error: 'open_config: searchString is longer than 200 characters' });
              break;
            }
            window.__forgeConfigOpens.push(searchString || 'forge');
            console.log('[mock-host] open_config', JSON.stringify(searchString || 'forge'));
            respond(requestId, { type: 'open_config_response' });
            break;
          }

          case 'open_help': {
            window.__forgeHelpOpens.push('https://code.claude.com/docs/en/vs-code');
            console.log('[mock-host] open_help');
            respond(requestId, { type: 'open_help_response' });
            break;
          }

          // `open_config_file` no longer runs commands: step 32 deleted the
          // branch, so a `command:` configType is just not a config file.
          case 'open_config_file': {
            const { configType } = request;
            if (typeof configType === 'string' && configType.startsWith('command:')) {
              respond(requestId, {
                type: 'error',
                error: 'Failed to open config file: Not a config file: ' + configType
                  + ' -- open_config_file no longer runs commands; use the typed request for this row.',
              });
              break;
            }
            window.__forgeConfigFileOpens.push(configType);
            console.log('[mock-host] open_config_file', JSON.stringify(configType));
            respond(requestId, { type: 'open_config_file_response' });
            break;
          }

          // Step 31. The typed replacement for
          // `open_config_file {configType:"command:forge.openSettings"}`: the
          // webview names a tab, and anything that is not a real tab id opens
          // General. There is no Settings panel in the harness, so this records
          // what the host would have opened and pushes `select_settings_tab`
          // the way a revealed panel is told.
          case 'open_forge_settings': {
            // Mirrors FORGE_SETTINGS_TABS, `endpoints` included: the endpoints
            // line added that tab, and leaving it out here would make the "/"
            // Endpoints row fall back to General in the harness only.
            const TABS = ['general','models','profiles','plugins','environments','memory-and-rules','permissions','sandbox','network','hooks','skills','mcp-servers','slash-commands','endpoints'];
            const tab = TABS.includes(request.tab) ? request.tab : 'general';
            window.__forgeSettingsOpens.push({ asked: request.tab, opened: tab });
            console.log('[mock-host] open_forge_settings', JSON.stringify({ asked: request.tab, opened: tab }));
            respond(requestId, { type: 'open_forge_settings_response', tab });
            toWebview({
              type: 'request',
              channelId: '',
              requestId: 'select-settings-tab-' + Date.now(),
              request: { type: 'select_settings_tab', tab },
            });
            break;
          }

          case 'fork_conversation': {
            // handleForkConversation -> planForkConversation -> the SDK's
            // forkSession(sessionId, {dir, upToMessageId?, title?}) -> {sessionId}.
            // A bad id throws, the way the official's store does
            // (`invalid session id` / `Session ... not found`).
            const from = request.forkedFromSession;
            const at = request.resumeSessionAt;
            const title = request.title;
            const validFrom = typeof from === 'string' && SESSION_ID.test(from);
            const validAt = at === undefined || (typeof at === 'string' && SESSION_ID.test(at));
            const validTitle = title === undefined || typeof title === 'string';
            window.__forgeForks.push({ forkedFromSession: from, resumeSessionAt: at, title, refused: !(validFrom && validAt && validTitle) });
            console.log('[mock-host] fork_conversation', JSON.stringify(request));
            if (!validFrom || !validAt || !validTitle) {
              respond(requestId, { type: 'error', error: 'invalid session id' });
              break;
            }
            if (!MOCK_SESSIONS.some((s) => s.id === from)) {
              respond(requestId, { type: 'error', error: `Session ${from} not found` });
              break;
            }
            // A new session id, and a listable row for it, so the webview's
            // `activateSessionFromServer` re-list actually finds the fork.
            const forked = crypto.randomUUID();
            const source = MOCK_SESSIONS.find((s) => s.id === from);
            MOCK_SESSIONS.push({
              ...source,
              id: forked,
              summary: title || `${source.summary} (fork)`,
              lastModified: Date.now(),
              createdAt: Date.now(),
            });
            respond(requestId, { type: 'fork_conversation_response', sessionId: forked });
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

          // Step 28: `handleListFiles` ports the official `findFiles`, so the
          // `@` dropdown also lists open browser tabs. The stub has two tabs
          // plus the synthetic "new tab" row, filtered and ordered the way the
          // host's `browserTabEntries` / `findFiles` do.
          case 'list_files_request': {
            const BROWSER_TABS = browserIntegrationSupported
              ? [
                  { tabGroupId: 'group-1', tabId: 11, title: 'Anthropic Docs', url: 'https://docs.anthropic.com/en/docs' },
                  { tabGroupId: 'group-1', tabId: 12, title: 'GitLab Pajamas', url: 'https://design.gitlab.com' },
                  { tabGroupId: '', tabId: 0, title: 'new tab', url: '' },
                ]
              : [];
            const FILES = [
              { path: 'src/extension.ts', name: 'extension.ts', type: 'file' },
              { path: 'src/webview/src/core/Session.ts', name: 'Session.ts', type: 'file' },
            ];
            const pattern = request.pattern;
            const needle = (pattern || '').toLowerCase();
            const tabRows = BROWSER_TABS.filter((t) =>
              !pattern ? true : `browser:${t.title}`.toLowerCase().includes(needle) || t.url.toLowerCase().includes(needle)
            ).map((t) => ({
              path: t.tabGroupId === '' && t.tabId === 0 ? 'browser:new_tab' : `browser:${t.tabGroupId}:${t.tabId}:${t.url}`,
              name: `browser:${t.title.replace(/ /g, '_')}`,
              type: 'browser',
            }));
            const fileRows = FILES.filter((f) => !pattern || f.path.toLowerCase().includes(needle));
            let files;
            if (needle.startsWith('browser:')) files = tabRows;
            else if (needle && 'browser:'.startsWith(needle)) files = [...tabRows, ...fileRows];
            else files = [...fileRows, ...tabRows];
            console.log('[mock-host] list_files_request', JSON.stringify(pattern), '->', files.length);
            respond(requestId, { type: 'list_files_response', files });
            break;
          }

          // The same whitelist the host enforces (`tu$`, restricted to Forge's
          // scope): key must be writable, and to the layer being targeted.
          case 'apply_settings': {
            // settingsWhitelist.ts, check for check: the request shape, then each
            // key's layer and its own value check, then flagsOnly+localSettings.
            const WRITABLE = {
              effortLevel: { layer: 'userSettings', value: (v) => typeof v === 'string' },
              ultracode: { layer: 'flags', value: (v) => v === null || typeof v === 'boolean' },
              // Step 29: localSettings only, as settingsWhitelist.ts has it.
              outputStyle: { layer: 'localSettings', value: (v) => typeof v === 'string' },
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
              if (typeof settings.outputStyle === 'string') outputStyles.current = settings.outputStyle;
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
          /**
           * Forge-only: the mode menu turning bypass on. The real host asks
           * with a modal first; `window.__bypassAnswer = false` plays the
           * user declining it, and a managed policy refuses as the host does.
           * On yes the setting is on, and the state push carries it.
           */
          case 'enable_bypass_permissions': {
            window.__bypassRequests = (window.__bypassRequests ?? 0) + 1;
            const barred = CLAUDE_CONFIG.claudeSettings.effective.permissions?.disableBypassPermissionsMode === 'disable';
            const accepted = !barred && window.__bypassAnswer !== false;
            if (accepted) {
              cli.allowBypass = true;
              pushStateUpdate();
            }
            hostToast(barred ? 'Bypass is disabled by managed settings' : accepted ? 'Would ask, then allow bypass permissions' : 'Bypass permissions declined');
            respond(requestId, { type: 'enable_bypass_permissions_response', enabled: accepted });
            break;
          }

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



          /**
           * The standalone sessions view asking for the chat.
           *
           * The stub cannot focus a view, so it records the intent: what
           * matters is that the sessions view asks the host instead of
           * rendering the chat inside its own container.
           */
          case 'reveal_chat': {
            // As the host checks it: a session id must be one (B3).
            const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (request.sessionId !== undefined && !UUID.test(String(request.sessionId))) {
              respond(requestId, { type: 'error', error: 'reveal_chat: sessionId is not a session id' });
              break;
            }
            window.__forgeRevealChat.push({
              newConversation: Boolean(request.newConversation),
              sessionId: request.sessionId,
              fromView: Boolean(request.fromView),
            });
            console.log('[mock-host] reveal_chat', JSON.stringify(request));
            hostToast(
              request.sessionId
                ? `Would reveal the chat on ${request.sessionId.slice(0, 8)}`
                : request.newConversation ? 'Would reveal the chat, new conversation' : 'Would reveal the chat'
            );
            // The real host answers after it has closed the side bar; the page
            // is then hidden, and shown again later. Simulate the "shown again".
            respond(requestId, { type: 'reveal_chat_response' });
            break;
          }


          /**
           * An endpoint tool, named by action. The webview never names the
           * command, so the stub validates the action the same way the host
           * does -- an unknown one is an error, not a silent no-op.
           */
          case 'run_endpoint_action': {
            const commands = {
              select: 'forge.selectEndpoint',
              add: 'forge.addEndpoint',
              edit: 'forge.editEndpoints',
              status: 'forge.endpointStatus',
              diagnostics: 'forge.runEndpointDiagnostics',
              capabilities: 'forge.detectCapabilities',
              models: 'forge.listEndpointModels',
            };
            const command = Object.prototype.hasOwnProperty.call(commands, request.action)
              ? commands[request.action]
              : undefined;
            if (!command) {
              console.warn('[mock-host] run_endpoint_action REJECTED:', request.action);
              respond(requestId, { type: 'error', error: `Unknown endpoint action: ${request.action}` });
              break;
            }
            window.__forgeEndpointActions.push(request.action);
            console.log('[mock-host] run_endpoint_action', request.action, '->', command);
            hostToast(`Would run: ${command}`);
            if (request.action === 'add') {
              // The real command resolves only when its quick-pick flow ends, so
              // the button's loading state lasts that long. Here the flow
              // "saves" a profile after `__forgeAddDelayMs` (default 1.2s) unless
              // `__forgeAddCancels` is set, and the host's config watcher pushes
              // `update_state` -- which is what takes the page to the chat.
              const delay = window.__forgeAddDelayMs ?? 1200;
              setTimeout(() => {
                if (!window.__forgeAddCancels) {
                  ENDPOINT_PROFILE_COUNT += 1;
                  window.__forgeEndpointProfileCount = ENDPOINT_PROFILE_COUNT;
                  pushStateUpdate();
                }
                respond(requestId, { type: 'run_endpoint_action_response' });
              }, delay);
              break;
            }
            respond(requestId, { type: 'run_endpoint_action_response' });
            break;
          }


          /**
           * The Settings page's create and add buttons (Skills, Agents, MCP
           * Servers). The real host runs a guided flow and answers when it
           * ends; here it "creates" an item after a beat, so the list refresh
           * and the busy state are both observable. Unknown actions are refused
           * exactly as the host refuses them.
           */
          case 'run_forge_action': {
            const known = ['create-skill', 'add-skill', 'create-agent', 'create-command', 'add-mcp-server'];
            if (!known.includes(request.action)) {
              respond(requestId, { type: 'error', error: `Unknown Forge action: ${request.action}` });
              break;
            }
            window.__forgeActions = [...(window.__forgeActions ?? []), request.action];
            hostToast(`Would run: ${request.action}`);
            setTimeout(() => {
              const kind = request.action === 'create-agent' ? 'agents' : request.action === 'create-command' ? 'commands' : 'skills';
              if (request.action !== 'add-mcp-server') {
                const n = (window.__forgeItems[kind].length + 1);
                const sample = {
                  agents: { name: `helper-${n}`, description: 'Reviews a diff before it is committed.' },
                  commands: { name: `review-pr-${n}`, description: 'Reviews a pull request for bugs and missing tests.', argumentHint: '[pr-number]' },
                  skills: { name: `release-notes-${n}`, description: 'Drafts release notes from merged pull requests.' },
                }[kind];
                window.__forgeItems[kind].push({ kind, ...sample, scope: 'project', path: `C:/repo/.claude/${kind}/${n}` });
              }
              respond(requestId, { type: 'run_forge_action_response' });
            }, window.__forgeActionDelayMs ?? 600);
            break;
          }

          case 'list_forge_items': {
            if (!['skills', 'agents', 'commands'].includes(request.kind)) {
              respond(requestId, { type: 'error', error: `list_forge_items: unknown kind ${request.kind}` });
              break;
            }
            respond(requestId, { type: 'list_forge_items_response', items: window.__forgeItems[request.kind] });
            break;
          }

          /**
           * The official plugin manager's requests, against an in-memory CLI:
           * one marketplace, three plugins on offer, nothing installed. Ids,
           * scopes and names are checked as `pluginManager.ts` checks them, so
           * a malformed request is refused here too. `window.__pluginFail`
           * set to a request type makes that request fail once with the CLI's
           * own kind of message, for the error paths.
           */
          case 'list_plugins':
          case 'list_marketplaces':
          case 'install_plugin':
          case 'uninstall_plugin':
          case 'update_plugin':
          case 'set_plugin_enabled':
          case 'add_marketplace':
          case 'remove_marketplace':
          case 'refresh_marketplace': {
            const store = window.__plugins;
            const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(@[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$/;
            const fail = (error) => respond(requestId, { type: 'error', error });
            window.__pluginRequests = [...(window.__pluginRequests ?? []), request];
            if (window.__pluginFail === request.type) {
              window.__pluginFail = undefined;
              fail(`Claude CLI exited with code 1: ✘ Failed: Failed to clone repository: getaddrinfo ENOTFOUND github.com`);
              break;
            }
            if ('pluginId' in request && (typeof request.pluginId !== 'string' || !PLUGIN_ID.test(request.pluginId))) {
              fail(`Not a plugin id: ${JSON.stringify(request.pluginId)}`);
              break;
            }
            if ('scope' in request && !['user', 'project', 'local'].includes(request.scope)) {
              fail(`Not an install scope: ${JSON.stringify(request.scope)}`);
              break;
            }
            const later = (answer) => setTimeout(() => respond(requestId, answer), window.__pluginDelayMs ?? 350);
            switch (request.type) {
              case 'list_plugins': {
                const installedIds = new Set(store.installed.map((p) => p.source));
                later({
                  type: 'list_plugins_response',
                  installed: store.installed,
                  available: request.includeAvailable
                    ? store.catalog
                        .filter((p) => store.marketplaces.some((m) => m.name === p.marketplaceName) && !installedIds.has(p.pluginId))
                        .map((p) => ({ ...p, isInstalled: false }))
                    : [],
                  errors: [],
                });
                break;
              }
              case 'list_marketplaces':
                later({ type: 'list_marketplaces_response', marketplaces: store.marketplaces });
                break;
              case 'install_plugin': {
                const entry = store.catalog.find((p) => p.pluginId === request.pluginId);
                if (!entry) {
                  fail(`Claude CLI exited with code 1: ✘ Failed to install plugin "${request.pluginId}": Plugin not found in marketplace.`);
                  break;
                }
                store.installed.push({
                  name: entry.pluginId,
                  manifest: { name: entry.pluginId, version: '1.0.0', description: entry.entry.description },
                  path: `C:/Users/you/.claude/plugins/${entry.entry.name}`,
                  source: entry.pluginId,
                  enabled: true,
                  scope: request.scope,
                  ...(entry.entry.name === 'github' && { mcpServers: { github: {} } }),
                });
                later({ type: 'install_plugin_response', needsRestart: true });
                break;
              }
              case 'uninstall_plugin':
                store.installed = store.installed.filter((p) => p.source !== request.pluginId);
                later({ type: 'uninstall_plugin_response', needsRestart: true });
                break;
              case 'set_plugin_enabled': {
                if (typeof request.enabled !== 'boolean') {
                  fail('set_plugin_enabled: enabled must be true or false');
                  break;
                }
                const plugin = store.installed.find((p) => p.source === request.pluginId);
                if (plugin) plugin.enabled = request.enabled;
                later({ type: 'set_plugin_enabled_response', needsRestart: true });
                break;
              }
              case 'update_plugin':
                later({ type: 'update_plugin_response', outcome: 'ok', needsRestart: false, message: `${request.pluginId} is already at the latest version (1.0.0).` });
                break;
              case 'add_marketplace': {
                const source = typeof request.source === 'string' ? request.source.trim() : '';
                if (!source || source.startsWith('-')) {
                  fail('A marketplace source is required.');
                  break;
                }
                const name = source.replace(/\.git$/, '').split(/[\\/]/).filter(Boolean).pop();
                store.marketplaces.push({ name, config: { source: /^https?:/.test(source) ? { source: 'url', url: source } : source.includes('/') && !/^[A-Za-z]:/.test(source) ? { source: 'github', repo: source } : { source: 'directory', path: source } }, pluginCount: 0, installedCount: 0 });
                later({ type: 'add_marketplace_response' });
                break;
              }
              case 'remove_marketplace':
                store.marketplaces = store.marketplaces.filter((m) => m.name !== request.marketplaceId);
                later({ type: 'remove_marketplace_response' });
                break;
              case 'refresh_marketplace':
                later({ type: 'refresh_marketplace_response' });
                break;
            }
            break;
          }

          /**
           * The endpoint health verdicts. A pure read on the real host too --
           * no probe, no network -- which is why the welcome page and the
           * settings table can both call it on render.
           *
           * The name is validated exactly as the host validates it: an unknown
           * profile is an error, not a coerced fallback to the active one (B3).
           * `window.__forgeRejectRequests.add('get_endpoint_health')` drives the
           * out-of-date-host path instead.
           */
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
          case 'show_notification': {
            window.__forgeNotifications.push({
              message: String(request.message ?? ''),
              severity: request.severity,
              buttons: request.buttons,
            });
            console.log(`[mock-host] show_notification (${request.severity})`, request.message);
            hostToast(`${request.severity}: ${request.message}`);
            respond(requestId, { type: 'show_notification_response', buttonValue: undefined });
            break;
          }

          case 'open_url':
            window.__forgeOpenedUrls.push(request.url);
            console.log('[mock-host] open_url', request.url);
            hostToast(`Would open: ${request.url}`);
            respond(requestId, { type: 'open_url_response' });
            break;

          case 'new_conversation_tab':
            window.__forgeNewTabs.push(request);
            console.log('[mock-host] new_conversation_tab');
            hostToast('Would open a new conversation tab');
            respond(requestId, { type: 'new_conversation_tab_response' });
            break;

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
  //
  // Every row carries the `uuid` the CLI stamps on it (step 24): the rewind and
  // fork flows key off the user message's uuid, and a row the stream assembler
  // built has none until its final message replaces it. Two user turns, so
  // "rewind to the message before this one" has something to point at.
  window.__forgeSeedTranscript = function (channelId) {
    // A `?mockSessions` channel holds its messages until the stub CLI has said
    // `system/init`, the way the real CLI does. On the plain page there is no
    // such channel and this is a no-op.
    cliInit(channelId);
    const send = (m) => toWebview({ type: 'io_message', channelId, message: m });
    send({
      type: 'user',
      uuid: MSG_U1,
      message: { role: 'user', content: 'Is this the same chatbox as the Claude Code VS Code extension?' },
    });
    send({
      type: 'assistant',
      uuid: MSG_A1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'It is now - the structure came from the official index.js, not from guessing at the CSS.' }],
      },
    });
    send({
      type: 'user',
      uuid: MSG_U2,
      message: { role: 'user', content: 'Split the settings loader into its own module.' },
    });
    send({
      type: 'assistant',
      uuid: MSG_A2,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done - loader.ts now owns the parsing and index.ts only re-exports it.' }],
      },
    });
  };

  /**
   * Step 30: a transcript with something to fold. One prompt, a thinking block,
   * two tool calls (one of which fails) and a reply -- which is what focus view
   * is for: everything between the prompt and the reply becomes one row.
   *
   * `options.pending` leaves the second call without a result, so the fold can
   * be seen in its `live` state with a pending tool name.
   */
  window.__forgeSeedToolTranscript = function (channelId, options) {
    const opts = options || {};
    cliInit(channelId);
    const send = (m) => toWebview({ type: 'io_message', channelId, message: m });
    send({
      type: 'user',
      uuid: '11111111-0000-4000-8000-0000000000f1',
      message: { role: 'user', content: 'Split the settings loader into its own module.' },
    });
    send({
      type: 'assistant',
      uuid: '22222222-0000-4000-8000-0000000000f1',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'The loader is doing two jobs at once.' }],
      },
    });
    send({
      type: 'assistant',
      uuid: '22222222-0000-4000-8000-0000000000f2',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_focus_1', name: 'Read', input: { file_path: 'src/settings.ts' } }],
      },
    });
    send({
      type: 'user',
      uuid: '11111111-0000-4000-8000-0000000000f2',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_focus_1', content: 'export function load() {}' }],
      },
    });
    send({
      type: 'assistant',
      uuid: '22222222-0000-4000-8000-0000000000f3',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_focus_2', name: 'Bash', input: { command: 'pnpm test' } }],
      },
    });
    if (!opts.pending) {
      send({
        type: 'user',
        uuid: '11111111-0000-4000-8000-0000000000f3',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_focus_2', content: '1 failing', is_error: true },
          ],
        },
      });
      send({
        type: 'assistant',
        uuid: '22222222-0000-4000-8000-0000000000f4',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'loader.ts now owns the parsing; one test still fails.' }],
        },
      });
      send({ type: 'result', subtype: 'success' });
    }
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
        // Forge-only (A3): the command-risk reason, so the risk note can be
        // measured. The official host never sends this, so a parity run must
        // leave it unset -- pass it only when measuring the divergence itself.
        ...(opts.riskReason !== undefined && { riskReason: opts.riskReason }),
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
