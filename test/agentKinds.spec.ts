/**
 * Forge's two kinds of agent, and the one way to create either.
 *
 * - A **Claude Code agent** (`.claude/agents`) is a subagent the CLI hands
 *   tasks to.
 * - A **Hermes agent** (`.forge/agents`) is who the whole conversation runs
 *   as: persona, model, memory, and a scope of tools that is enforced.
 *
 * "Forge: Create Agent" asks which kind first, from every way in. What is under
 * test: the choice and both flows; that a Hermes agent's scope reaches the CLI
 * as a scope (`tools`, `skills`, `disallowedTools`, a PreToolUse deny) and never
 * as an approval (`allowedTools`); that Hermes tool names keep their meaning on
 * Claude Code; and that Settings › Agents lists both kinds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  AGENT_KINDS,
  AGENT_TOOLSETS,
  USE_HERMES_AGENT,
  createAgent,
  type HermesAgentDeps,
} from '../src/commands/customizationCommands';
import { AgentService } from '../src/services/agents/agentService';
import { hermesAgentMarkdown, loadAgents, resolveAgentsDir, type Agent } from '../src/services/agents/loader';
import {
  CONVERSATION_TOOLS,
  builtinScope,
  claudeToolNames,
  mcpDisallowed,
  parseMcpToolName,
  scopeRefusal,
} from '../src/services/agents/scope';
import { FORGE_ACTION_COMMANDS, handleListForgeItems } from '../src/services/claude/handlers/handlers';

const ROOT = path.join(__dirname, '..');

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: 'reviewer',
    description: 'Reviews changes.',
    persona: 'You review.',
    model: '',
    memory: '',
    tools: [],
    skills: [],
    mcp: [],
    allMcp: true,
    file: '/repo/.forge/agents/reviewer.md',
    ...overrides,
  };
}

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() });

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agents-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  (vscode.workspace as any).workspaceFolders = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Hermes tool names keep their meaning on Claude Code', () => {
  it('passes Claude Code names through', () => {
    expect(claudeToolNames(['Read', 'Grep', 'Glob']).tools).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('maps Hermes names to the Claude Code tool that does the same job', () => {
    const { tools, unknown } = claudeToolNames([
      'read_file', 'write_file', 'patch', 'terminal', 'search_files', 'web_search', 'web_extract', 'delegate_task',
    ]);
    expect(tools.sort()).toEqual(['Agent', 'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Write']);
    expect(unknown).toEqual([]);
  });

  it('expands globs over both vocabularies', () => {
    expect(claudeToolNames(['read_*']).tools).toEqual(['Read']);
    expect(claudeToolNames(['Web*']).tools.sort()).toEqual(['WebFetch', 'WebSearch']);
  });

  it('drops what has no Claude Code counterpart, and says so', () => {
    const { tools, unknown } = claudeToolNames(['Read', 'browser_click', 'mcp__github__list_issues', 'nope_*']);
    expect(tools).toEqual(['Read']);
    expect(unknown).toEqual(['browser_click', 'mcp__github__list_issues', 'nope_*']);
  });

  it('lets a Claude Code tool it does not list through, for the CLI to judge', () => {
    expect(claudeToolNames(['LSP']).tools).toEqual(['LSP']);
  });

  it('does not repeat a tool two names map to', () => {
    expect(claudeToolNames(['Read', 'read_file', 'read_text_file']).tools).toEqual(['Read']);
  });
});

describe('a Hermes agent’s scope', () => {
  it('no tools key: unrestricted, not none', () => {
    expect(builtinScope(agent()).tools).toBeUndefined();
    expect(scopeRefusal(agent(), undefined, 'Bash')).toBeUndefined();
  });

  it('read-only: Read, Grep, Glob and the conversation tools, nothing that changes files', () => {
    const scoped = builtinScope(agent({ tools: ['Read', 'Grep', 'Glob'] })).tools!;
    expect(scoped).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', ...CONVERSATION_TOOLS]));
    expect(scoped).not.toContain('Bash');
    expect(scoped).not.toContain('Edit');
    expect(scoped).not.toContain('Write');
    expect(scoped).not.toContain('Agent');
  });

  it('keeps plan mode, the todo list and questions to the user in any scope', () => {
    const a = agent({ tools: ['Read'] });
    const tools = builtinScope(a).tools;
    for (const t of ['ExitPlanMode', 'TodoWrite', 'AskUserQuestion']) expect(scopeRefusal(a, tools, t)).toBeUndefined();
  });

  it('gives Bash its companions, which read and stop what it started', () => {
    expect(builtinScope(agent({ tools: ['Bash'] })).tools).toEqual(expect.arrayContaining(['Bash', 'TaskOutput', 'TaskStop']));
  });

  it('refuses a built-in outside the scope, with a reason the model can act on', () => {
    const a = agent({ tools: ['Read', 'Grep', 'Glob'] });
    const reason = scopeRefusal(a, builtinScope(a).tools, 'Bash');
    expect(reason).toMatch(/^Refused: "Bash" was not called\. The reviewer agent is scoped to Read, Grep, Glob\./);
    expect(scopeRefusal(a, builtinScope(a).tools, 'Read')).toBeUndefined();
  });

  it('a Hermes-named scope refuses the same calls a Claude-named one does', () => {
    const hermes = agent({ tools: ['read_file', 'search_files'] });
    const tools = builtinScope(hermes).tools;
    expect(scopeRefusal(hermes, tools, 'Read')).toBeUndefined();
    expect(scopeRefusal(hermes, tools, 'Grep')).toBeUndefined();
    expect(scopeRefusal(hermes, tools, 'Edit')).toMatch(/^Refused/);
  });

  it('MCP: every server unless the agent names its own', () => {
    expect(scopeRefusal(agent(), undefined, 'mcp__github__delete_repo')).toBeUndefined();
    const scoped = agent({ allMcp: false, mcp: [{ server: 'fs', include: ['read_*'], exclude: [] }] });
    expect(scopeRefusal(scoped, undefined, 'mcp__fs__read_text_file')).toBeUndefined();
    expect(scopeRefusal(scoped, undefined, 'mcp__fs__write_file')).toMatch(/^Refused: "mcp__fs__write_file"/);
    expect(scopeRefusal(scoped, undefined, 'mcp__github__list_issues')).toMatch(/may reach fs/);
  });

  it('MCP excludes: refused at call time, and dropped up front when the name is exact', () => {
    const a = agent({ allMcp: false, mcp: [{ server: 'github', include: [], exclude: ['delete_*', 'merge_pr'] }] });
    expect(scopeRefusal(a, undefined, 'mcp__github__delete_repo')).toMatch(/^Refused/);
    expect(scopeRefusal(a, undefined, 'mcp__github__list_issues')).toBeUndefined();
    expect(mcpDisallowed(a)).toEqual(['mcp__github__merge_pr']);
  });

  it('no MCP at all: every MCP tool dropped up front', () => {
    expect(mcpDisallowed(agent({ allMcp: false, mcp: [] }))).toEqual(['mcp__*']);
    expect(mcpDisallowed(agent())).toEqual([]);
  });

  it('reads MCP tool names, and treats a malformed one as a built-in', () => {
    expect(parseMcpToolName('mcp__github__list_issues')).toEqual({ server: 'github', tool: 'list_issues' });
    expect(parseMcpToolName('mcp__github')).toBeUndefined();
    expect(parseMcpToolName('Read')).toBeUndefined();
    const a = agent({ tools: ['Read'] });
    expect(scopeRefusal(a, builtinScope(a).tools, 'mcp__github')).toMatch(/^Refused/);
  });
});

describe('the SDK options a Hermes agent contributes', () => {
  it('a scope, never an approval: tools, skills and disallowedTools, no allowedTools', () => {
    const service = new AgentService(log() as any);
    const options = service.toSdkOptions(agent({
      tools: ['read_file', 'Grep'],
      skills: ['release-notes'],
      allMcp: false,
      mcp: [{ server: 'github', include: [], exclude: ['delete_issue'] }],
    }));
    expect(options).not.toHaveProperty('allowedTools');
    expect(options.tools).toEqual(expect.arrayContaining(['Read', 'Grep']));
    expect(options.tools).not.toContain('Bash');
    expect(options.skills).toEqual(['release-notes']);
    expect(options.disallowedTools).toEqual(['mcp__github__delete_issue']);
    expect(options.refusal('Bash')).toMatch(/^Refused/);
    expect(options.refusal('Read')).toBeUndefined();
  });

  it('an unrestricted agent restricts nothing', () => {
    const options = new AgentService(log() as any).toSdkOptions(agent());
    expect(options.tools).toBeUndefined();
    expect(options.skills).toBeUndefined();
    expect(options.disallowedTools).toBeUndefined();
    expect(options.refusal('Bash')).toBeUndefined();
  });

  it('logs tool names it cannot map, instead of silently offering nothing', () => {
    const logs = log();
    new AgentService(logs as any).toSdkOptions(agent({ tools: ['Read', 'browser_click'] }));
    expect(logs.warn).toHaveBeenCalledWith(expect.stringMatching(/tools browser_click name no Claude Code tool/));
  });

  it('the session launch passes them as a scope and denies out-of-scope calls', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/services/claude/ClaudeSdkService.ts'), 'utf8');
    expect(src).toMatch(/\.\.\.\(agentOptions\?\.tools \? \{ tools: agentOptions\.tools \} : \{\}\)/);
    expect(src).toMatch(/\.\.\.\(agentOptions\?\.skills \? \{ skills: agentOptions\.skills \} : \{\}\)/);
    expect(src).not.toMatch(/\ballowedTools: agentOptions/);
    const pre = src.slice(src.indexOf('PreToolUse: ['), src.indexOf('PostToolUseFailure: [{'));
    expect(pre).toMatch(/agentOptions\.refusal\(input\.tool_name\)[\s\S]*?permissionDecision: 'deny'/);
  });
});

describe('where Hermes agents live', () => {
  it('in the workspace’s .forge/agents, or forge.agentsDir', () => {
    expect(resolveAgentsDir('', '/repo')).toBe(path.join('/repo', '.forge', 'agents'));
    expect(resolveAgentsDir('agents/team', '/repo')).toBe(path.join('/repo', 'agents/team'));
    expect(resolveAgentsDir('/shared/agents', undefined)).toBe('/shared/agents');
  });

  it('nowhere, with no folder open and a relative setting', () => {
    expect(resolveAgentsDir('', undefined)).toBeUndefined();
    expect(resolveAgentsDir('agents', undefined)).toBeUndefined();
  });
});

describe('writing a Hermes agent', () => {
  it('writes the answers, in Claude Code tool names, and the loader reads them back', async () => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: tmp } }];
    const service = new AgentService(log() as any);
    const file = await service.create({ name: 'reviewer', description: 'Reviews changes: bugs first.', tools: ['Read', 'Grep', 'Glob'] });
    expect(file).toBe(path.join(tmp, '.forge', 'agents', 'reviewer.md'));
    const [loaded] = loadAgents(path.dirname(file)).agents;
    expect(loaded.name).toBe('reviewer');
    expect(loaded.description).toBe('Reviews changes: bugs first.');
    expect(loaded.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(loaded.allMcp).toBe(true);
    expect(loaded.persona).toMatch(/^You are reviewer\./);
  });

  it('every tool: no tools key at all, only a commented example', () => {
    const md = hermesAgentMarkdown({ name: 'helper', description: 'Helps.', tools: [] });
    expect(md).toContain('# tools: [Read, Grep, Glob]');
    expect(md).not.toMatch(/^tools:/m);
  });

  it('never overwrites an agent that exists', async () => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: tmp } }];
    const service = new AgentService(log() as any);
    await service.create({ name: 'reviewer', description: 'Reviews changes.', tools: [] });
    await expect(service.create({ name: 'reviewer', description: 'Other.', tools: [] })).rejects.toThrow(/already exists/);
  });

  it('refuses with no folder open, rather than writing into the extension host’s directory', async () => {
    const service = new AgentService(log() as any);
    await expect(service.create({ name: 'reviewer', description: 'Reviews.', tools: [] })).rejects.toThrow(/Open a folder first/);
  });
});

describe('"Forge: Create Agent" asks which kind', () => {
  const hermesDeps = (overrides: Partial<HermesAgentDeps> = {}): HermesAgentDeps => ({
    agentsDir: () => path.join(tmp, '.forge', 'agents'),
    existingNames: () => ['taken'],
    create: vi.fn(async () => path.join(tmp, '.forge', 'agents', 'reviewer.md')),
    use: vi.fn(async () => {}),
    ...overrides,
  });

  it('offers both kinds, Claude Code first, each saying where it lives', () => {
    expect(AGENT_KINDS.map((k) => k.agentKind)).toEqual(['claude', 'hermes']);
    expect(AGENT_KINDS[0].label).toMatch(/Claude Code agent/);
    expect(AGENT_KINDS[0].description).toBe('.claude/agents');
    expect(AGENT_KINDS[1].label).toMatch(/Hermes agent/);
    expect(AGENT_KINDS[1].description).toBe('.forge/agents');
  });

  it('Hermes: name, what it is for, what it may use; then it can be used at once', async () => {
    const picks = vi.spyOn(vscode.window, 'showQuickPick')
      .mockResolvedValueOnce(AGENT_KINDS[1] as any)
      .mockResolvedValueOnce(AGENT_TOOLSETS[1] as any);
    const inputs = vi.spyOn(vscode.window, 'showInputBox')
      .mockResolvedValueOnce('reviewer')
      .mockResolvedValueOnce('Reviews changes for bugs.');
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(USE_HERMES_AGENT as any);
    const deps = hermesDeps();

    await createAgent(deps);

    expect((picks.mock.calls[0][0] as any[]).map((k) => k.agentKind)).toEqual(['claude', 'hermes']);
    expect((inputs.mock.calls[0][0] as any).title).toBe('Create Hermes agent (1/3): name');
    expect(deps.create).toHaveBeenCalledWith({ name: 'reviewer', description: 'Reviews changes for bugs.', tools: ['Read', 'Grep', 'Glob'] });
    expect(deps.use).toHaveBeenCalledWith('reviewer');
  });

  it('Hermes: a name already taken is refused as it is typed', async () => {
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValueOnce(AGENT_KINDS[1] as any);
    const inputs = vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(undefined);
    await createAgent(hermesDeps());
    const validate = (inputs.mock.calls[0][0] as any).validateInput;
    expect(validate('taken')).toMatch(/already exists/);
    expect(validate('Bad Name')).toMatch(/lowercase/);
    expect(validate('reviewer')).toBeUndefined();
  });

  it('Hermes, with no folder open: says why, asks nothing, writes nothing', async () => {
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValueOnce(AGENT_KINDS[1] as any);
    const inputs = vi.spyOn(vscode.window, 'showInputBox');
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as any);
    const deps = hermesDeps({ agentsDir: () => undefined });
    await createAgent(deps);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/open a folder first/));
    expect(inputs).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });

  it('Hermes: not used unless asked', async () => {
    vi.spyOn(vscode.window, 'showQuickPick')
      .mockResolvedValueOnce(AGENT_KINDS[1] as any)
      .mockResolvedValueOnce(AGENT_TOOLSETS[0] as any);
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValueOnce('reviewer').mockResolvedValueOnce('Reviews changes for bugs.');
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);
    const deps = hermesDeps();
    await createAgent(deps);
    expect(deps.create).toHaveBeenCalledWith({ name: 'reviewer', description: 'Reviews changes for bugs.', tools: [] });
    expect(deps.use).not.toHaveBeenCalled();
  });

  it('Claude Code: name, when to use it, what it may use, where -- then the CLI’s file', async () => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: tmp } }];
    vi.spyOn(vscode.window, 'showQuickPick')
      .mockResolvedValueOnce(AGENT_KINDS[0] as any)
      .mockResolvedValueOnce(AGENT_TOOLSETS[1] as any)
      .mockImplementationOnce(async (items: any) => items[0]); // This project
    const inputs = vi.spyOn(vscode.window, 'showInputBox')
      .mockResolvedValueOnce('code-reviewer')
      .mockResolvedValueOnce('Reviews a diff for bugs before it is committed.');
    const deps = hermesDeps();

    await createAgent(deps);

    expect((inputs.mock.calls[0][0] as any).title).toBe('Create Claude Code agent (1/4): name');
    const file = path.join(tmp, '.claude', 'agents', 'code-reviewer.md');
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^---\nname: code-reviewer\ndescription: Reviews a diff for bugs before it is committed\.\ntools: Read, Grep, Glob\n---/);
    expect(deps.create).not.toHaveBeenCalled();
  });

  it('nothing happens when the choice is dismissed', async () => {
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValueOnce(undefined);
    const inputs = vi.spyOn(vscode.window, 'showInputBox');
    const deps = hermesDeps();
    await createAgent(deps);
    expect(inputs).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });
});

describe('every way in reaches the choice', () => {
  it('Settings › Agents and the Guide run "Forge: Create Agent"', () => {
    expect(FORGE_ACTION_COMMANDS['create-agent']).toBe('forge.createAgent');
  });

  it('the palette shows "Create Agent" and hides the old straight-to-subagent command', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const palette = manifest.contributes.menus.commandPalette as Array<{ command: string; when?: string }>;
    expect(palette).toContainEqual({ command: 'forge.createSubagent', when: 'false' });
    expect(palette.find((e) => e.command === 'forge.createAgent')).toBeUndefined();
  });

  it('Select Agent’s "Create an agent…" lands on the same command', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/commands/forgeCommands.ts'), 'utf8');
    const start = src.indexOf("'forge.selectAgent': async");
    const select = src.slice(start, start + 2500);
    expect(select).toContain("executeCommand('forge.createAgent')");
  });
});

describe('Settings › Agents lists both kinds', () => {
  const context = () => ({
    logService: log(),
    workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: tmp } }) },
  }) as any;

  it('Claude Code agents and Hermes agents, each marked, the one in use marked active', async () => {
    fs.mkdirSync(path.join(tmp, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', 'agents', 'helper.md'), '---\nname: helper\ndescription: Helps with the work.\n---\n\nBody.\n');
    fs.mkdirSync(path.join(tmp, '.forge', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.forge', 'agents', 'reviewer.md'), hermesAgentMarkdown({ name: 'reviewer', description: 'Reviews changes.', tools: ['Read'] }));
    fs.writeFileSync(path.join(tmp, '.forge', 'agents', 'writer.md'), hermesAgentMarkdown({ name: 'writer', description: 'Writes docs.', tools: [] }));
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, fallback?: unknown) => (key === 'activeAgent' ? 'reviewer' : fallback),
      update: () => Promise.resolve(),
    } as any);

    const out = await handleListForgeItems({ type: 'list_forge_items', kind: 'agents' }, context());

    expect(out.items.map((i) => [i.name, i.agentType, i.scope, i.active ?? false])).toEqual([
      ['helper', 'claude-code', 'project', false],
      ['reviewer', 'hermes', 'project', true],
      ['writer', 'hermes', 'project', false],
    ]);
    expect(out.items[1].path).toBe(path.join(tmp, '.forge', 'agents', 'reviewer.md'));
  });

  it('skills and commands carry no agent type', async () => {
    const out = await handleListForgeItems({ type: 'list_forge_items', kind: 'skills' }, context());
    expect(out.items.every((i) => i.agentType === undefined)).toBe(true);
  });

  it('the list shows each agent’s kind', () => {
    const list = fs.readFileSync(path.join(ROOT, 'src/webview/src/components/settings/ForgeItemsList.vue'), 'utf8');
    expect(list).toMatch(/item\.agentType === 'hermes' \? 'Hermes' : 'Claude Code'/);
    expect(list).toMatch(/v-if="item\.active"[^>]*>In use</);
  });
});
