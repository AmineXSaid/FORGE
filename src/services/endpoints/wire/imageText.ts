/**
 * Images for models that cannot see: read the text out of them first (OCR).
 *
 * Asked for on 2026-10-03: "OCR ... so text-only models can read images".
 * Until now a picture sent to an endpoint without `capabilities.vision` became
 * `[image omitted: ...]`, so a screenshot of an error reached the model as
 * nothing. Here each picture is replaced by a text block carrying what an OCR
 * engine read from it, before the request is translated or forwarded.
 *
 * Engines, in the order `auto` tries them (`EndpointProfile.ocr`):
 *   - `model`: a vision model on the same endpoint (`ocr.model`), asked to
 *     transcribe the picture -- the best reader, and the same credential;
 *   - `tesseract`: the `tesseract` command, when it is installed (offline);
 * and when neither is available the block says so, so the model can tell the
 * user instead of guessing.
 *
 * Every request re-sends the whole conversation, so results are cached by the
 * picture's hash: each image is read once per relay, not once per turn.
 *
 * This file holds the pure rewrite; the engines that do I/O are passed in.
 */
import * as crypto from 'node:crypto';

/** Reads one picture. Resolves to its text, or undefined when it could not. */
export type OcrEngine = (data: string, mediaType: string) => Promise<string | undefined>;

interface Block {
  type?: string;
  text?: string;
  source?: { type?: string; data?: string; media_type?: string };
  content?: unknown;
  [key: string]: unknown;
}

interface Message {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

/** What a block says when no engine could read the picture. */
export const OCR_UNAVAILABLE_TEXT =
  '[The user attached an image, but this model cannot see images and no OCR engine is configured. ' +
  'Tell the user to set `ocr.model` (a vision model on this endpoint) in the endpoint profile, ' +
  'or install `tesseract`.]';

export function imageTextBlock(text: string | undefined, index: number): { type: 'text'; text: string } {
  if (text === undefined) return { type: 'text', text: OCR_UNAVAILABLE_TEXT };
  const body = text.trim() || '(no text was found in the image)';
  return {
    type: 'text',
    text: `[Image ${index} -- this model cannot see images, so its contents were read by OCR:]\n${body}\n[End of image ${index}]`,
  };
}

function isBase64Image(block: Block | undefined): block is Block & { source: { data: string } } {
  return block?.type === 'image' && block.source?.type === 'base64' && typeof block.source.data === 'string';
}

/** A cache of read pictures, keyed by content hash. Bounded so a long session cannot grow it forever. */
export class OcrCache {
  private readonly map = new Map<string, string | undefined>();
  constructor(private readonly max = 64) {}
  key(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  get(key: string): string | undefined {
    return this.map.get(key);
  }
  set(key: string, value: string | undefined): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, value);
  }
}

/**
 * Replace every base64 image (including those inside tool results) with the
 * text an engine read from it. Never mutates `messages`.
 */
export async function replaceImagesWithText<T extends Message>(
  messages: T[],
  engine: OcrEngine | undefined,
  cache: OcrCache,
): Promise<{ messages: T[]; converted: number }> {
  if (!Array.isArray(messages)) return { messages, converted: 0 };
  let converted = 0;
  let index = 0;

  const read = async (block: Block & { source: { data: string } }): Promise<{ type: 'text'; text: string }> => {
    index++;
    const key = cache.key(block.source.data);
    let text: string | undefined;
    if (cache.has(key)) {
      text = cache.get(key);
    } else {
      try {
        text = engine ? await engine(block.source.data, block.source.media_type ?? 'image/png') : undefined;
      } catch {
        text = undefined;
      }
      // An engine failure is not cached: the next turn may have one.
      if (text !== undefined) cache.set(key, text);
    }
    converted++;
    return imageTextBlock(text, index);
  };

  const rewrite = async (blocks: Block[]): Promise<Block[]> => {
    const out: Block[] = [];
    for (const block of blocks) {
      if (isBase64Image(block)) {
        out.push(await read(block));
      } else if (block?.type === 'tool_result' && Array.isArray(block.content)) {
        out.push({ ...block, content: await rewrite(block.content as Block[]) });
      } else {
        out.push(block);
      }
    }
    return out;
  };

  const out: T[] = [];
  for (const msg of messages) {
    out.push(Array.isArray(msg?.content) ? { ...msg, content: await rewrite(msg.content as Block[]) } : msg);
  }
  return { messages: converted ? out : messages, converted };
}

/** Whether any base64 image is present, so the rewrite (and its engine) can be skipped. */
export function hasImages(messages: Message[] | undefined): boolean {
  const scan = (blocks: unknown): boolean =>
    Array.isArray(blocks) &&
    blocks.some((b: Block) => isBase64Image(b) || (b?.type === 'tool_result' && scan(b.content)));
  return Array.isArray(messages) && messages.some((m) => scan(m?.content));
}

/** The instruction a vision model gets when it is used as the OCR engine. */
export const OCR_MODEL_PROMPT =
  'Transcribe all text visible in this image exactly as written, preserving line breaks, code and ' +
  'indentation. After the transcription, add one short paragraph starting with "Visual:" that describes ' +
  'anything important that is not text (charts, diagrams, UI layout, colours). Output nothing else.';
