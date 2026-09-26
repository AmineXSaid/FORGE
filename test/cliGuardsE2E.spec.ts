/**
 * The small-model guards against the real Claude Code CLI.
 *
 * Opt-in, because it spawns the CLI binary: set FORGE_CLI_E2E=1. The binary
 * is FORGE_CLI_PATH, else the one `pnpm run build` copies into
 * resources/native-binary (the version Forge ships), else
 * /opt/claude-code/bin/claude. Without one the suite skips.
 *
 * Each scenario puts a scripted OpenAI-compatible gateway behind Forge's
 * relay and drives the CLI through the Agent SDK with the hooks wired the way
 * `ClaudeSdkService` wires them. What these prove that the unit specs cannot:
 * that the CLI really runs a recovered tool call, really delivers a hook's
 * additionalContext to the model, really ends a turn on continue:false, and
 * really continues a turn on a Stop hook's additionalContext.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startRelay, type RunningRelay } from '../src/services/endpoints/relay';
import { parseProfile } from '../src/services/endpoints/profile';
import { LoopGuard } from '../src/services/claude/loopGuard';
import { StopGate } from '../src/services/claude/stopGate';
import { toolResponseText } from '../src/services/claude/smartStream';

const CLI = [process.env.FORGE_CLI_PATH, path.resolve('resources/native-binary/claude'), '/opt/claude-code/bin/claude']
  .find((p): p is string => !!p && fs.existsSync(p));
const suite = process.env.FORGE_CLI_E2E === '1' && CLI ? describe : describe.skip;

type Reply = { text?: string; call?: { name: string; args: unknown } };

interface Scenario {
  /** The gateway's reply to the n-th request that carries tools (0-based). */
  reply: (n: number, body: any) => Reply;
  capabilities?: Record<string, unknown>;
  promptTokens?: (body: any) => number;
  allowedTools?: string[];
  hooks?: Record<string, unknown>;
  /** Runs with the scenario's working directory before the CLI starts. */
  setup?: (dir: string) => void;
}

suite('small-model guards against the real CLI', () => {
  const cleanup: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0)) await fn();
  });

  async function run(s: Scenario) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cli-e2e-'));
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    s.setup?.(dir);
    const requests: any[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
        const reply: Reply = hasTools ? s.reply(requests.length, body) : { text: 'Title' };
        if (hasTools) requests.push(body);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        if (reply.call) {
          send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${requests.length}`, function: { name: reply.call.name, arguments: JSON.stringify(reply.call.args) } }] } }] });
          send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        } else {
          if (reply.text) send({ choices: [{ delta: { content: reply.text } }] });
          send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        }
        const prompt = s.promptTokens?.(body) ?? Math.ceil(JSON.stringify(body).length / 3.5);
        send({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: 10 } });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    cleanup.push(() => new Promise<void>((r) => server.close(() => r())));

    const logs: string[] = [];
    const truncations: string[] = [];
    const relay: RunningRelay = await startRelay({
      profile: parseProfile({
        name: 'e2e', wire: 'openai', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        model: 'small', proxy: { useEnvironment: false },
        capabilities: { contextWindow: 128_000, ...(s.capabilities ?? {}) },
      }, 'e2e'),
      secrets: () => undefined,
      workspaceRoot: dir,
      log: (m) => logs.push(m),
      onTruncation: (advice) => truncations.push(advice),
    });
    cleanup.push(() => relay.close());

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const messages: any[] = [];
    try {
      for await (const m of query({
        prompt: 'Do the task.',
        options: {
          cwd: dir,
          pathToClaudeCodeExecutable: CLI,
          model: 'small',
          maxTurns: 10,
          settingSources: [],
          allowedTools: s.allowedTools ?? ['Read', 'Edit', 'Bash'],
          hooks: s.hooks as any,
          env: {
            PATH: process.env.PATH ?? '', HOME: dir, TMPDIR: dir,
            ANTHROPIC_BASE_URL: relay.baseUrl, ANTHROPIC_AUTH_TOKEN: relay.token, ANTHROPIC_API_KEY: '',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'small', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          },
        },
      })) messages.push(m);
    } catch {
      // A turn that ends on an error result throws at the end; the messages
      // collected so far are what the assertions look at.
    }
    return { dir, requests, messages, logs, truncations, result: messages.find((m) => m.type === 'result') };
  }

  it('runs a tool call the model wrote as text, with its name and argument repaired', async () => {
    const out = await run({
      reply: (n) => n === 0
        ? { text: `I'll write it.\n<tool_call>\n{"name": "bash", "arguments": {"cmd": "echo ok > marker.txt"}}\n</tool_call>` }
        : { text: 'Done.' },
      allowedTools: ['Bash'],
    });
    expect(fs.readFileSync(path.join(out.dir, 'marker.txt'), 'utf8').trim()).toBe('ok');
    expect(out.logs.some((l) => l.includes('recovered 1 tool call(s)'))).toBe(true);
    expect(out.logs.some((l) => l.includes('renamed argument "cmd" to "command"'))).toBe(true);
  }, 90_000);

  it('warns a model that repeats itself, then ends the turn', async () => {
    const guard = new LoopGuard();
    const verdicts: string[] = [];
    let file = '';
    const out = await run({
      setup: (dir) => { file = path.join(dir, 'a.txt'); fs.writeFileSync(file, 'hello\n'); },
      reply: () => ({ call: { name: 'Read', args: { file_path: file } } }),
      allowedTools: ['Read'],
      hooks: {
        PostToolUse: [{
          hooks: [async (i: any) => {
            const v = guard.record(i.session_id, 'strict', i.tool_name, i.tool_input, toolResponseText(i.tool_response));
            verdicts.push(v.action);
            if (v.action === 'stop') return { continue: false, stopReason: v.message };
            if (v.action === 'nudge') return { continue: true, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: v.message } };
            return { continue: true };
          }],
        }],
      },
    });
    expect(verdicts).toContain('nudge');
    expect(verdicts.at(-1)).toBe('stop');
    expect(out.requests.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(out.requests.map((r) => r.messages))).toContain('Potential loop detected');
  }, 90_000);

  it('makes the model answer for a claim no tool call backs', async () => {
    const gate = new StopGate();
    const out = await run({
      reply: (n) => ({ text: n === 0 ? 'Done: I updated `src/config.ts` and the tests pass.' : 'Correction: I changed nothing yet.' }),
      hooks: {
        UserPromptSubmit: [{ hooks: [async (i: any) => { gate.beginTurn(i.session_id); return { continue: true }; }] }],
        Stop: [{
          hooks: [async (i: any) => {
            const feedback = gate.onStop(i.session_id, 'strict', i.last_assistant_message, i.stop_hook_active);
            return feedback
              ? { continue: true, hookSpecificOutput: { hookEventName: 'Stop', additionalContext: feedback } }
              : { continue: true };
          }],
        }],
      },
    });
    expect(out.requests).toHaveLength(2);
    expect(JSON.stringify(out.requests[1].messages)).toContain('Before you finish');
    expect(out.result?.result).toMatch(/Correction/);
  }, 90_000);

  it('adds the fix to an Edit whose old_string is not in the file', async () => {
    let file = '';
    const out = await run({
      setup: (dir) => { file = path.join(dir, 'f.ts'); fs.writeFileSync(file, 'function f() {\n    return 1;\n}\n'); },
      reply: (n) => {
        if (n === 0) return { call: { name: 'Read', args: { file_path: file } } };
        // Tab-indented: the file uses four spaces, so this is not in it.
        if (n === 1) return { call: { name: 'Edit', args: { file_path: file, old_string: '\treturn 1;', new_string: '\treturn 2;' } } };
        return { text: 'Stopping.' };
      },
    });
    const toolResults = JSON.stringify(out.requests.at(-1)?.messages ?? []);
    expect(toolResults).toContain('old_string must match the file exactly');
    expect(toolResults).toMatch(/(near|at) line 2/);
  }, 90_000);

  it('forced tool mode: the ExitTool answer is the result', async () => {
    const out = await run({
      reply: (_n, body) => {
        expect(body.tool_choice).toBe('required');
        return { call: { name: 'ExitTool', args: { response: 'Answered through ExitTool.' } } };
      },
      capabilities: { forceToolUse: true },
    });
    expect(out.result?.result).toBe('Answered through ExitTool.');
  }, 90_000);

  it('warns when the gateway reads only the start of the prompt', async () => {
    const out = await run({
      reply: () => ({ text: 'ok' }),
      promptTokens: () => 4096,
    });
    expect(out.truncations[0]).toMatch(/processed only 4,096 of about/);
  }, 90_000);
});
