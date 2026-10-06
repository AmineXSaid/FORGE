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
 *     "edit <absolute path> :: <old> => <new>" -> a `Read` of the file, then
 *                                             an `Edit` (the CLI refuses an
 *                                             edit to a file it has not read)
 *     "run :: <command>"                    -> a `Bash` tool call
 *     "plan :: <markdown>"                  -> an `ExitPlanMode` tool call
 *     "slow <ms>"                           -> a text reply after that delay
 *     "cutwrite <absolute path>"            -> a `Write` whose arguments are cut
 *                                             off mid-content, with
 *                                             `finish_reason: "length"` (48a)
 *     "steps :: forever"                    -> a new `Bash` call (`echo step N`)
 *                                             after every tool result, never a
 *                                             final answer (the step cap)
 *     "edits <ms> :: <path> :: <old> => <new> || ..." -> a Read and an Edit per
 *                                             file, in one turn, <ms> apart
 *     a demo's prompt, word for word        -> the scripted showcase in
 *                                             demos/<name>.json (real tools,
 *                                             scripted wording)
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
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * The prompt the user typed in a user turn: its last line, once the tagged
 * context the CLI adds (<system-reminder>, <ide_selection>, <ide_opened_file>,
 * ...) is taken out, since that can sit on the prompt's own line.
 */
function promptOf(message) {
  const untagged = textOf(message?.content).replace(/<([a-z_-]+)>[\s\S]*?<\/\1>/g, '\n');
  return untagged.trim().split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
}

const EDIT = /^edit (\S+) :: ([\s\S]*?) => ([\s\S]*)$/;

/** `(nothing)` as the new text is a deletion: a typed prompt cannot end in a space. */
const newText = (text) => (text.trim() === '(nothing)' ? '' : text);

/**
 * "edits <ms> :: <path> :: <old> => <new> || <path> :: <old> => <new> ...":
 * several files edited in one turn, as an agent does -- a Read, then an Edit,
 * per file, each reply <ms> after the last (the model's thinking time).
 */
const EDITS = /^edits (\d+) :: ([\s\S]*)$/;

function editsSteps(script) {
  return script
    .split(' || ')
    .map((step) => /^(\S+) :: ([\s\S]*?) => ([\s\S]*)$/.exec(step.trim()))
    .filter(Boolean)
    .flatMap((m) => [
      { name: 'Read', arguments: { file_path: m[1] } },
      { name: 'Edit', arguments: { file_path: m[1], old_string: m[2], new_string: newText(m[3]) } },
    ]);
}

/**
 * Scripted showcases (demos/<name>.json), played in one turn when the user's
 * prompt is a demo's `prompt`, word for word -- so the transcript shows the
 * natural request. Each step is a tool call (optionally preceded by a
 * sentence, `say`) or the closing text; `${DIR}` is the working directory the
 * CLI states in its system prompt. The tools run for real in the CLI; only the
 * wording is scripted.
 */
const DEMOS = join(dirname(fileURLToPath(import.meta.url)), 'demos');
const demos = () => readdirSync(DEMOS).filter((f) => f.endsWith('.json')).map((f) => readFileSync(join(DEMOS, f), 'utf8'));

function demoFor(prompt, system) {
  const dir = /(?:Primary )?[Ww]orking directory:\s*(\S+)/.exec(system)?.[1];
  if (!dir) return undefined;
  for (const text of demos()) {
    if (JSON.parse(text).prompt === prompt) return JSON.parse(text.replaceAll('${DIR}', dir)).steps;
  }
  return undefined;
}

/** What the model "does", from the conversation so far. */
function plan(messages) {
  // An `edits` script runs step by step for as long as it is the prompt the
  // user last typed (one that does not just follow a tool result).
  const lastPrompt = messages.findLastIndex((m, i) => m.role === 'user' && promptOf(m) && messages[i - 1]?.role !== 'tool');
  const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
  const steps = lastPrompt >= 0 ? demoFor(promptOf(messages[lastPrompt]), system) : undefined;
  if (steps) {
    const done = messages.slice(lastPrompt + 1).filter((m) => m.role === 'tool').length;
    const step = steps[Math.min(done, steps.length - 1)];
    // Realistic usage, so Forge's small-context warning stays out of the shots.
    return { ...(step.tool ? { tool: step.tool, say: step.say } : { text: step.text }), delayMs: 900, usage: { prompt_tokens: 18_000, completion_tokens: 160, total_tokens: 18_160 } };
  }
  const multi = lastPrompt >= 0 && EDITS.exec(promptOf(messages[lastPrompt]));
  if (multi) {
    const steps = editsSteps(multi[2]);
    const done = messages.slice(lastPrompt + 1).filter((m) => m.role === 'tool').length;
    if (done < steps.length) return { tool: steps[done], delayMs: Number(multi[1]) };
    return { text: `Done: ${steps.length / 2} edits.` };
  }
  // "steps :: forever": a fresh call after every result, so only a step cap ends the turn.
  if (lastPrompt >= 0 && promptOf(messages[lastPrompt]) === 'steps :: forever') {
    const done = messages.slice(lastPrompt + 1).filter((m) => m.role === 'tool').length;
    return { tool: { name: 'Bash', arguments: { command: `echo step ${done + 1}`, description: 'One more step' } } };
  }
  // A tool result answers the last assistant turn's call. The CLI can add a
  // user turn after it (an attachment, a reminder), so look past the tail.
  const lastAssistant = messages.findLastIndex((m) => m.role === 'assistant');
  // Unless a new scripted prompt came after the result: a call answered "No"
  // ends the turn, and the next thing the user types starts a new one.
  const lastResult = messages.findLastIndex((m) => m.role === 'tool');
  const newPrompt = lastResult >= 0 && messages.slice(lastResult + 1).some((m) => m.role === 'user' && /^(write|cutwrite|edit|edits|run|plan|slow|steps) /.test(promptOf(m)));
  if (lastAssistant >= 0 && !newPrompt && messages.slice(lastAssistant + 1).some((m) => m.role === 'tool')) {
    const call = messages[lastAssistant].tool_calls?.[0]?.function;
    // An `edit` script: the file has been read, so now edit it.
    const script = messages.slice(0, lastAssistant).filter((m) => m.role === 'user').map(promptOf).findLast((p) => EDIT.test(p));
    const edit = script && EDIT.exec(script);
    if (call?.name === 'Read' && edit) {
      let read = {};
      try { read = JSON.parse(call.arguments); } catch { /* not ours */ }
      if (read.file_path === edit[1]) return { tool: { name: 'Edit', arguments: { file_path: edit[1], old_string: edit[2], new_string: newText(edit[3]) } } };
    }
    return { text: `Done: ${call?.name ?? 'tool'}.` };
  }
  const users = messages.filter((m) => m.role === 'user');
  const prompt = promptOf(users.at(-1));
  let match = EDIT.exec(prompt);
  if (match) return { tool: { name: 'Read', arguments: { file_path: match[1] } } };
  match = /^write (\S+) :: ([\s\S]*)$/.exec(prompt);
  if (match) return { tool: { name: 'Write', arguments: { file_path: match[1], content: match[2] } } };
  match = /^cutwrite (\S+)$/.exec(prompt);
  if (match) {
    // Cut off by the output token limit in the middle of `content`.
    const raw = JSON.stringify({ file_path: match[1], content: 'line1\nline2 that never finish' }).slice(0, -10);
    return { tool: { name: 'Write', raw }, finish: 'length' };
  }
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
  const fullSystem = textOf(messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n'));
  const entry = {
    at: Date.now(),
    model: body.model,
    stream: !!body.stream,
    tools: Array.isArray(body.tools) ? body.tools.length : 0,
    // Which tools the CLI offered, and which Hermes agent's persona it ran as
    // (read from the whole system prompt, which `system` below truncates).
    toolNames: Array.isArray(body.tools) ? body.tools.map((t) => t.function?.name ?? t.name) : [],
    agents: [...fullSystem.matchAll(/^## Agent: (\S+)$/gm)].map((m) => m[1]),
    lastUser: textOf(messages.filter((m) => m.role === 'user').at(-1)?.content).slice(-2000),
    // The last tool result, so a scenario can read the hint the relay added.
    lastTool: textOf(messages.filter((m) => m.role === 'tool').at(-1)?.content).slice(-2000),
    messages: messages.length,
    reasoning_effort: body.reasoning_effort,
    reasoning: body.reasoning,
    max_tokens: body.max_tokens ?? body.max_completion_tokens,
    system: fullSystem.slice(0, 60_000),
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
  const toolCall = next.tool && { index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: next.tool.name, arguments: next.tool.raw ?? JSON.stringify(next.tool.arguments) } };
  const finish = next.finish ?? (next.tool ? 'tool_calls' : 'stop');
  const usage = next.usage ?? { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };

  if (!body.stream) {
    return json(res, 200, {
      id,
      object: 'chat.completion',
      model: body.model,
      choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: next.text ?? next.say ?? null, ...(toolCall && { tool_calls: [{ id: toolCall.id, type: 'function', function: toolCall.function }] }) } }],
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
    if (next.say) {
      for (const word of next.say.split(/(?<= )/)) {
        send({ choices: [{ index: 0, delta: { content: word }, finish_reason: null }] });
        await sleep(15);
      }
    }
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
