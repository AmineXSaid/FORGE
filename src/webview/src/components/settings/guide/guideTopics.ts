/**
 * The Guide: Forge's own help, local and offline. Five questions, each answered
 * with steps, a diagram and the real file formats.
 *
 * Everything here is read from the code it describes, not from memory:
 * - the skill and subagent files are exactly what `skillMarkdown()` and
 *   `agentMarkdown()` write (services/customizations/customizations.ts);
 * - the MCP entry is what `buildMcpServer()` builds, and the scopes are the
 *   "Add MCP server" picker's (commands/customizationCommands.ts);
 * - Claude Code agents are what `agentMarkdown()` writes, and Hermes agents the
 *   format `loadAgents()` reads; "Forge: Create Agent" asks which kind, and
 *   "Forge: Select Agent" chooses the Hermes agent a conversation runs as;
 * - the permission modes are ModeSelect's, and the @ menu's contents are the
 *   composer's (files, folders, `@browser:` tabs -- not agents).
 * `test/guideTopics.spec.ts` holds the examples to those functions, so the
 * guide cannot drift from what Forge actually writes. There are no web links:
 * the Guide is the documentation.
 */
import type { ForgeAction, ForgeSettingsTab } from '../../../../../shared/messages';

/** A run of text; `backticks` render as inline code. */
export type GuideText = string;

export type GuideBlock =
  | { kind: 'text'; text: GuideText }
  | { kind: 'steps'; items: GuideText[] }
  | { kind: 'diagram'; source: string; caption: GuideText }
  | { kind: 'code'; title: string; code: string }
  | { kind: 'table'; head: string[]; rows: GuideText[][] }
  | { kind: 'note'; text: GuideText }
  | { kind: 'actions'; items: GuideAction[] };

/** A button that does the thing the answer describes, through a typed request. */
export type GuideAction =
  | { label: string; icon: string; action: ForgeAction }
  | { label: string; icon: string; tab: ForgeSettingsTab };

export interface GuideTopic {
  id: string;
  /** The question, as the user would ask it. */
  question: string;
  /** Its name in the map at the top of the page. */
  short: string;
  /** One line under the question, so a closed answer still says what it holds. */
  summary: string;
  /** A codicon name, without the `codicon-` prefix. */
  icon: string;
  blocks: GuideBlock[];
}

// The worked examples. The spec compares each to the function that writes it.
export const SKILL_EXAMPLE = {
  name: 'release-notes',
  description: 'Drafts release notes from the merged pull requests since the last tag.',
};
export const AGENT_EXAMPLE = {
  name: 'code-reviewer',
  description: 'Reviews a diff for bugs and missing tests before it is committed.',
  tools: ['Read', 'Grep', 'Glob'],
};
export const MCP_EXAMPLE = {
  name: 'memory',
  command: 'npx -y @modelcontextprotocol/server-memory',
};

const SKILL_MD = `---
name: ${SKILL_EXAMPLE.name}
description: ${SKILL_EXAMPLE.description}
---

# Release Notes

## Instructions

Write the steps the model should follow when this skill applies.

## Examples

- Describe a request this skill should handle, and what a good result looks like.
`;

const AGENT_MD = `---
name: ${AGENT_EXAMPLE.name}
description: ${AGENT_EXAMPLE.description}
tools: ${AGENT_EXAMPLE.tools.join(', ')}
---

You are Code Reviewer, a focused subagent.

Describe its role, how it should work, and what it should hand back.
`;

const MCP_JSON = `{
  "mcpServers": {
    "memory": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
`;

const HERMES_AGENT_MD = `---
name: reviewer
description: Reviews changes before they are committed.
tools: [Read, Grep, Glob]           # optional; Hermes names like read_file work too
model: your-model-id                # optional: overrides the endpoint's model
memory: .agent/memory/reviewer.md   # optional: read every turn
skills: [release-notes]             # optional
mcp:                                # optional: omit for every server
  memory: true
---

You are a careful reviewer. Read the diff, find bugs and
missing tests, and answer with a short list.
`;

const SKILL_TREE = `~/.claude/skills/            All my projects
└── release-notes/
    ├── SKILL.md             name, description, instructions
    └── template.md          optional files SKILL.md refers to

<project>/.claude/skills/    This project (travels with the repo)`;

export const GUIDE_TOPICS: GuideTopic[] = [
  {
    id: 'conversation',
    short: 'Conversations',
    question: 'How does a Forge conversation work?',
    summary: 'What happens between pressing Enter and seeing the answer.',
    icon: 'comment-discussion',
    blocks: [
      {
        kind: 'text',
        text: 'Forge is the chat you see; the real `claude` CLI, bundled with Forge, does the work. The extension drives the CLI through the Claude Agent SDK: your message goes in, the CLI talks to the model and runs tools, and everything it does streams back into the transcript as it happens.',
      },
      {
        kind: 'diagram',
        caption: 'Who talks to whom. Everything in the box runs on your machine; only the model is remote.',
        source: `flowchart TB
  you(["You"]) --> forge
  subgraph machine["Your machine"]
    forge["Forge: chat + extension<br/>Claude Agent SDK"] --> cli["claude CLI (bundled)"]
    cli --> tools["Tools<br/>files · shell · MCP · agents"]
  end
  cli --> model[("Model<br/>via your endpoint")]`,
      },
      {
        kind: 'diagram',
        caption: 'One turn. The loop repeats until the model has no more tool calls to make.',
        source: `%%{init: {"sequence": {"actorMargin": 16, "width": 104, "height": 44, "messageMargin": 22, "boxMargin": 6, "noteMargin": 6, "mirrorActors": false}}}%%
sequenceDiagram
  participant You
  participant Forge
  participant CLI as claude CLI
  participant Model
  You->>Forge: Message + @context
  Forge->>CLI: Prompt
  loop until done
    CLI->>Model: Conversation
    Model-->>CLI: Text or tool call
    opt needs approval
      CLI->>Forge: Permission?
      Forge->>You: Prompt
      You-->>Forge: Allow / deny
    end
    CLI->>CLI: Run tool
  end
  CLI-->>Forge: Streamed reply
  Forge-->>You: Live transcript`,
      },
      {
        kind: 'steps',
        items: [
          'Type in the composer and press Enter. Add context with `@` (files, folders, and `@browser:` tabs when available) or the `+` button.',
          'The reply streams in. Each tool the model uses (reading a file, running a command, calling an MCP tool) appears as its own row.',
          'When a tool needs your approval, a permission prompt appears above the composer. What asks first depends on the mode below.',
          'Everything is saved on your machine under `~/.claude/projects/`. Reopen it with the history button, or type `/` and pick Resume conversation.',
          'Went the wrong way? `/` then Rewind restores code and conversation to an earlier point. Or hover one of your messages, open Message actions and choose Fork conversation from here.',
        ],
      },
      {
        kind: 'table',
        head: ['Mode', 'What Forge does'],
        rows: [
          ['Expert', 'Teaches step by step, from the basics up, and asks before each edit.'],
          ['Manual', 'Asks for approval before making each edit.'],
          ['Edit automatically', 'Accepts file edits without asking for each one.'],
          ['Plan', 'Explores the code and presents a plan before editing anything.'],
          ['Bypass permissions', 'Does not ask before running potentially dangerous commands. Use with care.'],
        ],
      },
      { kind: 'note', text: 'Switch modes from the mode button in the composer footer. The model and effort are under `/` in the Model section.' },
    ],
  },
  {
    id: 'skill',
    short: 'Skills',
    question: 'How do I create a skill?',
    summary: 'Teach Forge a repeatable task with one SKILL.md file.',
    icon: 'wand',
    blocks: [
      {
        kind: 'text',
        text: 'A skill is a folder with a `SKILL.md`: a name, one sentence about when to use it, and the instructions. The model reads only the descriptions up front and loads a skill’s full instructions when your request matches, so skills cost almost nothing until they are needed.',
      },
      {
        kind: 'diagram',
        caption: 'How a skill gets used.',
        source: `flowchart TB
  ask["Your request"] --> match{"Matches a skill's description?"}
  slash["You type<br/>/release-notes"] --> load
  match -- yes --> load["CLI loads SKILL.md"]
  match -- no --> plain["Ordinary answer"]
  load --> follow["Model follows its instructions"]`,
      },
      {
        kind: 'steps',
        items: [
          'Click Create skill below (or Settings › Skills › Create skill).',
          'Name it: lowercase letters, digits and hyphens, up to 64 characters, e.g. `release-notes`.',
          'Write one sentence saying when to use it. This is what the model matches against, so name the task plainly.',
          'Pick where it lives: This project (in the repo, for everyone) or All my projects (only you, every workspace).',
          'Forge writes the `SKILL.md` and opens it. Replace the Instructions and Examples with your own, then start a new conversation.',
        ],
      },
      { kind: 'code', title: 'Where skills live', code: SKILL_TREE },
      { kind: 'code', title: `${SKILL_EXAMPLE.name}/SKILL.md, as Forge writes it`, code: SKILL_MD },
      { kind: 'note', text: 'Already have a skill folder? Add from folder copies it in; it only needs a `SKILL.md` at its top.' },
      {
        kind: 'actions',
        items: [
          { label: 'Create skill', icon: 'add', action: 'create-skill' },
          { label: 'Add from folder…', icon: 'folder-opened', action: 'add-skill' },
          { label: 'Open Skills', icon: 'wand', tab: 'skills' },
        ],
      },
    ],
  },
  {
    id: 'mcp',
    short: 'MCP servers',
    question: 'How do I add an MCP server?',
    summary: 'Give Forge new tools: a database, a tracker, a memory, your own API.',
    icon: 'server-process',
    blocks: [
      {
        kind: 'text',
        text: 'An MCP server is a program that offers tools. The CLI connects to it when a conversation starts, and its tools become available to the model, named `mcp__<server>__<tool>`.',
      },
      {
        kind: 'diagram',
        caption: 'Two ways a server runs. Either way, its tools join the conversation.',
        source: `flowchart TB
  local["Local command<br/>npx … server-memory"] <-- "stdio" --> cli["claude CLI"]
  remote["Remote server<br/>a URL"] <-- "HTTP / SSE" --> cli
  cli --> tools["Tools: mcp__memory__…, mcp__docs__…"]
  tools --> model["The model can call them"]`,
      },
      {
        kind: 'steps',
        items: [
          'Click Add MCP server below (or Settings › MCP Servers).',
          'How does it run? Local command (a program Forge starts), Remote server (HTTP), or the older SSE.',
          'Name it. The name is how the server and its tools are called in conversations.',
          'Give the command (e.g. `npx -y @modelcontextprotocol/server-memory`) or the server URL, then any environment variable or header it needs.',
          'Choose who gets it (table below), then start a new conversation to load its tools.',
        ],
      },
      {
        kind: 'table',
        head: ['Scope', 'Stored in', 'Who gets it'],
        rows: [
          ['This project, shared', '`.mcp.json` in the project', 'Everyone with the repo; teammates are asked to approve it.'],
          ['This project, just me', 'The CLI’s own config', 'Only you, only in this workspace.'],
          ['All my projects', 'The CLI’s own config', 'Only you, in every workspace.'],
        ],
      },
      { kind: 'code', title: '.mcp.json after adding it', code: MCP_JSON },
      { kind: 'note', text: 'Servers from a project’s `.mcp.json` need approval before they run. Approve or reject them under Settings › MCP Servers › Project Server Policy.' },
      {
        kind: 'actions',
        items: [
          { label: 'Add MCP server', icon: 'add', action: 'add-mcp-server' },
          { label: 'Open MCP Servers', icon: 'server-process', tab: 'mcp-servers' },
        ],
      },
    ],
  },
  {
    id: 'agent',
    short: 'Agents',
    question: 'How do I create an agent?',
    summary: 'Claude Code agents take on a task for you; Hermes agents change who Forge is.',
    icon: 'hubot',
    blocks: [
      {
        kind: 'text',
        text: 'Forge has two kinds, and Create agent asks which one you want. A Claude Code agent is a specialist the conversation hands work to: it runs in its own context with its own tools and reports back. A Hermes agent is who Forge runs as for a whole conversation: its persona, model, tools, skills and MCP servers.',
      },
      {
        kind: 'diagram',
        caption: 'One button, two kinds: a Claude Code agent works on the side and returns its result; a Hermes agent is who the whole conversation is.',
        source: `flowchart LR
  create["Create agent"] --> kind{"Which kind?"}
  kind -- "Claude Code agent" --> sub["Works on a task<br/>own context · own tools<br/>returns a summary"]
  kind -- "Hermes agent" --> persona["Runs the conversation<br/>persona · model · memory<br/>tools enforced throughout"]`,
      },
      {
        kind: 'table',
        head: ['', 'Claude Code agent', 'Hermes agent'],
        rows: [
          ['What it is', 'A helper the model delegates to', 'The persona the whole conversation runs as'],
          ['File', '`.claude/agents/<name>.md` (or `~/.claude/agents/`)', '`.forge/agents/<name>.md`'],
          ['Create', 'Create agent › Claude Code agent', 'Create agent › Hermes agent'],
          ['Use', 'Ask for it by name, or let the model hand off', 'Use it now, or Command Palette › Forge: Select Agent'],
          ['Takes effect', 'Right away, per task', 'From the next conversation'],
        ],
      },
      {
        kind: 'steps',
        items: [
          'Click Create agent below (or Settings › Agents, or Command Palette › Forge: Create Agent) and pick the kind.',
          'Give it a name, e.g. `code-reviewer`, and one sentence saying what it is for. A Claude Code agent’s sentence is how the conversation decides to hand work over; a Hermes agent’s is shown when you pick it.',
          'Choose what it may use: every tool, read-only (Read, Grep, Glob), read and edit, or read, edit and run (adds Bash).',
          'A Claude Code agent asks This project or All my projects; a Hermes agent lives in the workspace. Forge writes the file and opens it: the body is its instructions, or its persona.',
        ],
      },
      { kind: 'code', title: `${AGENT_EXAMPLE.name}.md (Claude Code agent), as Forge writes it`, code: AGENT_MD },
      { kind: 'code', title: 'reviewer.md (Hermes agent), every key optional but name', code: HERMES_AGENT_MD },
      { kind: 'note', text: 'A Hermes agent’s tools are enforced for the whole conversation, so choosing another agent starts a new one. Leaving a key out means unrestricted, not none.' },
      {
        kind: 'actions',
        items: [
          { label: 'Create agent', icon: 'add', action: 'create-agent' },
          { label: 'Open Agents', icon: 'hubot', tab: 'agents' },
        ],
      },
    ],
  },
  {
    id: 'use',
    short: 'Using them in chat',
    question: 'How do I use them in a chat?',
    summary: 'Skills, MCP tools, agents and slash commands, from the composer.',
    icon: 'rocket',
    blocks: [
      {
        kind: 'text',
        text: 'Mostly, just ask. The model sees every skill’s and Claude Code agent’s description and every MCP tool, and reaches for the right one when your request matches. You can also call them directly.',
      },
      {
        kind: 'diagram',
        caption: 'From your message to the right capability.',
        source: `flowchart TB
  msg["Your message"] --> skill["Skill<br/>a known procedure"]
  msg --> mcp["MCP tool<br/>an outside system"]
  msg --> agent["Claude Code agent<br/>a side task"]
  msg --> cmd["Slash command<br/>you typed /name"]`,
      },
      {
        kind: 'table',
        head: ['To use', 'How', 'What you see'],
        rows: [
          ['A skill', 'Ask for the task it describes. Or type `/` and pick it under Slash Commands.', 'A Skill row, then the work.'],
          ['An MCP tool', 'Ask for what the tool does: “remember that the API key lives in .env”.', 'A tool row; in Manual mode a prompt naming `mcp__server__tool`.'],
          ['A Claude Code agent', 'Name it: “Use the code-reviewer agent on my changes”.', 'An Agent row with its result.'],
          ['A Hermes agent', 'Forge: Select Agent, then start a new conversation.', 'The whole conversation runs as it.'],
          ['A slash command', 'Type `/`, pick it, add arguments after it.', 'Its prompt runs as your message.'],
          ['Context', '`@` for files and folders (and `@browser:` tabs when available), or the `+` button.', 'A mention in your message.'],
        ],
      },
      {
        kind: 'text',
        text: 'Try asking:',
      },
      {
        kind: 'steps',
        items: [
          '“Draft the release notes for this version” — matches the `release-notes` skill.',
          '“Use the code-reviewer agent to review what I changed today” — hands off to the subagent.',
          '“Remember that deploys go out on Fridays” — calls the memory server’s tool.',
        ],
      },
      { kind: 'note', text: 'Not sure what is loaded? Type `/` to see the Slash Commands the CLI reports, and open Settings › Skills, Agents or MCP Servers to see what is installed.' },
    ],
  },
];
