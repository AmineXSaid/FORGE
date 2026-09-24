#!/usr/bin/env node
/**
 * An OpenAI-compatible gateway for the end-to-end runs: what Forge's relay
 * talks to in place of the user's real gateway (omniroute, Ollama, ...).
 *
 *   node stub-gateway.mjs --port 11434
 *
 * - `GET /v1/models`: two chat models and one embedding model.
 * - `POST /v1/chat/completions`, streamed or not. Every request's `model` is
 *   logged, so a scenario can prove which id reached the gateway (never a
 *   `claude-*` id once an endpoint is chosen).
 * - The reply is scripted from the last user message, so a scenario can make
 *   the model act:
 *     "write <absolute path> :: <content>"  -> a `Write` tool call
 *     "run :: <command>"                    -> a `Bash` tool call
 *     "plan :: <markdown>"                  -> an `ExitPlanMode` tool call
 *     "slow <ms>"                           -> a text reply after that delay
 *     anything else                         -> "Stub reply N: <the prompt>"
 *   After a tool result, it answers "Done: <tool>" as text.
 * - When the request carries `reasoning_effort`, the reply streams a
 *   `reasoning_content` delta first ("Reasoning at <effort>."), so a
 *   scenario can see effort reach the gateway and thinking reach the UI.
 * - The log keeps, per request, the reasoning fields and the system prompt,
 *   so effort, thinking and output styles can be checked from what the CLI
 *   actually sent.
 * - Control: `POST /__control {down:true|false, delayMs}` takes the gateway
 *   down (connection reset) or slows it; `GET /__log` answers every request
 *   seen; `POST /__reset` clears the log.
 */
import { createServer } from 'node:http';

const argOf = (flag, fallback) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback);
const PORT = Number(argOf('--port', '11434'));
const MODELS = ['qwen3-coder', 'llama-3.3-70b', 'nomic-embed-text'];

let control = { down: false, delayMs: 0 };
let log = [];
let replies = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n');
  return '';
}

/** What the model "does", from the conversation so far. */
function plan(messages) {
  // A tool result answers the last assistant turn's call. The CLI can add a
  // user turn after it (an attachment, a reminder), so look past the tail.
  const lastAssistant = messages.findLastIndex((m) => m.role === 'assistant');
  if (lastAssistant >= 0 && messages.slice(lastAssistant + 1).some((m) => m.role === 'tool')) {
    const call = messages[lastAssistant].tool_calls?.[0]?.function?.name ?? 'tool';
    return { text: `Done: ${call}.` };
  }
  const users = messages.filter((m) => m.role === 'user');
  // The prompt the user typed is the last line of the last user turn, once
  // the tagged context the CLI adds (<system-reminder>, <ide_selection>,
  // <ide_opened_file>, ...) is taken out: it can sit on the prompt's own line.
  const untagged = textOf(users.at(-1)?.content).replace(/<([a-z_-]+)>[\s\S]*?<\/\1>/g, '\n');
  const prompt = untagged.trim().split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
  let match = /^write (\S+) :: ([\s\S]*)$/.exec(prompt);
  if (match) return { tool: { name: 'Write', arguments: { file_path: match[1], content: match[2] } } };
  match = /^run :: ([\s\S]*)$/.exec(prompt);
  if (match) return { tool: { name: 'Bash', arguments: { command: match[1], description: 'Run what the test asked' } } };
  match = /^plan :: ([\s\S]*)$/.exec(prompt);
  if (match) return { tool: { name: 'ExitPlanMode', arguments: { plan: match[1] } } };
  match = /^slow (\d+)/.exec(prompt);
  if (match) return { text: `Slow reply after ${match[1]}ms.`, delayMs: Number(match[1]) };
  replies++;
  return { text: `Stub reply ${replies}: ${prompt.slice(0, 80)}` };
}

async function completions(req, res) {
  const body = await readBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const entry = {
    at: Date.now(),
    model: body.model,
    stream: !!body.stream,
    tools: Array.isArray(body.tools) ? body.tools.length : 0,
    lastUser: textOf(messages.filter((m) => m.role === 'user').at(-1)?.content).slice(-2000),
    messages: messages.length,
    reasoning_effort: body.reasoning_effort,
    reasoning: body.reasoning,
    max_tokens: body.max_tokens ?? body.max_completion_tokens,
    system: textOf(messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n')).slice(0, 60_000),
  };
  log.push(entry);
  if (control.down) {
    req.socket.destroy();
    return;
  }
  if (!MODELS.includes(body.model)) {
    entry.status = 404;
    return json(res, 404, { error: { message: `model ${body.model} not found`, type: 'not_found_error' } });
  }
  const next = plan(messages);
  entry.reply = next.tool ? `tool:${next.tool.name}` : next.text;
  await sleep(control.delayMs + (next.delayMs ?? 0));
  const id = `chatcmpl-${Date.now()}`;
  const toolCall = next.tool && { index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: next.tool.name, arguments: JSON.stringify(next.tool.arguments) } };
  const finish = next.tool ? 'tool_calls' : 'stop';
  const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };

  if (!body.stream) {
    return json(res, 200, {
      id,
      object: 'chat.completion',
      model: body.model,
      choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: next.text ?? null, ...(toolCall && { tool_calls: [{ id: toolCall.id, type: 'function', function: toolCall.function }] }) } }],
      usage,
    });
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (chunk) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: body.model, ...chunk })}\n\n`);
  send({ choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
  if (body.reasoning_effort && !next.tool) {
    send({ choices: [{ index: 0, delta: { reasoning_content: `Reasoning at ${body.reasoning_effort}.` }, finish_reason: null }] });
  }
  if (next.text) {
    for (const word of next.text.split(/(?<= )/)) {
      if (control.down) {
        req.socket.destroy();
        return;
      }
      send({ choices: [{ index: 0, delta: { content: word }, finish_reason: null }] });
      await sleep(15);
    }
  } else {
    send({ choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }] });
  }
  send({ choices: [{ index: 0, delta: {}, finish_reason: finish }], usage });
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    // `/__log` leaves the (long) system prompts out unless `?system=1`.
    if (url.pathname === '/__log') return json(res, 200, url.searchParams.get('system') ? log : log.map(({ system, ...rest }) => ({ ...rest, systemLength: system?.length ?? 0 })));
    if (url.pathname === '/__reset' && req.method === 'POST') {
      log = [];
      replies = 0;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/__control' && req.method === 'POST') {
      control = { ...control, ...(await readBody(req)) };
      return json(res, 200, control);
    }
    if (control.down) {
      req.socket.destroy();
      return;
    }
    if (url.pathname.endsWith('/models') && req.method === 'GET') {
      return json(res, 200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'stub' })) });
    }
    if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') return completions(req, res);
    json(res, 404, { error: { message: `no route ${req.method} ${url.pathname}` } });
  } catch (error) {
    json(res, 500, { error: { message: String(error) } });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`stub-gateway: http://127.0.0.1:${PORT}/v1`));
