/**
 * The tool call renderers, ported from the official Claude Code webview.
 *
 * The official draws every tool call the same way (`jn`): a summary line built by
 * the tool's `header`, then whatever its `body` returns. Each tool is a class
 * over a shared base (`R2`) and `BY` picks one by name. This file keeps that
 * shape class for class, so a renderer here can be checked against its source:
 * the bundle name is on every class.
 *
 * Copy is the official's, with "Claude" read as "Forge" where it names the
 * assistant (the plan header); product names such as Claude in Chrome stay.
 */
import { Fragment, h, type VNodeChild } from 'vue';
import type { ToolResultBlock } from '../../../models/ContentBlock';
import DiffEditor from './DiffEditor.vue';
import ThumbnailAttachment from './ThumbnailAttachment.vue';
import TerminalBlock from './TerminalBlock.vue';
import type { ShellKind } from './shellHighlight';
import {
  TOOL,
  OPEN_FULL_TEXT,
  actionLink,
  describedProps,
  isLongText,
  rejectionReason,
  safeUrl,
  secondaryLine,
  todoList,
  withoutAnsi,
} from './toolParts';

export interface FileLocation {
  startLine?: number;
  endLine?: number;
  searchText?: string;
}

export interface ToolRenderContext {
  fileOpener: {
    open: (filePath: string, location?: FileLocation) => void;
    openContent: (content: string, fileName: string, editable: boolean) => unknown;
  };
  /** The official `renderContent`: a content block drawn by the content-block renderer. */
  renderContent: (block: any) => VNodeChild;
}

/** One entry of a REPL call's progress (`progress` on the official content wrapper). */
export interface ToolProgress {
  innerToolUseId: string;
  toolName: string;
  toolInput: any;
  phase: 'start' | 'executing' | 'complete' | 'error';
}

type Input = Record<string, any>;
type Result = ToolResultBlock | undefined;

const nameText = (children: VNodeChild) => h('span', { class: TOOL.toolNameText }, children as any);
const secondary = (children: VNodeChild) => h('span', { class: TOOL.toolNameTextSecondary }, children as any);
const basename = (path: unknown) => (typeof path === 'string' ? path.split('/').pop() : undefined);

/** `R2`: the base every tool renderer extends. */
export abstract class ToolRenderer {
  abstract readonly name: string;
  hidden = false;

  header(_ctx: ToolRenderContext, _input: Input): VNodeChild {
    return nameText(this.name);
  }

  body(ctx: ToolRenderContext, input: Input, result: Result, _progress?: ToolProgress[]): VNodeChild {
    const inputRow = this.renderInput(ctx, input);
    const outputRow = this.renderOutput(ctx, result, input);
    const description = this.toolDescription(input);
    return [
      description && secondaryLine(description),
      (inputRow || outputRow) && h('div', { class: TOOL.toolBody }, [h('div', { class: TOOL.toolBodyGrid }, [inputRow, outputRow])]),
    ];
  }

  renderInput(ctx: ToolRenderContext, input: Input): VNodeChild {
    if (input && Object.keys(input).length > 0) {
      const text = JSON.stringify(input, null, 2);
      const open = isLongText(text) ? () => void ctx.fileOpener.openContent(text, `${this.name} tool input`, false) : undefined;
      return h('div', { class: TOOL.toolBodyRow }, [
        h('div', { class: TOOL.toolBodyRowLabel }, 'IN'),
        h('div', { class: TOOL.toolBodyRowContent, ...describedProps(open, OPEN_FULL_TEXT) }, [h('pre', text)]),
      ]);
    }
    return null;
  }

  renderOutput(ctx: ToolRenderContext, result: Result, _input?: Input): VNodeChild {
    if (result && Object.keys(result).length > 0) {
      const text = this.toOutputContent(result);
      const open = text && isLongText(text) ? () => void ctx.fileOpener.openContent(text, `${this.name} tool output`, false) : undefined;
      return h('div', { class: TOOL.toolBodyRow }, [
        h('div', { class: TOOL.toolBodyRowLabel }, 'OUT'),
        h('div', { class: TOOL.toolBodyRowContent, ...describedProps(open, OPEN_FULL_TEXT) }, [ctx.renderContent(result)]),
      ]);
    }
    return null;
  }

  toOutputContent(block: any): string {
    switch (block?.type) {
      case 'text':
        return block.text;
      case 'tool_result':
        if (typeof block.content === 'string') return block.content;
        if (Array.isArray(block.content)) {
          return block.content.map((c: any) => this.toOutputContent(c)).filter((c: string) => !!c).join('\n');
        }
        return '';
      default:
        return '';
    }
  }

  toolDescription(_input: Input): string | undefined {
    return undefined;
  }
}

/** `j61` */
class AgentOutputToolRenderer extends ToolRenderer {
  readonly name = 'AgentOutputTool';
  body(): VNodeChild {
    return null;
  }
}

// `Fj0` / `uR1` / `gR1` / `BT`: the result text that carries an artifact link.
const ARTIFACT_OPENED = 'Opened the Artifact at http';
const ARTIFACT_PREFIXES = ['Published ', 'Created a new Artifact at http', ARTIFACT_OPENED];

function artifactUrl(result: Result): string | undefined {
  const content = result?.content;
  if (!result || result.is_error || typeof content !== 'string') return undefined;
  if (!ARTIFACT_PREFIXES.some((p) => content.startsWith(p))) return undefined;
  const matches = [...content.matchAll(/\bat (https?:\/\/\S+)/g)];
  if (matches.length !== 1) return undefined;
  return safeUrl(matches[0]?.[1]);
}

/** `M61` */
class ArtifactRenderer extends ToolRenderer {
  readonly name = 'Artifact';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    return h('div', [nameText('Artifact'), secondary(input.file_path)]);
  }
  renderInput(): VNodeChild {
    return null;
  }
  renderOutput(ctx: ToolRenderContext, result: Result): VNodeChild {
    const url = artifactUrl(result);
    if (!url) return super.renderOutput(ctx, result);
    const verb =
      !!result && !result.is_error && typeof result.content === 'string' && result.content.startsWith(ARTIFACT_OPENED)
        ? 'Opened'
        : typeof result?.content === 'string' && result.content.startsWith('Created ')
          ? 'Created'
          : 'Published';
    return h('div', { class: TOOL.toolBodyPlainText }, [
      verb,
      ' —',
      ' ',
      secondary([h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open artifact ↗')]),
    ]);
  }
}

/**
 * `cT` (module F2hEIg), with Forge's terminal as its body.
 *
 * The header and the rejection line are the official's. Where the official
 * prints an IN / OUT grid of plain text, Forge draws a terminal: a prompt and a
 * syntax-coloured command, then the output with its ANSI colours, newest lines
 * in view (TerminalBlock.vue).
 */
class BashRenderer extends ToolRenderer {
  readonly name: string = 'Bash';
  readonly shell: ShellKind = 'bash';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    return [
      h('span', { class: TOOL.toolNameText }, [this.name, ' ']),
      input.description && h('span', { class: TOOL.toolNameTextSecondaryPlaintext }, input.description),
    ];
  }
  body(ctx: ToolRenderContext, input: Input, result: Result): VNodeChild {
    const reason = rejectionReason(result);
    return [
      reason && secondaryLine(reason),
      h(TerminalBlock, {
        shell: this.shell,
        command: input.command ?? '',
        result,
        context: ctx,
        toolName: this.name,
        showOutput: !reason,
      }),
    ];
  }
}

/** `LB1` */
class PowerShellRenderer extends BashRenderer {
  readonly name = 'PowerShell';
  readonly shell: ShellKind = 'powershell';
}

/** `O61` */
class TaskOutputRenderer extends ToolRenderer {
  readonly name = 'TaskOutput';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    return h('div', [nameText(this.name), ' ', input.task_id && secondary(['task: "', input.task_id, '"'])]);
  }
  renderInput(): VNodeChild {
    return null;
  }
  renderOutput(ctx: ToolRenderContext, result: Result, input?: Input): VNodeChild {
    return super.renderOutput(ctx, withoutAnsi(result), input);
  }
}

/** `kB1` (the `Task` tool is shown under its new name, Agent) */
class AgentRenderer extends ToolRenderer {
  readonly name = 'Agent';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    return h('div', [nameText('Agent:'), secondary(input.description)]);
  }
  renderInput(ctx: ToolRenderContext, input: Input): VNodeChild {
    if (!input.prompt) return null;
    const open = () => void ctx.fileOpener.openContent(input.prompt, `${this.name} tool input`, false);
    return h('div', { class: TOOL.toolBodyRow }, [
      h('div', { class: TOOL.toolBodyRowLabel }, 'IN'),
      h('div', { class: TOOL.toolBodyRowContent, ...describedProps(open, OPEN_FULL_TEXT) }, [h('pre', input.prompt)]),
    ]);
  }
  renderOutput(): VNodeChild {
    return null;
  }
}

/** `hB1` */
class TodoWriteRenderer extends ToolRenderer {
  readonly name = 'TodoWrite';
  header(): VNodeChild {
    return h('div', [nameText('Update Todos')]);
  }
  body(ctx: ToolRenderContext, input: Input, result: Result): VNodeChild {
    if (input && input.todos && Array.isArray(input.todos)) return todoList(input.todos);
    return super.body(ctx, input, result);
  }
}

/** `SP`: tools about one file, whose header links to it. */
abstract class FileToolRenderer extends ToolRenderer {
  header(ctx: ToolRenderContext, input: Input): VNodeChild {
    return this.fileToolHeader(ctx, this.name, input.file_path);
  }
  fileToolHeader(ctx: ToolRenderContext, name: string, filePath: string | undefined, location?: FileLocation): VNodeChild {
    const file = basename(filePath);
    if (file) {
      return [nameText(name), ' ', secondary([actionLink(() => ctx.fileOpener.open(filePath as string, location), file)])];
    }
    return [nameText(name), ' file'];
  }
}

/** `jB1` */
class ReadRenderer extends FileToolRenderer {
  readonly name = 'Read';
  header(ctx: ToolRenderContext, input: Input): VNodeChild {
    const file = basename(input.file_path);
    if (file) {
      const startLine = input.offset ? input.offset + 1 : 1;
      const endLine = input.limit ? startLine + input.limit - 1 : undefined;
      let range = '';
      if (input.offset !== undefined && input.limit !== undefined) range = ` (lines ${input.offset + 1}-${input.offset + input.limit})`;
      else if (input.offset !== undefined && input.limit === undefined) range = ` (from line ${input.offset + 1})`;
      return [
        nameText('Read '),
        secondary([actionLink(() => ctx.fileOpener.open(input.file_path, { startLine, endLine }), file)]),
        range && h('span', range),
      ];
    }
    return nameText('Read');
  }
  body(): VNodeChild {
    return null;
  }
}

/** `$n0` */
function writeSummary(input: Input, failed: boolean | undefined): string {
  if (failed) return 'Write failed';
  if (typeof input.content !== 'string') return 'Write succeeded';
  const lines = input.content.split('\n').length;
  return `${lines} line${lines !== 1 ? 's' : ''}`;
}

/** `Yy` (module fKyNXw) */
class WriteRenderer extends FileToolRenderer {
  readonly name = 'Write';
  body(ctx: ToolRenderContext, input: Input, result: Result): VNodeChild {
    const failed = result && result.is_error;
    const text = typeof input.content === 'string' ? input.content : JSON.stringify(input.content, null, 2);
    const reason = rejectionReason(result);
    const file = (input.file_path || '').split('/').pop() || 'file';
    const open = text && isLongText(text) ? () => void ctx.fileOpener.openContent(text, `Write ${file}`, false) : undefined;
    return [
      secondaryLine(writeSummary(input, failed)),
      reason && secondaryLine(reason),
      h('div', { class: `${TOOL.toolBody} fg-writebody__toolBodyWrapper` }, [
        h('div', { class: TOOL.toolBodyRowContent, ...describedProps(open, OPEN_FULL_TEXT) }, [h('pre', text)]),
      ]),
    ];
  }
}

/** `ts0` */
function editSummary(original: string, modified: string): string {
  const before = original.split('\n').length;
  const after = modified.split('\n').length;
  const added = Math.max(0, after - before);
  const removed = Math.max(0, before - after);
  if (added > 0 && removed > 0) return `Added ${added} line${added !== 1 ? 's' : ''}, removed ${removed} line${removed !== 1 ? 's' : ''}`;
  if (added > 0) return `Added ${added} line${added !== 1 ? 's' : ''}`;
  if (removed > 0) return `Removed ${removed} line${removed !== 1 ? 's' : ''}`;
  return 'Modified';
}

/** `Zy` (module R6H5ZA) */
class EditRenderer extends FileToolRenderer {
  readonly name = 'Edit';
  header(ctx: ToolRenderContext, input: Input): VNodeChild {
    return this.fileToolHeader(ctx, this.name, input.file_path, { searchText: input.new_string });
  }
  body(_ctx: ToolRenderContext, input: Input, result: Result): VNodeChild {
    const summary = result && result.is_error ? 'Edit failed' : editSummary(input.old_string || '', input.new_string || '');
    const reason = rejectionReason(result);
    return [
      secondaryLine(summary),
      reason && secondaryLine(reason),
      h('div', { class: `${TOOL.toolBody} fg-editbody__toolBodyWrapper` }, [
        h(DiffEditor, { original: input.old_string || '', modified: input.new_string || '', filePath: input.file_path || '' }),
      ]),
    ];
  }
}

/** `MB1` */
class GlobRenderer extends ToolRenderer {
  readonly name = 'Glob';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    return h('div', [nameText('Glob'), secondary(['pattern: "', input.pattern, '"'])]);
  }
  body(ctx: ToolRenderContext, _input: Input, result: Result): VNodeChild {
    if (!result) return null;
    const output = this.toOutputContent(result);
    const trimmed = output?.trim();
    const count = (trimmed && trimmed !== 'No files found' ? trimmed.split('\n').filter((l) => l.length > 0) : []).length;
    return secondaryLine(
      count === 0 ? 'No files found' : count === 1 ? 'Found 1 file' : `Found ${count} files`,
      output ? () => void ctx.fileOpener.openContent(output, 'Glob output', false) : undefined
    );
  }
}

/** `wB1` */
class GrepRenderer extends ToolRenderer {
  readonly name = 'Grep';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    const scope: string[] = [];
    if (input.path) scope.push(`in ${input.path}`);
    if (input.glob) scope.push(`glob: ${input.glob}`);
    if (input.type) scope.push(`type: ${input.type}`);
    return h('div', [nameText('Grep'), ' ', secondary(['"', input.pattern, '"', scope.length > 0 && ` (${scope.join(', ')})`])]);
  }
  body(ctx: ToolRenderContext, _input: Input, result: Result): VNodeChild {
    if (!result) return null;
    const output = this.toOutputContent(result);
    const count = (output ? output.trim().split('\n').filter((l) => l.length > 0) : []).length;
    return secondaryLine(
      count === 0 ? 'No matches found' : count === 1 ? '1 line of output' : `${count} lines of output`,
      output ? () => void ctx.fileOpener.openContent(output, 'Grep output', false) : undefined
    );
  }
}

/** `bB1` */
class SearchRenderer extends ToolRenderer {
  readonly name = 'Search';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    return h('div', [nameText('Search'), ' ', secondary(['pattern: "', input.pattern, '"'])]);
  }
}

/** `CB1` */
class WebFetchRenderer extends ToolRenderer {
  readonly name = 'WebFetch';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    const url = safeUrl(input.url);
    return h('div', [
      nameText('Web Fetch'),
      secondary(url ? [h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, input.url)] : input.url),
    ]);
  }
  renderInput(): VNodeChild {
    return null;
  }
  renderOutput(ctx: ToolRenderContext, result: Result, input?: Input): VNodeChild {
    if (!result || result.is_error || !input?.url) return super.renderOutput(ctx, result);
    return h('div', { class: TOOL.toolBodyPlainText }, ['Fetched from ', input.url]);
  }
}

/** `dT` */
class ExitPlanModeRenderer extends ToolRenderer {
  readonly name = 'ExitPlanMode';
  header(ctx: ToolRenderContext, input: Input): VNodeChild {
    if (input?.planFilePath) {
      return [
        nameText('Forge’s Plan '),
        secondary([actionLink(() => ctx.fileOpener.open(input.planFilePath), basename(input.planFilePath))]),
      ];
    }
    return nameText(input?.plan ? 'Forge’s Plan' : 'Plan Mode');
  }
  body(_ctx: ToolRenderContext, _input: Input, result: Result): VNodeChild {
    const approved = result && !result.is_error;
    const text = result ? (approved ? 'User approved the plan' : 'Stayed in plan mode') : undefined;
    return text ? secondaryLine(text) : null;
  }
}

/** `E61` */
class ReadCoalescedRenderer extends ToolRenderer {
  readonly name = 'ReadCoalesced';
  header(ctx: ToolRenderContext, input: Input): VNodeChild {
    return [
      nameText('Read '),
      ...((input.fileReads || []) as Input[]).map((read, i) => {
        const startLine = read.offset ? read.offset + 1 : 1;
        let range = '';
        if (read.offset !== undefined && read.limit !== undefined) range = ` (lines ${read.offset + 1}-${read.offset + read.limit})`;
        else if (read.offset !== undefined && read.limit === undefined) range = ` (from line ${read.offset + 1})`;
        const file = read.file_path.split('/').pop() || read.file_path;
        return h(Fragment, { key: i }, [
          i > 0 && h('span', ', '),
          secondary([actionLink(() => ctx.fileOpener.open(read.file_path, { startLine }), file)]),
          range && h('span', [' ', range]),
        ]);
      }),
    ];
  }
  body(): VNodeChild {
    return null;
  }
}

/** `Pn` */
class NotebookEditRenderer extends ToolRenderer {
  readonly name = 'NotebookEdit';
  header(ctx: ToolRenderContext, input: Input): VNodeChild {
    const file = basename(input.notebook_path);
    if (file) {
      return [
        nameText('Edit Notebook Cell '),
        secondary([actionLink(() => ctx.fileOpener.open(input.notebook_path), [file, input.cell_id && h('span', ':' + input.cell_id)])]),
      ];
    }
    return nameText('Edit Notebook Cell');
  }
  body(_ctx: ToolRenderContext, input: Input, result: Result): VNodeChild {
    const status = result ? (result.is_error ? 'Failed' : 'Success') : 'Pending';
    return [
      secondaryLine(status),
      h('div', { class: TOOL.toolBody }, [
        h('div', { class: `${TOOL.toolBodyRowContent} ${TOOL.toolBodyRowContent_disableClipping}` }, [
          h('pre', input?.new_source ?? '[No content]'),
        ]),
      ]),
    ];
  }
}

/** `IB1` */
class SkillRenderer extends ToolRenderer {
  readonly name = 'Skill';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    const skill = input.skill?.replace(/^\//, '') || '';
    return [nameText(skill), secondary(' skill')];
  }
  body(): VNodeChild {
    return null;
  }
}

/** `N61` */
class AskUserQuestionRenderer extends ToolRenderer {
  readonly name = 'AskUserQuestion';
  renderInput(): VNodeChild {
    return null;
  }
}

/** `vB1` */
class WebSearchRenderer extends ToolRenderer {
  readonly name = 'WebSearch';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    return h('div', [nameText('Web Search'), secondary(input.query)]);
  }
  renderInput(): VNodeChild {
    return null;
  }
  toolDescription(input: Input): string | undefined {
    const parts: string[] = [];
    if (input.allowed_domains?.length) parts.push(`Allowed: ${input.allowed_domains.join(', ')}`);
    if (input.blocked_domains?.length) parts.push(`Blocked: ${input.blocked_domains.join(', ')}`);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }
}

/** `Hv` */
const isToolReference = (block: any) => typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_reference';

/** `yB1`: never drawn; kept so a message of only tool searches is hidden too. */
class ToolSearchRenderer extends ToolRenderer {
  readonly name = 'ToolSearch';
  hidden = true;
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    return h('div', [nameText('Search tools'), secondary(['"', input.query ?? '…', '"'])]);
  }
  body(_ctx: ToolRenderContext, _input: Input, result: Result): VNodeChild {
    if (!result) return null;
    const content = result.content;
    let count = 0;
    if (typeof content === 'string') {
      if (content.includes('No matching')) return secondaryLine('No tools found');
    } else if (Array.isArray(content)) {
      count = content.filter(isToolReference).length;
    }
    if (count === 0) return secondaryLine('No tools found');
    return secondaryLine(count === 1 ? 'Found 1 tool' : `Found ${count} tools`);
  }
}

/** `Gn0` */
function firstLine(code: string | undefined): string {
  if (!code) return '';
  const line = code.split('\n', 1)[0];
  return line.length > 80 ? line.slice(0, 80) + '…' : line;
}

/** `TB1` (module 3H9AYw) */
class ReplRenderer extends ToolRenderer {
  readonly name = 'REPL';
  header(ctx: ToolRenderContext, input: Input): VNodeChild {
    const code = input.code;
    const label = input.description || firstLine(code);
    if (!code || !label) return nameText('REPL');
    return [nameText('REPL '), secondary([actionLink(() => void ctx.fileOpener.openContent(code, 'REPL script', false), label)])];
  }
  body(ctx: ToolRenderContext, _input: Input, _result: Result, progress?: ToolProgress[]): VNodeChild {
    if (!progress || progress.length === 0) return null;
    return h('div', { class: TOOL.toolBody }, [
      h('div', { class: TOOL.toolBodyGrid }, [
        h('div', { class: TOOL.toolBodyRow }, [
          h(
            'div',
            { class: 'fg-innercall__innerCallList' },
            progress.map((call) => {
              const renderer = getToolRenderer(call.toolName);
              const state = call.phase === 'error' ? 'fg-innercall__innerCallError' : call.phase === 'complete' ? 'fg-innercall__innerCallComplete' : '';
              return h('div', { key: call.innerToolUseId, class: `fg-innercall__innerCall ${state}` }, [
                h('span', { class: 'fg-innercall__innerCallHeader' }, [renderer.header(ctx, call.toolInput)] as any),
                (call.phase === 'start' || call.phase === 'executing') && h('span', { class: 'fg-innercall__innerCallSpinner' }, '…'),
              ]);
            })
          ),
        ]),
      ]),
    ]);
  }
}

/** `EB1` */
class SandboxNetworkAccessRenderer extends ToolRenderer {
  readonly name = 'SandboxNetworkAccess';
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    return h('div', [nameText('Network Access'), input.host && secondary(input.host)]);
  }
  renderInput(): VNodeChild {
    return null;
  }
}

// ---- MCP --------------------------------------------------------------------

/** `Jn0` */
const MCP_WORDS: Record<string, string> = { Github: 'GitHub', Pubmed: 'PubMed', Ai: 'AI' };

/** `Xy` */
export function isMcpTool(name: string): boolean {
  return name.startsWith('mcp__');
}

/** `_B1` */
function humanize(server: string): string {
  return server
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .map((w) => MCP_WORDS[w] || w)
    .join(' ');
}

const MCP_SUMMARY_KEYS = ['query', 'message', 'channel', 'repo', 'url', 'path', 'title', 'search', 'text'];

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** `Xn0`: the one input worth showing beside an MCP tool's name. */
function mcpSummary(input: Input): string | null {
  for (const key of MCP_SUMMARY_KEYS) {
    const value = input?.[key];
    if (typeof value !== 'string' || !value) continue;
    if (key === 'channel') return `#${value}`;
    if (key === 'url') {
      try {
        return new URL(value).hostname;
      } catch {
        return clip(value, 30);
      }
    }
    return clip(value, 40);
  }
  return null;
}

/** `RB1` */
class McpToolRenderer extends ToolRenderer {
  readonly name: string;
  private readonly toolName: string;
  private readonly humanizedServerName: string;
  constructor(name: string) {
    super();
    this.name = name;
    this.toolName = name.slice(5).split('__').slice(1).join('__') || '';
    this.humanizedServerName = humanize(name.slice(5).split('__')[0] || '');
  }
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    const summary = mcpSummary(input);
    return [
      h('span', { class: TOOL.toolNameText }, [this.humanizedServerName, ' [', this.toolName, ']']),
      summary && secondary(summary),
    ];
  }
  renderInput(): VNodeChild {
    return null;
  }
}

// ---- Claude in Chrome -------------------------------------------------------

const CHROME_PREFIX = 'mcp__claude-in-chrome__';

/** `ef1` */
function isChromeTool(name: string): boolean {
  return name.startsWith(CHROME_PREFIX);
}

/** `pL0` */
function chromeSummary(tool: string, input: Input): string | null {
  switch (tool) {
    case 'navigate':
      if (typeof input.url === 'string') {
        try {
          return new URL(input.url).hostname;
        } catch {
          return clip(input.url, 30);
        }
      }
      return null;
    case 'find':
      return typeof input.query === 'string' ? `pattern: ${clip(input.query, 30)}` : null;
    case 'computer':
      if (typeof input.action === 'string') {
        const action = input.action;
        if (action === 'left_click' || action === 'right_click' || action === 'double_click' || action === 'middle_click') {
          if (typeof input.ref === 'string') return `${action} on ${input.ref}`;
          if (Array.isArray(input.coordinate)) return `${action} at (${input.coordinate.join(', ')})`;
          return action;
        }
        if (action === 'type' && typeof input.text === 'string') return `type "${clip(input.text, 15)}"`;
        if (action === 'key' && typeof input.text === 'string') return `key ${input.text}`;
        if (action === 'scroll' && typeof input.scroll_direction === 'string') return `scroll ${input.scroll_direction}`;
        if (action === 'wait' && typeof input.duration === 'number') return `wait ${input.duration}ms`;
        if (action === 'left_click_drag') return 'drag';
        if (action === 'screenshot') return 'screenshot';
        return action;
      }
      return null;
    case 'gif_creator':
      return typeof input.action === 'string' ? input.action : null;
    case 'resize_window':
      return typeof input.width === 'number' && typeof input.height === 'number' ? `${input.width}x${input.height}` : null;
    case 'read_console_messages':
      if (typeof input.pattern === 'string') return `pattern: ${clip(input.pattern, 20)}`;
      if (input.onlyErrors === true) return 'errors only';
      return null;
    case 'read_network_requests':
      return typeof input.urlPattern === 'string' ? `pattern: ${clip(input.urlPattern, 20)}` : null;
    case 'javascript_tool':
      return 'execute';
    default:
      return null;
  }
}

/** `DS` */
function chromeDoneText(tool: string): string | null {
  switch (tool) {
    case 'navigate': return 'Navigation completed';
    case 'tabs_create_mcp':
    case 'tabs_create': return 'Tab created';
    case 'tabs_context_mcp':
    case 'tabs_context': return 'Tabs read';
    case 'form_input': return 'Input completed';
    case 'computer': return 'Action completed';
    case 'resize_window': return 'Window resized';
    case 'find': return 'Search completed';
    case 'gif_creator': return 'GIF action completed';
    case 'read_console_messages': return 'Console messages retrieved';
    case 'read_network_requests': return 'Network requests retrieved';
    case 'javascript_tool': return 'Script executed';
    case 'read_page': return 'Page read';
    case 'get_page_text': return 'Text retrieved';
    case 'upload_image': return 'Image uploaded';
    case 'update_plan': return 'Plan updated';
    default: return null;
  }
}

/** `mL0`: the trailing "Tab Context:" block is not shown. */
function withoutTabContext(result: Result): Result {
  if (!result) return undefined;
  const marker = '\nTab Context:\n';
  if (typeof result.content === 'string') {
    const at = result.content.lastIndexOf(marker);
    return at !== -1 ? { ...result, content: result.content.slice(0, at) } : result;
  }
  if (Array.isArray(result.content)) {
    return {
      ...result,
      content: result.content.map((c: any) => {
        if (c.type === 'text') {
          const at = c.text.lastIndexOf(marker);
          if (at !== -1) return { ...c, text: c.text.slice(0, at) };
        }
        return c;
      }),
    };
  }
  return result;
}

/** `uL0` */
function screenshotUrl(result: Result): string | null {
  if (!result || !Array.isArray(result.content)) return null;
  for (const c of result.content) {
    if (c.type === 'image' && c.source?.type === 'base64') return `data:${c.source.media_type};base64,${c.source.data}`;
  }
  return null;
}

/** `T61` (module DU_5JQ) */
class ChromeToolRenderer extends ToolRenderer {
  readonly name: string;
  private readonly toolName: string;
  private readonly displayName: string;
  constructor(name: string) {
    super();
    this.name = name;
    this.toolName = name.startsWith(CHROME_PREFIX) ? name.slice(CHROME_PREFIX.length) : name;
    this.displayName = this.toolName === 'tabs_create_mcp' ? 'tabs_create' : this.toolName === 'tabs_context_mcp' ? 'tabs_context' : this.toolName;
  }
  header(_ctx: ToolRenderContext, input: Input): VNodeChild {
    const summary = chromeSummary(this.toolName, input);
    const tabUrl = input.tabId !== undefined ? `https://clau.de/chrome/tab/${input.tabId}` : null;
    return [
      h('span', { class: TOOL.toolNameText }, ['Claude in Chrome [', this.displayName, ']']),
      tabUrl && h('a', { href: tabUrl, target: '_blank', rel: 'noopener noreferrer', class: 'fg-chrometool__tabLink' }, '[Show Tab]'),
      summary && secondary(summary),
    ];
  }
  body(ctx: ToolRenderContext, input: Input, result: Result): VNodeChild {
    if (result?.is_error) return super.body(ctx, input, result);
    if (this.toolName === 'javascript_tool') return super.body(ctx, input, result);
    if (this.toolName === 'computer') return this.renderComputerTool(result);
    if (['find', 'gif_creator', 'read_console_messages', 'read_network_requests', 'read_page', 'get_page_text', 'update_plan'].includes(this.toolName)) {
      return this.renderOutputBox(ctx, result);
    }
    const done = chromeDoneText(this.toolName);
    return done ? secondaryLine(done) : null;
  }
  private renderComputerTool(result: Result): VNodeChild {
    const shot = screenshotUrl(result);
    if (shot) {
      return [
        secondaryLine(chromeDoneText(this.toolName) || 'Action completed'),
        h('div', { class: 'fg-chrometool__screenshotContainer' }, [h(ThumbnailAttachment, { label: 'Screenshot', dataUrl: shot })]),
      ];
    }
    const done = chromeDoneText(this.toolName);
    return done ? secondaryLine(done) : null;
  }
  private renderOutputBox(ctx: ToolRenderContext, result: Result): VNodeChild {
    const row = this.renderOutput(ctx, result);
    if (!row) {
      const done = chromeDoneText(this.toolName);
      return done ? secondaryLine(done) : null;
    }
    return h('div', { class: TOOL.toolBody }, [h('div', { class: TOOL.toolBodyGrid }, [row])]);
  }
  renderOutput(ctx: ToolRenderContext, result: Result, input?: Input): VNodeChild {
    return super.renderOutput(ctx, withoutTabContext(result), input);
  }
}

/** `xB1`: any other tool, drawn by the base. */
class DefaultToolRenderer extends ToolRenderer {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
}

const REGISTERED: ToolRenderer[] = [
  new AgentOutputToolRenderer(),
  new ArtifactRenderer(),
  new BashRenderer(),
  new PowerShellRenderer(),
  new TaskOutputRenderer(),
  new AgentRenderer(),
  new TodoWriteRenderer(),
  new ReadRenderer(),
  new WriteRenderer(),
  new EditRenderer(),
  new GlobRenderer(),
  new GrepRenderer(),
  new SearchRenderer(),
  new WebFetchRenderer(),
  new ExitPlanModeRenderer(),
  new ReadCoalescedRenderer(),
  new NotebookEditRenderer(),
  new SkillRenderer(),
  new AskUserQuestionRenderer(),
  new WebSearchRenderer(),
  new ToolSearchRenderer(),
  new ReplRenderer(),
  new SandboxNetworkAccessRenderer(),
];

/** `BY`: the renderer for a tool name. */
export function getToolRenderer(name: string): ToolRenderer {
  const lookup = name === 'Task' ? 'Agent' : name;
  const found = REGISTERED.find((r) => r.name === lookup);
  if (found) return found;
  if (isChromeTool(name)) return new ChromeToolRenderer(name);
  if (isMcpTool(name)) return new McpToolRenderer(name);
  return new DefaultToolRenderer(name);
}
