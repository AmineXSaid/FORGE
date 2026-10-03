/**
 * The OCR engines behind `imageText.ts`: the I/O half, kept apart so the
 * rewrite can be tested with a fake engine.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { request as undiciRequest, type Dispatcher } from 'undici';
import type { EndpointProfile } from '../profile';
import { ANTHROPIC_VERSION, anthropicMessagesUrl } from '../urls';
import { OCR_MODEL_PROMPT, type OcrEngine } from './imageText';
import { firstOf, ocrPlan } from './imagePrep';

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/** Where the OpenAI chat route lives (same rule as `anthropicServer.chatUrl`). */
function openAiChatUrl(profile: EndpointProfile): string {
  const base = profile.baseUrl.replace(/\/+$/, '');
  if (profile.chatPath) return base + (profile.chatPath.startsWith('/') ? '' : '/') + profile.chatPath;
  return /\/v\d+[a-z]*$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/** A vision model on the same endpoint, asked to transcribe the picture. */
export function modelOcrEngine(
  profile: EndpointProfile,
  dispatcher: Dispatcher,
  headers: Record<string, string>,
  log: (line: string) => void,
): OcrEngine | undefined {
  const model = profile.ocr?.model;
  if (!model) return undefined;
  const timeout = profile.ocr?.timeoutMs ?? 60_000;
  return async (data, mediaType) => {
    const openai = profile.wire === 'openai';
    const url = openai ? openAiChatUrl(profile) : anthropicMessagesUrl(profile.baseUrl, profile.chatPath);
    const body = openai
      ? {
          model,
          max_tokens: 2048,
          stream: false,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: OCR_MODEL_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } },
            ],
          }],
        }
      : {
          model,
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
              { type: 'text', text: OCR_MODEL_PROMPT },
            ],
          }],
        };
    const res = await undiciRequest(url, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        ...(openai ? {} : { 'anthropic-version': ANTHROPIC_VERSION }),
      },
      body: JSON.stringify(body),
      dispatcher,
      headersTimeout: timeout,
      bodyTimeout: timeout,
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      log(`[ocr] ${profile.name}: ${model} answered ${res.statusCode}`);
      return undefined;
    }
    const json = JSON.parse(text);
    const out = openai
      ? json?.choices?.[0]?.message?.content
      : (json?.content ?? []).filter((b: { type?: string }) => b?.type === 'text').map((b: { text?: string }) => b.text).join('');
    return typeof out === 'string' ? out : undefined;
  };
}

/** The `tesseract` command, when installed. Fixed arguments; the picture goes through a temp file. */
export function tesseractEngine(command = 'tesseract', timeoutMs = 30_000): OcrEngine {
  let missing = false;
  return async (data, mediaType) => {
    if (missing) return undefined;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-ocr-'));
    const file = path.join(dir, `${crypto.randomUUID()}${EXTENSIONS[mediaType] ?? '.png'}`);
    try {
      await fs.writeFile(file, Buffer.from(data, 'base64'));
      return await new Promise<string | undefined>((resolve) => {
        execFile(command, [file, 'stdout'], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
          if (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') missing = true;
            resolve(undefined);
            return;
          }
          resolve(String(stdout));
        });
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/** The engine chain for a profile, per `ocr.engine`. */
export function ocrEngineFor(
  profile: EndpointProfile,
  dispatcher: Dispatcher,
  headers: Record<string, string>,
  log: (line: string) => void,
): OcrEngine | undefined {
  const engines: OcrEngine[] = [];
  for (const kind of ocrPlan(profile.ocr)) {
    if (kind === 'model') {
      const engine = modelOcrEngine(profile, dispatcher, headers, log);
      if (engine) engines.push(engine);
    } else {
      // Only the `tesseract` on PATH: a profile can come from a workspace
      // folder, and must not be able to name a program to run.
      engines.push(tesseractEngine());
    }
  }
  return firstOf(engines);
}
