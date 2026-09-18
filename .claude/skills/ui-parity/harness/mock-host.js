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

  window.acquireVsCodeApi = function () {
    return {
      postMessage(msg) {
        // Every outgoing message, so a click can be proven by what it sent.
        window.__forgeSent.push(JSON.parse(JSON.stringify(msg)));
        if (msg.channelId) lastChannelId = msg.channelId;
        if (msg.type !== 'request') return;
        const { requestId, request } = msg;

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
              },
            });
            break;

          case 'get_claude_state':
            respond(requestId, { type: 'get_claude_state_response', config: CLAUDE_CONFIG });
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
              console.log('[mock-host] set_model', JSON.stringify(request));
              respond(requestId, { type: 'set_model_response' });
            }
            break;
          }

          case 'get_asset_uris':
            respond(requestId, { type: 'asset_uris_response', assetUris: {} });
            break;

          case 'list_sessions_request':
            respond(requestId, { type: 'list_sessions_response', sessions: [] });
            break;

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
            const WRITABLE = { effortLevel: { layer: 'userSettings', value: (v) => typeof v === 'string' } };
            const { settings, flagsOnly, scope } = request;
            const target = flagsOnly ? 'flags' : scope === 'localSettings' ? 'localSettings' : 'userSettings';
            let error = null;
            if (flagsOnly && scope === 'localSettings') {
              error = 'flagsOnly and localSettings scope are exclusive';
            } else if (typeof settings !== 'object' || settings === null) {
              error = 'apply_settings: settings must be an object';
            } else {
              for (const [key, value] of Object.entries(settings)) {
                const entry = Object.hasOwn(WRITABLE, key) ? WRITABLE[key] : undefined;
                if (!entry) {
                  error =
                    `apply_settings: ${JSON.stringify(key)} cannot be written from the webview; ` +
                    'add it to WEBVIEW_WRITABLE_SETTINGS in settingsWhitelist.ts if a webview control needs it';
                  break;
                }
                if (entry.layer !== target || !(value === null || entry.value(value))) {
                  error = `apply_settings: unexpected value or target for ${JSON.stringify(key)}`;
                  break;
                }
              }
            }
            if (error) {
              respond(requestId, { type: 'error', error });
            } else {
              console.log('[mock-host] apply_settings', JSON.stringify(request));
              respond(requestId, { type: 'apply_settings_response' });
            }
            break;
          }

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
      },
    });
  };

  /** The channel the app actually opened, for callers driving it by hand. */
  window.__forgeChannelId = function () {
    return lastChannelId;
  };

  console.log('[mock-host] ready');
})();
