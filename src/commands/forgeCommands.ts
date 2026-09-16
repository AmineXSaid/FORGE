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
import type { UiCommandName } from '../shared/messages';

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
 * Every command Forge registers. `title` is what the palette shows and must match
 * package.json exactly.
 */
export const FORGE_COMMANDS = [
  { command: 'forge.sidebar.open', title: 'Forge: Open in Side Bar' },
  { command: 'forge.editor.open', title: 'Forge: Open in New Tab' },
  { command: 'forge.editor.openLast', title: 'Forge: Open' },
  { command: 'forge.sessions.open', title: 'Forge: Past Conversations' },
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
  { command: 'forge.endpointStatus', title: 'Forge: Show Endpoint Status' },
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
     * Reveal whichever chat view is live.
     *
     * Only the view whose container passes its `when` clause exists, so focusing
     * the other throws. Try the configured one first and fall back, rather than
     * assuming the setting and the workbench agree.
     */
    const revealSidebar = async () => {
      const preferred = vscode.workspace
        .getConfiguration('forge')
        .get<string>('preferredLocation', 'secondary');
      const order = preferred === 'primary'
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

    const impls: Record<ForgeCommandId, () => unknown> = {
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

      'forge.openSettings': () => {
        try {
          // The settings page is a singleton, so it takes no instanceId.
          webViewService.openEditorPage('settings', 'Forge Settings');
        } catch (error) {
          logService.error('[Command] 打开 Settings 页面失败', error);
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

        const items: (vscode.QuickPickItem & { profile: string })[] = [
          {
            label: '$(cloud) Default (Anthropic)',
            description: active ? '' : 'current',
            detail: 'Talk to the Anthropic API directly, with no relay.',
            profile: '',
          },
          ...profiles.map((pr) => ({
            label: `$(plug) ${pr.name}`,
            description: pr.name === active ? 'current' : '',
            detail: [pr.description, pr.baseUrl, `model: ${pr.model}`, `wire: ${pr.wire}`]
              .filter(Boolean).join('  |  '),
            profile: pr.name,
          })),
        ];

        const picked = await vscode.window.showQuickPick(items, {
          title: 'Forge: Select Endpoint Profile',
          placeHolder: profiles.length ? 'Pick the gateway Forge should route through' : 'No profiles found',
        });
        if (!picked) return;

        await vscode.workspace
          .getConfiguration('forge')
          .update('endpointProfile', picked.profile, vscode.ConfigurationTarget.Workspace);
        // Drop the running relay so the next turn builds the new transport.
        await endpointService.reset();
        void vscode.window.showInformationMessage(
          `Forge: endpoint set to ${picked.profile || 'Default (Anthropic)'}.`,
        );
      },

      'forge.endpointStatus': () => {
        const status = endpointService.getStatus();
        logService.show();
        logService.info('--- Forge endpoint status ---');
        logService.info(`  active profile : ${status.profile?.name ?? '(none -- using Anthropic directly)'}`);
        if (status.profile) logService.info(`  upstream       : ${status.profile.baseUrl}`);
        if (status.baseUrl) logService.info(`  relay          : ${status.baseUrl}`);
        for (const line of status.report) logService.info(`  ${line}`);
        for (const e of status.errors) logService.warn(`  ! ${e.file ?? 'profile'}: ${e.message}`);
        if (!status.report.length && !status.profile) {
          logService.info('  (no relay running)');
        }
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
        vscode.commands.registerCommand(command, async (...args: unknown[]) => {
          try {
            await impls[command as ForgeCommandId]();
          } catch (error) {
            logService.error(`[Command] ${command} 执行失败`, error);
            void vscode.window.showErrorMessage(
              `Forge: ${command} failed -- ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          void args;
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
