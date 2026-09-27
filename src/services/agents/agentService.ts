/**
 * Hermes agents on the Claude Agent SDK.
 *
 * Forge has two kinds of agent. A Claude Code agent (`.claude/agents`) is a
 * subagent the CLI hands tasks to. A Hermes agent (this file) is who the whole
 * conversation runs as. Genesis ran its agents inside its own loop, where it
 * could filter every tool call itself. Forge's loop is the `claude` CLI, so the
 * same definitions have to be expressed in terms the SDK understands before the
 * process starts (`scope.ts` has the why):
 *
 *   persona + memory  ->  systemPrompt append
 *   model             ->  Options.model
 *   tools: [...]      ->  Options.tools (Hermes names mapped to Claude Code's),
 *                         and a PreToolUse deny for anything outside them
 *   skills: [...]     ->  Options.skills
 *   mcp: {...}        ->  disallowedTools where the CLI can express it, and the
 *                         same PreToolUse deny for the rest
 *   endpoint          ->  the agent's own endpoint profile (its own base URL)
 *
 * Nothing here approves a tool: a scope only takes tools away, and every tool
 * left still asks as the permission mode says.
 *
 * The scope is fixed for the lifetime of a session, so switching agents starts
 * a new one.
 *
 * Agents are Markdown files with YAML frontmatter, in `.forge/agents` in the
 * workspace (or wherever `forge.agentsDir` points). The loader is ported from
 * Genesis unchanged, so existing Hermes agent files work as they are.
 */
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import {
  loadAgents,
  agentPrompt,
  agentTemplate,
  hermesAgentMarkdown,
  matchesGlob,
  resolveAgentsDir,
  MAX_MEMORY_CHARS,
  type Agent,
} from './loader';
import { builtinScope, mcpDisallowed, scopeRefusal } from './scope';

export const IAgentService = createDecorator<IAgentService>('agentService');

/** What an agent contributes to the SDK options for a session. */
export interface AgentSdkOptions {
  /** The agent these options came from, for the log. */
  name: string;
  /** Appended to the Claude Code system preset. */
  systemPromptAppend: string;
  /** Model override, or undefined to keep the session's model. */
  model?: string;
  /**
   * `Options.tools`: the built-ins the session has at all. Undefined means
   * every built-in; this is a scope, never an approval.
   */
  tools?: string[];
  /** `Options.skills`: the skills the session may load. Undefined leaves the CLI's default. */
  skills?: string[];
  /** MCP tools the CLI drops before the model sees them. */
  disallowedTools?: string[];
  /** Endpoint profile name this agent binds to, if any. */
  endpointProfile?: string;
  /**
   * Why a call is outside the scope, for the PreToolUse deny; undefined when
   * the call may run. Covers what `tools` cannot: globs and MCP servers.
   */
  refusal(toolName: string): string | undefined;
}

/** What "Create Agent" asks for a Hermes agent. */
export interface NewHermesAgent {
  name: string;
  description: string;
  /** Claude Code tool names; empty for every tool. */
  tools: readonly string[];
}

export interface IAgentService {
  readonly _serviceBrand: undefined;

  /** Agents that parse, plus warnings for the ones that do not. */
  list(): { agents: Agent[]; warnings: string[] };

  /** The agent named by `forge.activeAgent`, if it exists. */
  getActive(): Agent | undefined;

  /** Translate an agent into the options the SDK needs. */
  toSdkOptions(agent: Agent): AgentSdkOptions;

  /** Options for the active agent, or undefined when none is selected. */
  getActiveSdkOptions(): AgentSdkOptions | undefined;

  /** Create a starter agent file and return its path. */
  scaffold(name: string): Promise<string>;

  /**
   * Write a Hermes agent from "Create Agent"'s answers and return its path.
   * Throws when there is nowhere to put it or the name is taken.
   */
  create(agent: NewHermesAgent): Promise<string>;

  /** Directory agents are read from. */
  getAgentsDir(): string;

  /**
   * The directory, or undefined when `forge.agentsDir` is relative and no
   * folder is open: a Hermes agent belongs to a workspace, so there is then
   * nowhere to write one.
   */
  getWorkspaceAgentsDir(): string | undefined;
}

export class AgentService implements IAgentService {
  readonly _serviceBrand: undefined;

  constructor(@ILogService private readonly logService: ILogService) {}

  getAgentsDir(): string {
    return this.getWorkspaceAgentsDir() ?? resolveAgentsDir(this.configuredDir(), process.cwd())!;
  }

  getWorkspaceAgentsDir(): string | undefined {
    return resolveAgentsDir(this.configuredDir(), vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  }

  private configuredDir(): string {
    return vscode.workspace.getConfiguration('forge').get<string>('agentsDir', '') ?? '';
  }

  list(): { agents: Agent[]; warnings: string[] } {
    const result = loadAgents(this.getAgentsDir());
    for (const w of result.warnings) this.logService.warn(`[agents] ${w}`);
    return result;
  }

  getActive(): Agent | undefined {
    const name = vscode.workspace.getConfiguration('forge').get<string>('activeAgent', '')?.trim();
    if (!name) return undefined;

    const { agents } = this.list();
    const agent = agents.find((a) => a.name === name);
    if (!agent) {
      this.logService.warn(
        `[agents] forge.activeAgent is "${name}", but no such agent exists in ${this.getAgentsDir()}. ` +
        `Available: ${agents.map((a) => a.name).join(', ') || '(none)'}.`,
      );
    }
    return agent;
  }

  toSdkOptions(agent: Agent): AgentSdkOptions {
    const memoryBody = this.readMemory(agent);
    const systemPromptAppend = agentPrompt(agent, memoryBody);

    // Built-in tools, in Claude Code's names. An empty `tools` list means
    // "unrestricted", which is the loader's documented contract -- do not
    // confuse it with "none".
    const { tools, unknown } = builtinScope(agent);
    if (unknown.length) {
      this.logService.warn(
        `[agents] ${agent.name}: tools ${unknown.join(', ')} name no Claude Code tool and no Hermes tool ` +
        `with a Claude Code counterpart, so they are not offered. MCP tools go under mcp:, not tools:.`,
      );
    }
    const disallowed = mcpDisallowed(agent);

    return {
      name: agent.name,
      systemPromptAppend,
      model: agent.model || undefined,
      tools,
      skills: agent.skills.length ? [...agent.skills] : undefined,
      disallowedTools: disallowed.length ? disallowed : undefined,
      endpointProfile: this.endpointProfileFor(agent),
      refusal: (toolName: string) => scopeRefusal(agent, tools, toolName),
    };
  }

  getActiveSdkOptions(): AgentSdkOptions | undefined {
    const agent = this.getActive();
    if (!agent) return undefined;

    const options = this.toSdkOptions(agent);
    this.logService.info(`🧠 Active agent: ${agent.name}`);
    this.logService.info(`  - model: ${options.model ?? '(session default)'}`);
    this.logService.info(`  - tools: ${options.tools?.join(', ') ?? '(unrestricted)'}`);
    if (options.skills) {
      this.logService.info(`  - skills: ${options.skills.join(', ')}`);
    }
    this.logService.info(
      `  - mcp: ${agent.allMcp ? '(unrestricted)' : agent.mcp.map((m) => m.server).join(', ') || 'none'}`,
    );
    if (options.disallowedTools?.length) {
      this.logService.info(`  - disallowedTools: ${options.disallowedTools.join(', ')}`);
    }
    if (options.endpointProfile) {
      this.logService.info(`  - endpoint: ${options.endpointProfile}`);
    }
    return options;
  }

  /**
   * Per-agent endpoint binding.
   *
   * Read from `forge.agentEndpoints`, a name -> profile map, rather than from the
   * agent file, so that sharing an agent definition does not also share one
   * machine's gateway configuration.
   */
  private endpointProfileFor(agent: Agent): string | undefined {
    const map = vscode.workspace
      .getConfiguration('forge')
      .get<Record<string, string>>('agentEndpoints', {});
    const value = map?.[agent.name];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private readMemory(agent: Agent): string | undefined {
    if (!agent.memory) return undefined;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const file = path.isAbsolute(agent.memory) ? agent.memory : path.join(root, agent.memory);
    try {
      const body = fs.readFileSync(file, 'utf8');
      if (body.length > MAX_MEMORY_CHARS) {
        this.logService.warn(
          `[agents] ${agent.name}: memory file ${agent.memory} is ${body.length} chars, ` +
          `truncating to ${MAX_MEMORY_CHARS}. It is sent on every request, so keep it short.`,
        );
        return body.slice(0, MAX_MEMORY_CHARS);
      }
      return body;
    } catch {
      // Not written yet. agentPrompt() says so in the prompt rather than failing.
      return undefined;
    }
  }

  async scaffold(name: string): Promise<string> {
    return this.write(this.getAgentsDir(), name, agentTemplate(name, []));
  }

  async create(agent: NewHermesAgent): Promise<string> {
    const dir = this.getWorkspaceAgentsDir();
    if (!dir) {
      throw new Error('Open a folder first: a Hermes agent lives in the workspace, in .forge/agents.');
    }
    return this.write(dir, agent.name, hermesAgentMarkdown(agent));
  }

  private async write(dir: string, name: string, content: string): Promise<string> {
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}.md`);
    try {
      // wx: never clobber an agent that already exists.
      await fs.promises.writeFile(file, content, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`An agent named "${name}" already exists at ${file}.`);
      }
      throw e;
    }
    this.logService.info(`[agents] created ${file}`);
    return file;
  }
}

/** Re-exported so callers do not have to reach into the ported loader. */
export { matchesGlob, type Agent };
