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

  const CLAUDE_CONFIG = {
    models: [
      { value: 'default', label: 'Default (recommended)', description: 'Sonnet 5 - Efficient for routine tasks' },
      { value: 'sonnet', label: 'Sonnet', description: 'Sonnet 5 - Efficient for routine tasks' },
      { value: 'opus', label: 'Opus', description: 'Opus 5 - Best for everyday, complex tasks' },
      { value: 'haiku', label: 'Haiku', description: 'Haiku 4.5 - Fastest for quick answers' },
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
            // The model list in the shape the real SDK reports it, copied from the
            // official picker: displayName plus "<model> · <blurb>" descriptions.
            respond(requestId, {
              type: 'sdk_probe_response',
              data: {
                supportedModels: [
                  { value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 5 · Efficient for routine tasks' },
                  { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 5 · Efficient for routine tasks' },
                  { value: 'fable', displayName: 'Fable', description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks · Requires usage credits' },
                  { value: 'opus', displayName: 'Opus', description: 'Opus 5 · Best for everyday, complex tasks · ~2× usage vs Sonnet' },
                  { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers' },
                ],
              },
            });
            break;

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
