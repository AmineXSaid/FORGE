/**
 * Forge command surface.
 *
 * This module is the single source of truth for what Forge contributes to the
 * command palette, keybindings and menus. `package.json` mirrors it, and
 * `scripts/check-commands.mjs` fails the build if the two drift -- a command
 * declared in the manifest but never registered shows up in the palette and then
 * errors when invoked, which is worse than not offering it at all.
 *
 * Command ids follow the official Claude Code extension's structure, renamed to
 * the `forge.*` namespace. The official extension carries a second legacy
 * `claude-code.*` alias for three of its commands; Forge has no legacy ids to
 * preserve, so it keeps a single namespace.
 */
import * as vscode from 'vscode';
import type { IInstantiationService } from '../di/instantiation';
import { ILogService } from '../services/logService';
import { IWebViewService } from '../services/webViewService';
import { IClaudeAgentService } from '../services/claude/ClaudeAgentService';
import { IClaudeSdkService } from '../services/claude/ClaudeSdkService';
import { IAgentService } from '../services/agents/agentService';
import { IEndpointService } from '../services/endpoints/endpointService';
import type { EndpointProfile } from '../services/endpoints/profile';
import { checkEndpoint, keepServable, listModels } from '../services/endpoints/check';
import { trackEditorSelection } from '../services/claude/editorSelection';
import { LOCAL_PROBE_TIMEOUT_MS } from '../services/endpoints/discover';
import { pickEndpointStart, type StartItem } from '../services/endpoints/startPicker';
import { runEndpointSetup, type SetupDeps, type SetupUi } from '../services/endpoints/setupFlow';
import { selectEndpointProfile } from '../services/endpoints/selection';
import { parseProfile } from '../services/endpoints/profile';
import { addMcpServer, addSkillFromFolder, createSkill, createSlashCommand, createSubagent } from './customizationCommands';
import { detectCapabilities, type DetectReport } from '../services/endpoints/detect';
import { buildTransport } from '../services/endpoints/transport';
import { applyAuth } from '../services/endpoints/auth';
import { isForgeSettingsTab, type UiCommandName } from '../shared/messages';

/**
 * Every webview view id Forge contributes.
 *
 * The chat view exists twice, once per side bar container, because VS Code gates
 * view containers with a static `when` clause and cannot move a view between
 * containers at runtime. `forge.preferredLocation` decides which one is live;
 * the other simply never resolves.
 */
export const CHAT_VIEW_ID = 'forge.chatView';
export const CHAT_VIEW_ID_SECONDARY = 'forge.chatViewSecondary';
export const SESSIONS_VIEW_ID = 'forge.sessionsView';

export const FORGE_VIEW_IDS = [
  CHAT_VIEW_ID,
  CHAT_VIEW_ID_SECONDARY,
  SESSIONS_VIEW_ID,
] as const;

/** Context key set while a Forge-proposed diff is open in the active editor. */
export const CTX_VIEWING_PROPOSED_DIFF = 'forge.viewingProposedDiff';

/**
 * Set only on a VS Code too old to host a view container in the secondary side
 * bar. The official `claude-code:doesNotSupportSecondarySidebar`.
 */
export const CTX_NO_SECONDARY_SIDEBAR = 'forge:doesNotSupportSecondarySidebar';

/** The official `claude-vscode.sessionsListEnabled`, which it sets unconditionally. */
export const CTX_SESSIONS_LIST_ENABLED = 'forge:sessionsListEnabled';

/** The first VS Code that can host a view container in the secondary side bar. */
const SECONDARY_SIDEBAR_SINCE = { major: 1, minor: 106 };

/**
 * Does this VS Code support a secondary side bar view container?
 *
 * The official's own test, verbatim:
 *
 *   let V = version.split(".").map(Number), B = V[0] ?? 0, H = V[1] ?? 0;
 *   let q = B > 1 || (B === 1 && H >= 106);
 *   if (!q) setContext("claude-code:doesNotSupportSecondarySidebar", true);
 *
 * Exported so a spec can run it against version strings without a workbench.
 */
export function supportsSecondarySidebar(version: string): boolean {
    const parts = version.split('.').map(Number);
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    return major > SECONDARY_SIDEBAR_SINCE.major
        || (major === SECONDARY_SIDEBAR_SINCE.major && minor >= SECONDARY_SIDEBAR_SINCE.minor);
}

/**
 * Decide where the chat lives, and put Past Conversations in the activity bar.
 *
 * This is the official's arrangement, and it is not the one Forge shipped. The
 * official puts the **chat** in the secondary side bar on any VS Code that can
 * host it there, and gives the **activity bar** to the sessions list -- so its
 * left-hand button opens your history. Forge instead defaulted
 * `forge.preferredLocation` to `primary` and left `showSessionsSidebar` off, so
 * the activity-bar button opened a second chat beside the one already open.
 *
 * VS Code evaluates a `when` clause on a context key, and container `when`
 * clauses are static, so this has to run at activation before the containers
 * resolve.
 */
export function applySidebarContextKeys(version: string = vscode.version): void {
    // Only set when unsupported, exactly as the official does: an absent key is
    // falsy, so `!forge:doesNotSupportSecondarySidebar` is true on a modern build.
    if (!supportsSecondarySidebar(version)) {
        void vscode.commands.executeCommand('setContext', CTX_NO_SECONDARY_SIDEBAR, true);
    }
    void vscode.commands.executeCommand('setContext', CTX_SESSIONS_LIST_ENABLED, true);
}

/**
 * Every command Forge registers. `title` is what the palette shows and must match
 * package.json exactly.
 */
export const FORGE_COMMANDS = [
  { command: 'forge.sidebar.open', title: 'Forge: Open in Side Bar' },
  { command: 'forge.editor.open', title: 'Forge: Open in New Tab' },
  // The brand cut, not `forge-cube.svg`. VS Code masks an activity-bar icon to
  // the theme foreground, but draws an `editor/title` command icon as-is, so a
  // `currentColor` SVG resolves to black and vanishes on a dark theme -- which
  // is how this button came out empty. The official ships a literal `#D97757`.
  { command: 'forge.editor.openLast', title: 'Forge: Open', icon: 'resources/forge-cube-brand.svg' },
  { command: 'forge.sessions.open', title: 'Forge: Past Conversations' },
  { command: 'forge.welcome', title: 'Forge: Welcome' },
  { command: 'forge.newConversation', title: 'Forge: New Conversation' },
  { command: 'forge.focus', title: 'Forge: Focus input' },
  { command: 'forge.blur', title: 'Forge: Blur input' },
  { command: 'forge.focusLastMessage', title: 'Forge: Focus last message' },
  { command: 'forge.insertAtMention', title: 'Forge: Insert @-Mention Reference' },
  { command: 'forge.acceptProposedDiff', title: 'Forge: Accept Proposed Changes', icon: '$(check)' },
  { command: 'forge.rejectProposedDiff', title: 'Forge: Reject Proposed Changes', icon: '$(discard)' },
  { command: 'forge.createWorktree', title: 'Forge: Create Worktree' },
  { command: 'forge.openSettings', title: 'Forge: Open Settings', icon: '$(gear)' },
  { command: 'forge.showLogs', title: 'Forge: Show Logs' },
  { command: 'forge.runDoctor', title: 'Forge: Run CLI Doctor' },
  { command: 'forge.openWalkthrough', title: 'Forge: Open Walkthrough' },
  { command: 'forge.selectAgent', title: 'Forge: Select Agent' },
  { command: 'forge.createAgent', title: 'Forge: Create Agent' },
  { command: 'forge.selectEndpoint', title: 'Forge: Select Endpoint Profile' },
  { command: 'forge.addEndpoint', title: 'Forge: Add Endpoint Profile' },
  { command: 'forge.editEndpoints', title: 'Forge: Edit Endpoint Profiles' },
  { command: 'forge.endpointStatus', title: 'Forge: Show Endpoint Status' },
  { command: 'forge.runEndpointDiagnostics', title: 'Forge: Run Endpoint Diagnostics' },
  { command: 'forge.detectCapabilities', title: 'Forge: Detect Endpoint Capabilities' },
  { command: 'forge.listEndpointModels', title: 'Forge: List Endpoint Models' },
  { command: 'forge.createSkill', title: 'Forge: Create Skill' },
  { command: 'forge.addSkill', title: 'Forge: Add Skill from Folder' },
  { command: 'forge.addMcpServer', title: 'Forge: Add MCP Server' },
  { command: 'forge.createSubagent', title: 'Forge: Create Subagent' },
  { command: 'forge.createSlashCommand', title: 'Forge: Create Slash Command' },
] as const;

export type ForgeCommandId = (typeof FORGE_COMMANDS)[number]['command'];

/**
 * Callbacks the diff feature registers so accept/reject can act on whatever
 * proposal is currently on screen. Kept as a slot rather than a hard dependency
 * so the command exists from activation and simply does nothing useful until a
 * diff is actually open.
 */
export interface ProposedDiffHandler {
  accept(): Promise<void> | void;
  reject(): Promise<void> | void;
}

let proposedDiffHandler: ProposedDiffHandler | undefined;

/** Register the handler for the diff currently under review, or clear it. */
export function setProposedDiffHandler(handler: ProposedDiffHandler | undefined): void {
  proposedDiffHandler = handler;
  void vscode.commands.executeCommand('setContext', CTX_VIEWING_PROPOSED_DIFF, Boolean(handler));
}

export function registerForgeCommands(
  context: vscode.ExtensionContext,
  instantiationService: IInstantiationService,
): void {
  instantiationService.invokeFunction((accessor) => {
    const logService = accessor.get(ILogService);
    const webViewService = accessor.get(IWebViewService);
    const agentService = accessor.get(IClaudeAgentService);
    const sdkService = accessor.get(IClaudeSdkService);
    const hermesAgents = accessor.get(IAgentService);
    const endpointService = accessor.get(IEndpointService);

    /** Send a one-way UI command into the webview. */
    const ui = (command: UiCommandName) => {
      agentService.notifyClient({ type: 'ui_command', command });
    };

    /**
     * Keep the chats' idea of the open file and the selected lines current: the
     * official `xd0` (see `editorSelection.ts`), whose tracked selection also
     * answers `get_current_selection`. Focus moving into a chat tab keeps what
     * the user was looking at, rather than wiping it just before they type.
     */
    context.subscriptions.push(
      ...trackEditorSelection(
        {
          get activeTextEditor() { return vscode.window.activeTextEditor; },
          get visibleTextEditors() { return vscode.window.visibleTextEditors; },
          onDidChangeTextEditorSelection: vscode.window.onDidChangeTextEditorSelection,
          onDidChangeActiveTextEditor: vscode.window.onDidChangeActiveTextEditor,
          onDidCloseTextDocument: vscode.workspace.onDidCloseTextDocument,
        },
        (selection) => agentService.notifyClient({ type: 'selection_changed', selection }),
      ),
    );

    /**
     * Choose the profile a diagnostic should run against.
     *
     * The active one is used without asking when there is one, because that is
     * what the user is actually trying to debug. With none selected the command
     * still has to work -- checking a profile *before* switching to it is the
     * normal way to use it.
     */
    const pickProfile = async (placeHolder: string): Promise<EndpointProfile | undefined> => {
      const { profiles, errors } = endpointService.listProfiles();
      if (errors.length) {
        void vscode.window.showWarningMessage(
          `Forge: ${errors.length} endpoint profile(s) failed to load. See the Forge output channel.`,
        );
      }
      if (!profiles.length) {
        void vscode.window.showWarningMessage(
          'Forge: no endpoint profiles are defined. Add one under "forge.endpoints" in settings.',
        );
        return undefined;
      }

      const active = vscode.workspace.getConfiguration('forge').get<string>('endpointProfile', '')?.trim();
      const current = profiles.find((p) => p.name === active);
      if (current) return current;
      if (profiles.length === 1) return profiles[0];

      const picked = await vscode.window.showQuickPick(
        profiles.map((p) => ({
          label: p.name,
          detail: [p.description, `${p.wire} → ${p.baseUrl}`, `model: ${p.model}`].filter(Boolean).join('  |  '),
          profile: p,
        })),
        { title: 'Forge', placeHolder },
      );
      return picked?.profile;
    };

    /**
     * Reveal whichever chat view is live.
     *
     * Only the view whose container passes its `when` clause exists, so focusing
     * the other throws. Try the configured one first and fall back, rather than
     * assuming the setting and the workbench agree.
     */
    const revealSidebar = async () => {
      // Same two inputs the `when` clauses use, in the same order, so this
      // tries the view that actually exists first instead of relying on the
      // fallback loop below to paper over a disagreement.
      const preferred = vscode.workspace
        .getConfiguration('forge')
        .get<string>('preferredLocation', 'secondary');
      const primary = preferred === 'primary' || !supportsSecondarySidebar(vscode.version);
      const order = primary
        ? [CHAT_VIEW_ID, CHAT_VIEW_ID_SECONDARY]
        : [CHAT_VIEW_ID_SECONDARY, CHAT_VIEW_ID];

      for (const viewId of order) {
        try {
          await vscode.commands.executeCommand(`${viewId}.focus`);
          return;
        } catch {
          // This container is not contributed in the current configuration.
        }
      }
      logService.warn('[Command] 无法聚焦 Forge 视图：两个侧边栏容器都不可用');
    };

    let editorTabSeq = 0;

    // `(...args: unknown[])`, not `()`: a command invoked through
    // `executeCommand(id, x)` carries `x`, and a zero-argument type here is
    // what let the registration below silently drop it.
    const impls: Record<ForgeCommandId, (...args: unknown[]) => unknown> = {
      'forge.sidebar.open': revealSidebar,

      'forge.editor.open': () => {
        // A fresh instanceId gives a genuinely new tab rather than focusing the
        // existing one, which is what "Open in New Tab" has to mean.
        webViewService.openEditorPage('chat', 'Forge', `chat-${++editorTabSeq}`);
      },

      'forge.editor.openLast': () => {
        // Same instanceId every time: openEditorPage focuses an existing panel
        // when one is already open, and creates it otherwise.
        webViewService.openEditorPage('chat', 'Forge', 'chat-last');
      },

      'forge.sessions.open': () => {
        webViewService.openEditorPage('sessions', 'Forge Sessions');
      },

      /**
       * Put the welcome page up on purpose.
       *
       * It normally appears on its own when the model list is empty. This is
       * how to reach it otherwise -- to look at it, or to get back to the
       * setup flow without emptying the list first.
       */
      'forge.welcome': async () => {
        await revealSidebar();
        ui('show_welcome');
      },

      'forge.newConversation': async () => {
        await revealSidebar();
        ui('new_conversation');
      },

      'forge.focus': async () => {
        await revealSidebar();
        ui('focus_input');
      },

      'forge.blur': () => ui('blur_input'),

      'forge.focusLastMessage': async () => {
        await revealSidebar();
        ui('focus_last_message');
      },

      'forge.insertAtMention': async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          void vscode.window.showInformationMessage('Forge: open a file to insert an @-mention.');
          return;
        }
        const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
        const sel = editor.selection;
        // Mention the selected line range when there is a selection, otherwise
        // just the file. Line numbers are 1-based to match how editors show them.
        const text = sel.isEmpty
          ? `@${relative}`
          : `@${relative}#L${sel.start.line + 1}-${sel.end.line + 1}`;

        await revealSidebar();
        agentService.notifyClient({ type: 'insert_at_mention', text });
        logService.info(`[Command] insert_at_mention: ${text}`);
      },

      'forge.acceptProposedDiff': async () => {
        if (!proposedDiffHandler) return;
        await proposedDiffHandler.accept();
      },

      'forge.rejectProposedDiff': async () => {
        if (!proposedDiffHandler) return;
        await proposedDiffHandler.reject();
      },

      'forge.createWorktree': () => createWorktree(logService),

      /**
       * Step 31: an optional tab argument, so a "/" row can land on the page it
       * means. Anything that is not a real tab id opens General, and the command
       * is the only thing that runs -- no other side effect.
       */
      'forge.openSettings': (tab?: unknown) => {
        try {
          // The settings page is a singleton, so it takes no instanceId.
          webViewService.openEditorPage('settings', 'Forge Settings', undefined, {
            tab: isForgeSettingsTab(tab) ? tab : 'general',
          });
        } catch (error) {
          logService.error('[Command] 打开 Settings 页面失败', error);
          // Swallowing this is how the row looked like it did nothing at all.
          void vscode.window.showErrorMessage(
            `Forge: could not open Settings: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },

      'forge.showLogs': () => logService.show(),

      'forge.runDoctor': async () => {
        logService.show();
        const result = await sdkService.checkCliHealth();
        if (!result.ok) {
          void vscode.window.showWarningMessage(
            'Forge: the CLI health check reported a problem. See the Forge output channel.',
          );
        }
      },

      'forge.selectAgent': async () => {
        const { agents, warnings } = hermesAgents.list();
        const active = vscode.workspace.getConfiguration('forge').get<string>('activeAgent', '');

        const items: (vscode.QuickPickItem & { agent?: string })[] = [
          {
            label: '$(circle-slash) No agent',
            description: active ? '' : 'current',
            detail: 'Run without a persona, with every tool available.',
            agent: '',
          },
          ...agents.map((a) => ({
            label: `$(person) ${a.name}`,
            description: a.name === active ? 'current' : '',
            detail: [
              a.description,
              a.model ? `model: ${a.model}` : undefined,
              a.tools.length ? `tools: ${a.tools.join(', ')}` : 'tools: unrestricted',
              a.allMcp ? 'mcp: all' : `mcp: ${a.mcp.map((m) => m.server).join(', ') || 'none'}`,
            ].filter(Boolean).join('  |  '),
            agent: a.name,
          })),
        ];

        if (!agents.length) {
          items.push({
            label: '$(add) Create an agent...',
            detail: `No agents found in ${hermesAgents.getAgentsDir()}`,
            agent: undefined,
          });
        }
        if (warnings.length) {
          void vscode.window.showWarningMessage(
            `Forge: ${warnings.length} agent file(s) could not be loaded. See the Forge output channel.`,
          );
        }

        const picked = await vscode.window.showQuickPick(items, {
          title: 'Forge: Select Agent',
          placeHolder: 'Scope decides which tools the CLI is told about, so switching starts a new session.',
        });
        if (!picked) return;
        if (picked.agent === undefined) {
          await vscode.commands.executeCommand('forge.createAgent');
          return;
        }

        await vscode.workspace
          .getConfiguration('forge')
          .update('activeAgent', picked.agent, vscode.ConfigurationTarget.Workspace);

        // Tool scope is fixed when the CLI process starts, so the change only
        // takes effect on a new conversation. Say so, rather than letting it look
        // like the switch did nothing.
        const label = picked.agent || 'no agent';
        const choice = await vscode.window.showInformationMessage(
          `Forge: switched to ${label}. Tool scope applies from the next conversation.`,
          'New Conversation',
        );
        if (choice === 'New Conversation') {
          await vscode.commands.executeCommand('forge.newConversation');
        }
      },

      // The guided flows behind the Settings page's Skills, Agents and MCP
      // Servers buttons (see customizationCommands.ts).
      'forge.createSkill': () => createSkill(),
      'forge.addSkill': () => addSkillFromFolder(),
      'forge.createSubagent': () => createSubagent(),
      'forge.createSlashCommand': () => createSlashCommand(),
      'forge.addMcpServer': () =>
        addMcpServer({
          resolveClaudeExecutable: () => sdkService.resolveClaudeExecutablePath(),
          log: (message) => logService.info(message),
        }),

      'forge.createAgent': async () => {
        const name = await vscode.window.showInputBox({
          title: 'Forge: Create Agent',
          prompt: 'Agent name',
          placeHolder: 'reviewer',
          validateInput: (v) =>
            !v.trim() ? 'A name is required'
              : !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.trim())
                ? 'Use letters, digits, dot, dash or underscore'
                : undefined,
        });
        if (!name) return;

        const file = await hermesAgents.scaffold(name.trim());
        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc);
      },

      'forge.selectEndpoint': async () => {
        const { profiles, errors } = endpointService.listProfiles();
        const active = vscode.workspace.getConfiguration('forge').get<string>('endpointProfile', '');

        if (errors.length) {
          void vscode.window.showWarningMessage(
            `Forge: ${errors.length} endpoint profile(s) failed to load. See the Forge output channel.`,
          );
        }

        const ADD = '::add-or-edit::';
        // The one in use: the selected one, else the first (`resolveProfile`).
        const current = endpointService.resolveActiveProfile()?.name ?? active;
        // An endpoint and its model are one entry, and there is no "Anthropic
        // default" to go back to: Forge talks only to endpoints set up here.
        const items: (vscode.QuickPickItem & { profile: string })[] = [
          ...profiles.map((pr) => ({
            label: `$(plug) ${pr.model}`,
            description: pr.name === current ? `${pr.name} · current` : pr.name,
            detail: [pr.description, pr.baseUrl, `wire: ${pr.wire}`].filter(Boolean).join('  |  '),
            profile: pr.name,
          })),
          // Without this the picker is a dead end for anyone who has not
          // set an endpoint up yet -- which is everyone, the first time.
          {
            label: '$(add) Add an endpoint…',
            detail: 'Pick where it runs and which model to use; Forge checks it and saves it.',
            profile: ADD,
            alwaysShow: true,
          },
        ];

        const picked = await vscode.window.showQuickPick(items, {
          title: 'Forge: Select Endpoint Profile',
          placeHolder: profiles.length
            ? 'Pick the gateway Forge should route through'
            : 'No endpoint profiles yet. Choose "Add an endpoint…"',
        });
        if (!picked) return;

        if (picked.profile === ADD) {
          await vscode.commands.executeCommand('forge.addEndpoint');
          return;
        }

        // Written where it takes effect, and never to Workspace with no folder
        // open (that threw).
        await selectEndpointProfile(picked.profile);
        // Drop the running relay so the next turn builds the new transport.
        await endpointService.reset();
        void vscode.window.showInformationMessage(`Forge: now using ${picked.profile}.`);
      },

      /**
       * Write a new endpoint profile by answering questions, instead of hand-
       * editing `settings.json`.
       *
       * Reported from a real install: "endpoints were settings.json-only;
       * nothing in the UI led there." A picker that can only choose between
       * profiles that do not exist yet is a dead end, so this is the step that
       * makes the first one.
       *
       * Only the fields `parseProfile` actually requires are asked for --
       * `wire`, `baseUrl`, `model`, and the auth block. Everything else has a
       * default (`DEFAULT_CAPS`, `timeoutMs`, `retries`), and asking for a
       * capability block before the endpoint has ever answered would be asking
       * the user to guess; `forge.detectCapabilities` measures it afterwards.
       *
       * `wire: raw` is deliberately not offered: it requires a `transform`
       * module on disk, so a profile created with it here could only be
       * invalid.
       */
      'forge.addEndpoint': async () => {
        const { profiles } = endpointService.listProfiles();
        const config = vscode.workspace.getConfiguration('forge');
        const inspected = config.inspect<Record<string, Record<string, unknown>>>('endpoints');
        // User settings only: `forge.endpoints` is machine-scoped, so a
        // workspace value is never applied.
        const inUser = inspected?.globalValue ?? {};
        // Every name in use, including entries that failed to parse: writing
        // over one of those silently replaced it.
        const takenNames = [...new Set([...profiles.map((p) => p.name), ...Object.keys(inUser)])];
        // An existing profile's key, for "another model from": read once, here,
        // because the flow's secret lookup is synchronous.
        const readers = await Promise.all(profiles.map((p) => endpointService.secretsFor(p)));

        const ui: SetupUi = {
          pickStart: (existing) =>
            pickEndpointStart(
              vscode.window.createQuickPick<StartItem>(),
              async (baseUrl) => {
                const probe = parseProfile(
                  {
                    name: 'probe', wire: 'openai', baseUrl, model: 'probe',
                    auth: { kind: 'none' }, timeoutMs: LOCAL_PROBE_TIMEOUT_MS, retries: 0,
                    // Loopback never goes through HTTPS_PROXY: a corporate proxy
                    // either refuses it or holds it until its own timeout.
                    proxy: { useEnvironment: false },
                  },
                  'discovery',
                );
                const result = await listModels(probe, () => undefined, { timeoutMs: LOCAL_PROBE_TIMEOUT_MS });
                // `!== undefined`, not truthiness: an error is an error even
                // when its text came back empty.
                return result.error !== undefined ? undefined : result.models.map((m) => m.id);
              },
              { existing },
            ),
          input: (options) =>
            Promise.resolve(vscode.window.showInputBox({
              title: options.title,
              prompt: options.prompt,
              value: options.value,
              placeHolder: options.placeHolder,
              password: options.password,
              ignoreFocusOut: true,
              validateInput: options.validate,
            })),
          pick: (items, options) =>
            Promise.resolve(vscode.window.showQuickPick(items, {
              title: options.title,
              placeHolder: options.placeHolder,
              ignoreFocusOut: true,
              matchOnDescription: true,
            })),
          withProgress: (title, task) =>
            Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task)),
        };


        const deps: SetupDeps = {
          profiles,
          takenNames,
          rawProfile: (name) => inUser[name],
          storedSecret: (key) => {
            for (const read of readers) {
              const value = read(key);
              if (value) return value;
            }
            return undefined;
          },
          listModels: (profile, secrets) => listModels(profile, secrets),
          // Bounded: 4 at a time, 15s each, so a cold model on a busy gateway
          // is given a fair chance without the step taking minutes.
          probe: (profile, ids, secrets) => keepServable(profile, ids, secrets, { concurrency: 4, timeoutMs: 15_000 }),
          check: async (profile, secrets) => {
            const outcome = await checkEndpoint(profile, secrets);
            const failed = outcome.rungs.find((r) => r.status === 'fail');
            return { ok: outcome.ok, summary: outcome.summary, fix: failed?.fix };
          },
          storeSecret: (key, value) => Promise.resolve(context.secrets.store(key, value)),
          deleteSecret: (key) => Promise.resolve(context.secrets.delete(key)),
          writeProfile: async (name, value) => {
            // Re-read at write time: the map may have changed while the prompts
            // were open (another window, a hand edit). User settings only:
            // `forge.endpoints` is machine-scoped.
            const now = vscode.workspace.getConfiguration('forge').inspect<Record<string, unknown>>('endpoints');
            const existing = now?.globalValue ?? {};
            await vscode.workspace.getConfiguration('forge').update('endpoints', { ...existing, [name]: value }, vscode.ConfigurationTarget.Global);
          },
          // Selected where the workspace already selects one, else in user
          // settings (`selectEndpointProfile`).
          select: (name) => selectEndpointProfile(name),
        };

        let result: Awaited<ReturnType<typeof runEndpointSetup>>;
        try {
          result = await runEndpointSetup(ui, deps);
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Forge: could not save the endpoint: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
        if (result === 'edit') {
          await vscode.commands.executeCommand('forge.editEndpoints');
          return;
        }
        if (!result) return;

        // Active from here: the next conversation, and the next message of an
        // open one, run on it. The relay is rebuilt on its first use.
        try {
          await endpointService.reset();
        } catch (error) {
          logService.warn(`[addEndpoint] relay reset failed: ${error}`);
        }
        await revealSidebar();
        void vscode.window.showInformationMessage(`Forge: ${result.model} on ${result.name} is ready.`);
      },

      /**
       * Open `settings.json` at `forge.endpoints`.
       *
       * Its own command because the Settings page said "Opens settings.json"
       * on a button that ran the picker instead -- a label that does not match
       * its behaviour is the defect CLAUDE.md's B7 names.
       */
      'forge.editEndpoints': async () => {
        await vscode.commands.executeCommand('workbench.action.openSettingsJson', {
          revealSetting: { key: 'forge.endpoints', edit: true },
        });
      },

      'forge.endpointStatus': () => {
        // Re-read both sources rather than reporting the last cached scan: the
        // usual reason to run this command is that something was just edited,
        // and a parse error the user cannot see is the failure this prevents.
        const { profiles, errors } = endpointService.listProfiles();
        const status = endpointService.getStatus();
        const selected = vscode.workspace
          .getConfiguration('forge')
          .get<string>('endpointProfile', '')?.trim() ?? '';

        logService.show();
        logService.info('--- Forge endpoint status ---');
        logService.info(`  forge.endpointProfile : ${selected || '(unset -- using Anthropic directly)'}`);

        const active = status.profile ?? profiles.find((p) => p.name === selected);
        if (selected && !active) {
          logService.warn(`  ! no profile named "${selected}" in forge.endpoints or the profiles directory`);
        }

        if (active) {
          const caps = active.capabilities;
          logService.info(`  profile source        : ${active.origin === 'file' ? active.sourceFile : 'settings: forge.endpoints'}`);
          logService.info(`  wire                  : ${active.wire}`);
          logService.info(`  upstream              : ${active.baseUrl}${active.chatPath ?? ''}`);
          logService.info(`  model                 : ${active.model}`);
          logService.info(`  auth                  : ${active.auth?.kind ?? 'none'}`);
          logService.info(`  timeout / retries     : ${active.timeoutMs}ms / ${active.retries}`);
          // The capability block is what the UI gates on, so print the fields
          // that hide or show a control -- "the row is missing" is otherwise a
          // mystery rather than a setting.
          logService.info(
            `  capabilities          : tools=${caps.tools} streaming=${caps.streaming} vision=${caps.vision} ` +
            `context=${caps.contextWindow} effort=${caps.effort}` +
            (caps.effort ? `[${caps.effortLevels.join(',')}]` : '') +
            ` reasoning=${caps.reasoningField} fastMode=${caps.fastMode} caching=${caps.promptCaching}`,
          );
        }

        logService.info(`  relay                 : ${status.baseUrl ?? '(not running)'}`);
        for (const line of status.report) logService.info(`    ${line}`);

        logService.info(`  profiles found        : ${profiles.length}`);
        for (const p of profiles) {
          logService.info(
            `    ${p.name === selected ? '*' : '-'} ${p.name}  [${p.wire}]  ${p.baseUrl}  ` +
            `(${p.origin === 'file' ? p.sourceFile : 'settings'})`,
          );
        }

        if (errors.length) {
          logService.warn(`  profiles that failed to parse: ${errors.length}`);
          for (const e of errors) logService.warn(`    ! ${e.file ?? 'profile'}: ${e.message}`);
        }
      },

      'forge.runEndpointDiagnostics': async () => {
        const profile = await pickProfile('Which endpoint should Forge check?');
        if (!profile) return;

        logService.show();
        logService.info(`--- Endpoint diagnostics: ${profile.name} ---`);

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Forge: checking ${profile.name}`, cancellable: true },
          async (progress, token) => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());

            const outcome = await checkEndpoint(
              profile,
              // The same lookup a real request gets, so a token kept in
              // SecretStorage resolves here too -- a diagnostic that cannot see
              // the credential only ever reports the wrong failure.
              await endpointService.secretsFor(profile),
              // Each rung is reported the moment it finishes, so a slow endpoint
              // shows progress rather than a blank notification.
              (rung) => {
                const mark = rung.status === 'pass' ? '✓'
                  : rung.status === 'fail' ? '✗'
                    : rung.status === 'warn' ? '!' : '-';
                logService.info(`  ${mark} ${rung.name} (${rung.ms}ms): ${rung.detail}`);
                if (rung.fix) logService.info(`      fix: ${rung.fix}`);
                progress.report({ message: rung.name });
              },
              controller.signal,
            );

            logService.info(`  => ${outcome.summary}`);
            if (outcome.ok) {
              void vscode.window.showInformationMessage(`Forge: ${profile.name}: ${outcome.summary}`);
            } else {
              const failed = outcome.rungs.find((r) => r.status === 'fail');
              const choice = await vscode.window.showErrorMessage(
                `Forge: ${outcome.summary}`,
                ...(failed?.fix ? ['Show the fix'] : []),
              );
              if (choice) void vscode.window.showInformationMessage(failed!.fix!, { modal: true });
            }
          },
        );
      },

      'forge.detectCapabilities': async () => {
        const profile = await pickProfile('Which endpoint should Forge probe?');
        if (!profile) return;

        logService.show();
        logService.info(`--- Capability probes: ${profile.name} ---`);

        const built = buildTransport(profile);
        let report: DetectReport | undefined;
        try {
          const auth = await applyAuth(profile, built.dispatcher, await endpointService.secretsFor(profile));
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Forge: probing ${profile.name}`, cancellable: true },
            async (progress, token) => {
              const controller = new AbortController();
              token.onCancellationRequested(() => controller.abort());
              report = await detectCapabilities({
                profile,
                dispatcher: built.dispatcher,
                headers: { ...(profile.headers ?? {}), ...auth.headers },
                signal: controller.signal,
                onResult: (r) => {
                  const mark = r.supported === undefined ? '-' : r.supported ? '✓' : '✗';
                  logService.info(`  ${mark} ${r.name} (${r.ms}ms): ${r.detail}`);
                  progress.report({ message: r.name });
                },
              });
            },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          logService.error(`  probes could not run: ${message}`);
          void vscode.window.showErrorMessage(`Forge: could not probe ${profile.name}: ${message}`);
          return;
        } finally {
          await built.dispatcher.close().catch(() => { });
        }
        if (!report) return;

        // The probe result is a *proposal*. The profile stays the source of
        // truth, so nothing is written until the user says so.
        const changes = Object.entries(report.patch).filter(
          ([key, value]) => JSON.stringify((profile.capabilities as any)[key]) !== JSON.stringify(value),
        );

        if (!changes.length) {
          void vscode.window.showInformationMessage(
            `Forge: ${profile.name} already matches what the probes found. Nothing to change.`,
          );
          return;
        }

        const diff = changes
          .map(([key, value]) => `  ${key}: ${JSON.stringify((profile.capabilities as any)[key])} → ${JSON.stringify(value)}`)
          .join('\n');
        logService.info('  proposed changes:');
        logService.info(diff);

        if (profile.origin !== 'settings') {
          // A YAML profile is not ours to rewrite, so hand over the block.
          void vscode.window.showInformationMessage(
            `Forge: probes suggest ${changes.length} change(s) for "${profile.name}". ` +
            `It is defined in ${profile.sourceFile}, so apply them by hand. The block is in the output channel.`,
          );
          return;
        }

        const accepted = await vscode.window.showInformationMessage(
          `Forge: apply ${changes.length} probed capability change(s) to "${profile.name}"?\n\n${diff}`,
          { modal: true },
          'Apply',
        );
        if (accepted !== 'Apply') {
          logService.info('  rejected; nothing written.');
          return;
        }

        // Back into the scope that holds this profile, and only that scope's
        // map: writing the merged view into Workspace settings copied every
        // user-level profile into the repository (and threw with no folder).
        const config = vscode.workspace.getConfiguration('forge');
        const inspected = config.inspect<Record<string, any>>('endpoints');
        // User settings only: `forge.endpoints` is machine-scoped.
        const map = { ...(inspected?.globalValue ?? {}) };
        const entry = { ...(map[profile.name] ?? {}) };
        entry.capabilities = { ...(entry.capabilities ?? {}), ...Object.fromEntries(changes) };
        map[profile.name] = entry;
        await config.update('endpoints', map, vscode.ConfigurationTarget.Global);
        await endpointService.reset();
        logService.info(`  applied ${changes.length} change(s) to forge.endpoints.${profile.name}.`);
        void vscode.window.showInformationMessage(`Forge: updated "${profile.name}".`);
      },

      'forge.listEndpointModels': async () => {
        const profile = await pickProfile('Which endpoint should Forge list models for?');
        if (!profile) return;

        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Forge: listing models on ${profile.name}` },
          async () => listModels(profile, await endpointService.secretsFor(profile)),
        );

        if (result.error) {
          void vscode.window.showWarningMessage(
            `Forge: could not list models on "${profile.name}": ${result.error}. The model field stays free text.`,
          );
          return;
        }

        const picked = await vscode.window.showQuickPick(
          result.models.map((m) => ({
            label: m.id,
            description: m.id === profile.model ? 'current' : '',
            detail: [
              m.contextWindow ? `context ${m.contextWindow.toLocaleString()}` : '',
              m.tools === undefined ? '' : `tools ${m.tools ? 'yes' : 'no'}`,
              m.reasoning === undefined ? '' : `reasoning ${m.reasoning ? 'yes' : 'no'}`,
            ].filter(Boolean).join('  |  '),
            model: m,
          })),
          {
            title: `${result.listed} model(s) on ${profile.name}`,
            placeHolder: 'Listed is not the same as servable. Verify before relying on one',
          },
        );
        if (!picked) return;

        // Listing is not an answer. Verify the one id that was picked, because
        // an id that is listed and not servable otherwise costs a full timeout
        // to discover during a real turn.
        const [verdict] = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Forge: checking "${picked.label}" answers` },
          async () => keepServable(profile, [picked.label], await endpointService.secretsFor(profile)),
        );

        if (!verdict?.servable) {
          void vscode.window.showWarningMessage(
            `Forge: "${picked.label}" is listed but did not answer: ${verdict?.detail ?? 'no response'}.`,
          );
          return;
        }

        logService.info(`[endpoints] "${picked.label}" answered in ${verdict.ms}ms on ${profile.name}.`);
        void vscode.window.showInformationMessage(
          `Forge: "${picked.label}" answered in ${verdict.ms}ms. Set it as "model" in forge.endpoints.${profile.name}.`,
        );
      },

      'forge.openWalkthrough': async () => {
        await vscode.commands.executeCommand(
          'workbench.action.openWalkthrough',
          `${context.extension.id}#forge-walkthrough`,
          false,
        );
      },
    };

    for (const { command } of FORGE_COMMANDS) {
      context.subscriptions.push(
        // The arguments are forwarded. They used to be collected into `args`
        // and then thrown away with `void args`, so every command ran with no
        // parameters at all -- which is why `forge.openSettings` opened General
        // however specific the "/" menu row was. The old `Record<…, () => unknown>`
        // type hid it: a handler declaring `(section?: unknown)` is assignable
        // to a zero-argument signature, so nothing complained.
        vscode.commands.registerCommand(command, async (...args: unknown[]) => {
          try {
            await impls[command as ForgeCommandId](...args);
          } catch (error) {
            logService.error(`[Command] ${command} 执行失败`, error);
            void vscode.window.showErrorMessage(
              `Forge: ${command} failed -- ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
    }

    // Nothing is under review at startup.
    setProposedDiffHandler(undefined);

    logService.info(`✓ 已注册 ${FORGE_COMMANDS.length} 个 Forge 命令`);
  });
}

/**
 * Create a git worktree for the current repository and offer to open it.
 *
 * Worktrees are the safe way to let an agent work on a branch without disturbing
 * the checkout you are looking at, which is why the official extension offers it.
 */
async function createWorktree(logService: ILogService): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Forge: open a folder before creating a worktree.');
    return;
  }

  const branch = await vscode.window.showInputBox({
    title: 'Forge: Create Worktree',
    prompt: 'Branch name for the new worktree',
    placeHolder: 'feature/my-change',
    validateInput: (v) =>
      !v.trim() ? 'Branch name is required'
        : /\s/.test(v) ? 'Branch names cannot contain spaces'
          : undefined,
  });
  if (!branch) return;

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const path = await import('node:path');
  const run = promisify(execFile);

  // Place the worktree beside the repository rather than inside it, so it does
  // not show up as untracked content in the original checkout.
  const target = path.join(path.dirname(folder.uri.fsPath), `${path.basename(folder.uri.fsPath)}-${branch.replace(/[/\\]/g, '-')}`);

  try {
    await run('git', ['worktree', 'add', '-b', branch, target], { cwd: folder.uri.fsPath });
    logService.info(`[Command] worktree created: ${target}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logService.error('[Command] git worktree add 失败', error);
    void vscode.window.showErrorMessage(`Forge: could not create worktree -- ${message}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `Forge: worktree created at ${target}`,
    'Open in New Window',
    'Open Here',
  );
  if (choice === 'Open in New Window') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), true);
  } else if (choice === 'Open Here') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), false);
  }
}
