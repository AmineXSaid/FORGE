/**
 * A Hermes agent's scope, in the terms of the engine that runs it: Claude Code.
 *
 * An agent file says which tools, skills and MCP servers the agent may use. The
 * CLI only honours that if it is handed over in the CLI's own words, at two
 * boundaries (`sdk.d.ts` Options):
 *
 *   advertisement  `tools` is the set of built-ins the session has at all, and
 *                  `skills` the skills it may load; a tool that is not offered
 *                  cannot be called. `allowedTools` is NOT a scope: it only
 *                  approves tools without asking, so it is never used here --
 *                  an agent scoped to Bash must not run Bash unasked.
 *   execution      a PreToolUse hook denies any call outside the scope, with a
 *                  reason the model can act on. This is what covers globs and
 *                  MCP servers, which `tools` cannot express, and a model that
 *                  names a tool it was never offered.
 *
 * Hermes names its tools differently (`read_file`, `patch`, `terminal`), so an
 * agent file written for Hermes keeps its meaning: each Hermes name maps to the
 * Claude Code tool that does the same job.
 *
 * Pure, so the spec drives it without VS Code.
 */
import { agentAllowsMcp, matchesGlob, type Agent } from './loader';

/**
 * Claude Code's built-in tools that an agent can name (the SDK's tool inputs,
 * `sdk-tools.d.ts`, on CLI 2.1.274). A name outside this list is still passed
 * through if it is written the Claude Code way (capitalised): the CLI knows its
 * own tools better than this list does, and warns about a typo itself.
 */
export const CLAUDE_CODE_TOOLS = [
  'Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'Bash', 'TaskOutput', 'TaskStop',
  'WebFetch', 'WebSearch', 'Agent', 'Skill', 'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskUpdate',
  'TaskList', 'ExitPlanMode', 'EnterPlanMode', 'AskUserQuestion', 'ListMcpResources', 'ReadMcpResource',
] as const;

/**
 * Tools that run the conversation rather than touch the workspace: the task
 * list, plan mode, asking the user, loading a skill. A scoped agent keeps them,
 * or Plan mode could not be left and the todo list would go blank.
 */
export const CONVERSATION_TOOLS: readonly string[] = [
  'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList',
  'ExitPlanMode', 'EnterPlanMode', 'AskUserQuestion', 'Skill',
];

/** Tools that only make sense with another: reading and stopping what Bash or an agent started. */
const COMPANIONS: Record<string, readonly string[]> = {
  Bash: ['TaskOutput', 'TaskStop'],
  Agent: ['TaskOutput', 'TaskStop'],
};

/**
 * Hermes's tool names (hermes-agent `tools/`, plus the Genesis names Forge's
 * own template used), mapped to the Claude Code tools that do the same job.
 */
export const HERMES_TOOL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  read_file: ['Read'],
  read_text_file: ['Read'],
  write_file: ['Write'],
  patch: ['Edit'],
  edit_file: ['Edit'],
  search_files: ['Grep', 'Glob'],
  search: ['Grep'],
  grep: ['Grep'],
  glob: ['Glob'],
  list_files: ['Glob'],
  list_directory: ['Glob'],
  terminal: ['Bash'],
  execute_code: ['Bash'],
  process_manage: ['Bash'],
  web_search: ['WebSearch'],
  web_extract: ['WebFetch'],
  delegate_task: ['Agent'],
  todo_list: ['TodoWrite'],
  clarify: ['AskUserQuestion'],
  skill_view: ['Skill'],
  skills_list: ['Skill'],
};

const MCP_PREFIX = 'mcp__';

/**
 * An agent's `tools:` list in Claude Code's names. `unknown` holds entries that
 * name neither a Claude Code tool nor a Hermes tool with a Claude Code
 * counterpart (a Hermes browser or messaging tool, say): they are dropped, and
 * the caller logs them.
 */
export function claudeToolNames(entries: readonly string[]): { tools: string[]; unknown: string[] } {
  const tools = new Set<string>();
  const unknown: string[] = [];
  const known = new Set<string>(CLAUDE_CODE_TOOLS);
  const add = (names: readonly string[]) => names.forEach((n) => tools.add(n));

  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.startsWith(MCP_PREFIX)) {
      // MCP tools are scoped by `mcp:`, not `tools:`.
      unknown.push(entry);
      continue;
    }
    if (entry.includes('*')) {
      const matched = [
        ...CLAUDE_CODE_TOOLS.filter((t) => matchesGlob(entry, t)),
        ...Object.keys(HERMES_TOOL_ALIASES)
          .filter((h) => matchesGlob(entry, h))
          .flatMap((h) => HERMES_TOOL_ALIASES[h]),
      ];
      if (matched.length) add(matched);
      else unknown.push(entry);
      continue;
    }
    if (known.has(entry)) {
      tools.add(entry);
    } else if (Object.prototype.hasOwnProperty.call(HERMES_TOOL_ALIASES, entry)) {
      add(HERMES_TOOL_ALIASES[entry]);
    } else if (/^[A-Z][A-Za-z]*$/.test(entry)) {
      tools.add(entry);
    } else {
      unknown.push(entry);
    }
  }
  return { tools: [...tools], unknown };
}

/**
 * The built-ins a scoped agent's session has: its own list in Claude Code
 * names, their companions, and the conversation tools. Undefined when the agent
 * declares no `tools:` -- unrestricted, which is not the same as none.
 */
export function builtinScope(agent: Agent): { tools?: string[]; unknown: string[] } {
  if (!agent.tools.length) return { tools: undefined, unknown: [] };
  const { tools, unknown } = claudeToolNames(agent.tools);
  const scoped = new Set<string>(tools);
  for (const tool of tools) (COMPANIONS[tool] ?? []).forEach((c) => scoped.add(c));
  CONVERSATION_TOOLS.forEach((t) => scoped.add(t));
  return { tools: [...scoped], unknown };
}

/** `mcp__<server>__<tool>`, split; undefined for a built-in. */
export function parseMcpToolName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith(MCP_PREFIX)) return undefined;
  const rest = name.slice(MCP_PREFIX.length);
  const cut = rest.indexOf('__');
  if (cut <= 0) return undefined;
  return { server: rest.slice(0, cut), tool: rest.slice(cut + 2) };
}

/**
 * Why this call is outside the agent's scope, for the model to read; undefined
 * when the scope allows it. `builtins` is `builtinScope(agent).tools`.
 */
export function scopeRefusal(agent: Agent, builtins: readonly string[] | undefined, toolName: string): string | undefined {
  const mcp = parseMcpToolName(toolName);
  if (mcp) {
    if (agentAllowsMcp(agent, mcp.server, mcp.tool)) return undefined;
    const reach = agent.mcp.length ? agent.mcp.map((s) => s.server).join(', ') : 'no MCP servers';
    return (
      `Refused: "${toolName}" was not called. The ${agent.name} agent may reach ${reach}, ` +
      `and not this tool. Do the work with what you have, or tell the user which agent to switch to.`
    );
  }
  if (!builtins || builtins.includes(toolName)) return undefined;
  const own = builtins.filter((t) => !CONVERSATION_TOOLS.includes(t));
  return (
    `Refused: "${toolName}" was not called. The ${agent.name} agent is scoped to ` +
    `${own.length ? own.join(', ') : 'no workspace tools'}. Do the work with what you have, ` +
    `or tell the user which agent to switch to.`
  );
}

/**
 * MCP tools the CLI can drop before the model ever sees them: an agent that
 * reaches no MCP at all loses every MCP tool, and an exact `exclude` loses that
 * tool. Globs and servers left out of the list are refused at call time
 * (`scopeRefusal`), since the CLI's rules name servers, not patterns of tools.
 */
export function mcpDisallowed(agent: Agent): string[] {
  if (agent.allMcp) return [];
  if (!agent.mcp.length) return [`${MCP_PREFIX}*`];
  return agent.mcp.flatMap((scope) =>
    scope.exclude.filter((t) => !t.includes('*')).map((t) => `${MCP_PREFIX}${scope.server}__${t}`),
  );
}
