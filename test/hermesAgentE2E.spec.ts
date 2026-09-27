/**
 * A Hermes agent's scope, against the real Claude Code CLI.
 *
 * Opt-in, because it spawns the CLI binary: set FORGE_CLI_E2E=1 (the binary as
 * in cliGuardsE2E: FORGE_CLI_PATH, else resources/native-binary/claude). Each
 * scenario puts a scripted OpenAI-compatible gateway behind Forge's relay and
 * runs the CLI through the Agent SDK with the options `AgentService` produces
 * and the PreToolUse hook `ClaudeSdkService` adds. What this proves that the
 * unit specs cannot: that the CLI really withholds a tool the scope leaves out,
 * and really refuses a call the hook denies, with the model told why.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startRelay } from '../src/services/endpoints/relay';
import { parseProfile } from '../src/services/endpoints/profile';
import { AgentService } from '../src/services/agents/agentService';
import type { Agent } from '../src/services/agents/loader';

const CLI = [process.env.FORGE_CLI_PATH, path.resolve('resources/native-binary/claude'), '/opt/claude-code/bin/claude']
  .find((p): p is string => !!p && fs.existsSync(p));
const suite = process.env.FORGE_CLI_E2E === '1' && CLI ? describe : describe.skip;

type Call = { name: string; args: unknown };

const log = { info: () => {}, warn: () => {}, error: () => {}, trace: () => {} };

function agent(overrides: Partial<Agent>): Agent {
  return {
    name: 'reviewer', description: 'Reviews changes.', persona: 'You review.', model: '', memory: '',
    tools: [], skills: [], mcp: [], allMcp: true, file: '/x/reviewer.md', ...overrides,
  };
}

suite('Hermes agent scope against the real CLI', () => {
  const cleanup: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0)) await fn();
  });

  /**
   * One conversation: the model makes `call` once, then says it is done. The
   * scope is the agent's; `advertise: false` leaves `tools` unset, so only the
   * PreToolUse hook stands between the model and the call.
   */
  async function run(a: Agent, call: (dir: string) => Call, advertise = true) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-hermes-e2e-'));
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const requests: any[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
        const n = requests.length;
        if (hasTools) requests.push(body);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        if (hasTools && n === 0) {
          const c = call(dir);
          send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }] });
          send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        } else {
          send({ choices: [{ delta: { content: hasTools ? 'Done.' : 'Title' } }] });
          send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        }
        send({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 10 } });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    cleanup.push(() => new Promise<void>((r) => server.close(() => r())));

    const relay = await startRelay({
      profile: parseProfile({
        name: 'e2e', wire: 'openai', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        model: 'small', proxy: { useEnvironment: false }, capabilities: { contextWindow: 128_000 },
      }, 'e2e'),
      secrets: () => undefined,
      workspaceRoot: dir,
      log: () => {},
    });
    cleanup.push(() => relay.close());

    const options = new AgentService(log as any).toSdkOptions(a);
    const refused: string[] = [];
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    try {
      for await (const _ of query({
        prompt: 'Do the task.',
        options: {
          cwd: dir,
          pathToClaudeCodeExecutable: CLI,
          model: 'small',
          maxTurns: 4,
          settingSources: [],
          // Every permission granted, so the scope is the only thing that can
          // stop a call. (Not bypass mode: the CLI refuses that as root.)
          canUseTool: async (_name: string, input: Record<string, unknown>) => ({ behavior: 'allow', updatedInput: input }),
          ...(advertise && options.tools ? { tools: options.tools } : {}),
          ...(options.disallowedTools ? { disallowedTools: options.disallowedTools } : {}),
          // The hook as ClaudeSdkService adds it.
          hooks: {
            PreToolUse: [{
              hooks: [async (input: any) => {
                const reason = options.refusal(input.tool_name);
                if (!reason) return { continue: true };
                refused.push(input.tool_name);
                return {
                  continue: true,
                  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
                };
              }],
            }],
          },
          env: {
            PATH: process.env.PATH ?? '', HOME: dir, TMPDIR: dir,
            ANTHROPIC_BASE_URL: relay.baseUrl, ANTHROPIC_AUTH_TOKEN: relay.token, ANTHROPIC_API_KEY: '',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'small', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          },
        } as any,
      })) { /* drain */ }
    } catch {
      // A turn that ends on an error result throws at the end.
    }
    const offered = (requests[0]?.tools ?? []).map((t: any) => t.function?.name ?? t.name);
    return { dir, requests, offered, refused };
  }

  it('a read-only agent is never offered Bash, and a Bash call does not run -- even with every permission granted', async () => {
    const out = await run(agent({ tools: ['Read', 'Grep', 'Glob'] }), () => ({
      name: 'Bash', args: { command: 'echo ran > marker.txt' },
    }));
    expect(out.offered).toEqual(expect.arrayContaining(['Read']));
    expect(out.offered).not.toContain('Bash');
    expect(out.offered).not.toContain('Write');
    expect(out.offered).not.toContain('Edit');
    expect(fs.existsSync(path.join(out.dir, 'marker.txt'))).toBe(false);
  }, 90_000);

  it('Hermes tool names scope the same: read_file offers Read, not Write', async () => {
    const out = await run(agent({ tools: ['read_file', 'search_files'] }), (dir) => ({
      name: 'Write', args: { file_path: path.join(dir, 'written.txt'), content: 'x' },
    }));
    expect(out.offered).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob']));
    expect(out.offered).not.toContain('Write');
    expect(fs.existsSync(path.join(out.dir, 'written.txt'))).toBe(false);
  }, 90_000);

  it('the PreToolUse deny refuses an out-of-scope call the CLI offered, and tells the model why', async () => {
    const out = await run(agent({ tools: ['Read'] }), (dir) => ({
      name: 'Write', args: { file_path: path.join(dir, 'written.txt'), content: 'x' },
    }), false);
    expect(out.offered).toContain('Write'); // offered: only the hook stands in the way
    expect(out.refused).toEqual(['Write']);
    expect(fs.existsSync(path.join(out.dir, 'written.txt'))).toBe(false);
    expect(JSON.stringify(out.requests.at(-1)?.messages)).toContain('Refused: \\"Write\\" was not called. The reviewer agent is scoped to Read.');
  }, 90_000);

  it('an unrestricted agent restricts nothing: the call runs', async () => {
    const out = await run(agent({}), (dir) => ({
      name: 'Write', args: { file_path: path.join(dir, 'written.txt'), content: 'x' },
    }));
    expect(out.offered).toEqual(expect.arrayContaining(['Bash', 'Write']));
    expect(out.refused).toEqual([]);
    expect(fs.readFileSync(path.join(out.dir, 'written.txt'), 'utf8')).toBe('x');
  }, 90_000);
});
