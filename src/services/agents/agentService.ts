/**
 * Hermes agents on the Claude Agent SDK.
 *
 * Genesis ran its agents inside its own loop, where it could filter every tool
 * call itself. Forge's loop is the `claude` CLI, so the same definitions have to
 * be expressed in terms the SDK understands before the process starts:
 *
 *   persona + memory  ->  systemPrompt append
 *   model             ->  Options.model
 *   tools: [...]      ->  allowedTools
 *   mcp: {...}        ->  mcpServers, plus allowed/disallowedTools per server
 *   endpoint          ->  the agent's own endpoint profile (its own base URL)
 *
 * The consequence worth stating: scoping is enforced by the CLI from the
 * allowlist we hand it, not by a filter Forge applies to each call. That is
 * stronger, because a tool the CLI never learns about cannot be invoked at all --
 * but it means the scope is fixed for the lifetime of a session, so switching
 * agents starts a new one.
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
  matchesGlob,
  MAX_MEMORY_CHARS,
  type Agent,
} from './loader';

export const IAgentService = createDecorator<IAgentService>('agentService');

/** What an agent contributes to the SDK options for a session. */
export interface AgentSdkOptions {
  /** Appended to the Claude Code system preset. */
  systemPromptAppend: string;
  /** Model override, or undefined to keep the session's model. */
  model?: string;
  /** Built-in + MCP tools this agent may use. Undefined means no restriction. */
  allowedTools?: string[];
  /** Applied after allowedTools, for `exclude` globs. */
  disallowedTools?: string[];
  /** Endpoint profile name this agent binds to, if any. */
  endpointProfile?: string;
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

  /** Directory agents are read from. */
  getAgentsDir(): string;
}

/**
 * How an MCP tool is named once the CLI exposes it. The SDK follows the CLI's
 * convention of `mcp__<server>__<tool>`, so an agent's per-server scope has to be
 * expressed in that namespace to have any effect.
 */
function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

export class AgentService implements IAgentService {
  readonly _serviceBrand: undefined;

  constructor(@ILogService private readonly logService: ILogService) {}

  getAgentsDir(): string {
    const configured = vscode.workspace.getConfiguration('forge').get<string>('agentsDir', '');
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    if (configured?.trim()) {
      return path.isAbsolute(configured) ? configured : path.join(root, configured);
    }
    return path.join(root, '.forge', 'agents');
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

    // Built-in tools. An empty `tools` list means "unrestricted", which is the
    // loader's documented contract -- do not confuse it with "none".
    const allowed: string[] = [...agent.tools];
    const disallowed: string[] = [];

    // MCP scope. `allMcp` means the agent declared no `mcp` key (or `mcp: "*"`),
    // so nothing is restricted. Otherwise each server contributes its own names.
    if (!agent.allMcp) {
      for (const scope of agent.mcp) {
        if (scope.include.length === 0) {
          // Whole server allowed -- but only if the agent is restricting built-ins
          // too, otherwise adding entries here would narrow nothing.
          allowed.push(`mcp__${scope.server}`);
        }
        for (const tool of scope.include) {
          allowed.push(mcpToolName(scope.server, tool));
        }
        for (const tool of scope.exclude) {
          disallowed.push(mcpToolName(scope.server, tool));
        }
      }
    }

    return {
      systemPromptAppend,
      model: agent.model || undefined,
      // Only send an allowlist when the agent actually restricts something.
      // An empty array would mean "no tools at all", which is not what an
      // unrestricted agent asked for.
      allowedTools: allowed.length ? allowed : undefined,
      disallowedTools: disallowed.length ? disallowed : undefined,
      endpointProfile: this.endpointProfileFor(agent),
    };
  }

  getActiveSdkOptions(): AgentSdkOptions | undefined {
    const agent = this.getActive();
    if (!agent) return undefined;

    const options = this.toSdkOptions(agent);
    this.logService.info(`🧠 Active agent: ${agent.name}`);
    this.logService.info(`  - model: ${options.model ?? '(session default)'}`);
    this.logService.info(`  - allowedTools: ${options.allowedTools?.join(', ') ?? '(unrestricted)'}`);
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
    const dir = this.getAgentsDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}.md`);
    try {
      // wx: never clobber an agent that already exists.
      await fs.promises.writeFile(file, agentTemplate(name, []), { flag: 'wx' });
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
