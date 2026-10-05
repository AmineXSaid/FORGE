/**
 * Pictures on custom endpoints (reported 2026-10-03):
 *   1. vision models stopped answering mid-conversation -- every picture was
 *      re-sent on every turn and `maxImageBytes` was never applied;
 *   5. text-only models could not read pictures at all -- now OCR text;
 *  12. attached text files and PDFs vanished on the OpenAI wire.
 */
import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { applyImageBudget, IMAGE_DROPPED_TEXT } from '../src/services/endpoints/wire/imageBudget';
import {
  hasImages,
  OCR_UNAVAILABLE_TEXT,
  OcrCache,
  replaceImagesWithText,
} from '../src/services/endpoints/wire/imageText';
import { firstOf, modelSeesImages, ocrPlan, prepareImages } from '../src/services/endpoints/wire/imagePrep';
import { documentText, toOpenAI } from '../src/services/endpoints/wire/toOpenAI';
import { extractPdfText, looksReadable, textFromContentStream } from '../src/services/endpoints/wire/pdfText';
import { parseProfile, ProfileError } from '../src/services/endpoints/profile';
import { fitWithin, needsShrink } from '../src/webview/src/utils/imageResize';
import { normalizePastedText } from '../src/webview/src/utils/composerText';

const img = (bytes: number, tag = 'x') => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data: tag.repeat(bytes) },
});

const profile = (over: Record<string, unknown> = {}) =>
  parseProfile({ name: 'p', wire: 'openai', baseUrl: 'https://h/v1', model: 'm', ...over }, 'test');

describe('image budget (maxImageBytes)', () => {
  it('keeps everything under budget', () => {
    const messages = [{ role: 'user', content: [img(100), { type: 'text', text: 'a' }] }, { role: 'user', content: [img(100)] }];
    const out = applyImageBudget(messages, 1000);
    expect(out.removed).toBe(0);
    expect(out.messages).toBe(messages);
  });

  it('drops the oldest first and always keeps the newest, even when it alone is over', () => {
    const messages = [
      { role: 'user', content: [img(600, 'a')] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      { role: 'user', content: [img(600, 'b')] },
      { role: 'user', content: [img(5000, 'c')] },
    ];
    const out = applyImageBudget(messages, 1000);
    expect(out.removed).toBe(2);
    expect((out.messages[0]!.content as any[])[0]).toEqual({ type: 'text', text: IMAGE_DROPPED_TEXT });
    expect((out.messages[2]!.content as any[])[0]).toEqual({ type: 'text', text: IMAGE_DROPPED_TEXT });
    expect((out.messages[3]!.content as any[])[0].type).toBe('image');
    // Input untouched.
    expect((messages[0]!.content as any[])[0].type).toBe('image');
  });

  it('counts pictures inside tool results', () => {
    const messages = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [img(800, 'a')] }] },
      { role: 'user', content: [img(800, 'b')] },
    ];
    const out = applyImageBudget(messages, 1000);
    expect(out.removed).toBe(1);
    expect((out.messages[0]!.content as any[])[0].content[0].text).toBe(IMAGE_DROPPED_TEXT);
  });
});

describe('OCR for models without vision', () => {
  it('replaces each picture with the text the engine read, and reads a picture once', async () => {
    let calls = 0;
    const engine = async () => { calls++; return 'Error: ENOENT'; };
    const cache = new OcrCache();
    const messages = [{ role: 'user', content: [img(10, 'a'), { type: 'text', text: 'what is this?' }] }];
    const first = await replaceImagesWithText(messages, engine, cache);
    expect(first.converted).toBe(1);
    const block = (first.messages[0]!.content as any[])[0];
    expect(block.type).toBe('text');
    expect(block.text).toContain('Error: ENOENT');
    await replaceImagesWithText(messages, engine, cache);
    expect(calls).toBe(1);
  });

  it('says so, instead of guessing, when no engine can read it', async () => {
    const out = await replaceImagesWithText([{ role: 'user', content: [img(10)] }], undefined, new OcrCache());
    expect((out.messages[0]!.content as any[])[0].text).toBe(OCR_UNAVAILABLE_TEXT);
  });

  it('does not cache a failure, so a later turn can still read the picture', async () => {
    let fail = true;
    const engine = async () => (fail ? undefined : 'text');
    const cache = new OcrCache();
    const messages = [{ role: 'user', content: [img(10)] }];
    await replaceImagesWithText(messages, engine, cache);
    fail = false;
    const out = await replaceImagesWithText(messages, engine, cache);
    expect((out.messages[0]!.content as any[])[0].text).toContain('text');
  });

  it('chains engines: the first answer wins, a throw falls through', async () => {
    const chain = firstOf([async () => { throw new Error('x'); }, async () => undefined, async () => 'third']);
    expect(await chain!('d', 'image/png')).toBe('third');
    expect(firstOf([])).toBeUndefined();
  });

  it('plans engines from the profile', () => {
    expect(ocrPlan(undefined)).toEqual(['tesseract']);
    expect(ocrPlan({ model: 'vl' })).toEqual(['model', 'tesseract']);
    expect(ocrPlan({ engine: 'model', model: 'vl' })).toEqual(['model']);
    expect(ocrPlan({ engine: 'off', model: 'vl' })).toEqual([]);
  });

  it('finds pictures nested in tool results', () => {
    expect(hasImages([{ role: 'user', content: [{ type: 'tool_result', content: [img(1)] }] }])).toBe(true);
    expect(hasImages([{ role: 'user', content: 'hi' }])).toBe(false);
  });
});

describe('vision is decided per model', () => {
  it('a models entry overrides the profile capability, through modelMap too', () => {
    const p = profile({
      capabilities: { vision: false },
      models: [{ id: 'qwen-vl', vision: true }, { id: 'coder' }],
      modelMap: { 'claude-haiku': 'qwen-vl' },
    });
    expect(modelSeesImages(p, 'qwen-vl')).toBe(true);
    expect(modelSeesImages(p, 'claude-haiku')).toBe(true);
    expect(modelSeesImages(p, 'coder')).toBe(false);
  });

  it('a vision model gets its pictures; a text model gets OCR text', async () => {
    const p = profile({ capabilities: { vision: false }, models: [{ id: 'vl', vision: true }, { id: 'txt' }] });
    const messages = [{ role: 'user', content: [img(10)] }];
    const seen = await prepareImages(messages, p, 'vl', async () => 'never', new OcrCache());
    expect(seen.vision).toBe(true);
    expect((seen.messages[0]!.content as any[])[0].type).toBe('image');
    const read = await prepareImages(messages, p, 'txt', async () => 'hello', new OcrCache());
    expect(read.vision).toBe(false);
    expect((read.messages[0]!.content as any[])[0].text).toContain('hello');
  });
});

describe('documents on the OpenAI wire', () => {
  it('sends an attached text file as text instead of dropping it', () => {
    const { body } = toOpenAI(
      {
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'a,b\n1,2' }, title: 'data.csv' } as any,
            { type: 'text', text: 'sum column b' },
          ],
        }],
      },
      profile(),
    );
    const content = (body.messages as any[])[0].content as string;
    expect(content).toContain('<document title="data.csv">');
    expect(content).toContain('a,b\n1,2');
  });

  it('reads the text out of a PDF, compressed or not', () => {
    const stream = 'BT /F1 12 Tf 72 712 Td (Hello PDF world) Tj T* [(Sec) -50 (ond) -400 (line)] TJ ET';
    const plain = Buffer.from(`%PDF-1.4\n1 0 obj << /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n%%EOF`, 'latin1');
    expect(extractPdfText(plain)).toContain('Hello PDF world');
    expect(extractPdfText(plain)).toContain('Second line');

    const deflated = zlib.deflateSync(Buffer.from(stream, 'latin1'));
    const compressed = Buffer.concat([
      Buffer.from(`%PDF-1.5\n1 0 obj << /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      deflated,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    expect(extractPdfText(compressed)).toContain('Hello PDF world');
    const text = documentText({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: compressed.toString('base64') }, title: 'r.pdf' });
    expect(text).toContain('Hello PDF world');
  });

  it('says a PDF could not be read rather than passing on noise', () => {
    expect(extractPdfText(Buffer.from('not a pdf'))).toBe('');
    expect(looksReadable('\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019')).toBe(false);
    const text = documentText({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('x').toString('base64') } });
    expect(text).toContain('no extractable text');
  });

  it('decodes escapes and hex strings', () => {
    expect(textFromContentStream('BT (a\\(b\\)c) Tj ET')).toContain('a(b)c');
    expect(textFromContentStream('BT <FEFF00480069> Tj ET')).toContain('Hi');
  });
});

describe('profile ocr block', () => {
  it('accepts a model and rejects nonsense', () => {
    expect(profile({ ocr: { model: 'qwen-vl' } }).ocr).toEqual({ model: 'qwen-vl' });
    expect(() => profile({ ocr: { engine: 'magic' } })).toThrow(ProfileError);
    expect(() => profile({ ocr: { engine: 'model' } })).toThrow(/needs ocr.model/);
    expect(() => profile({ ocr: 'yes' })).toThrow(ProfileError);
  });
});

describe('webview: pictures are shrunk before attaching, pastes normalized', () => {
  it('fits the long edge within 1568 and never enlarges', () => {
    expect(fitWithin(3840, 2160)).toEqual({ width: 1568, height: 882, scaled: true });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(needsShrink('image/png', 800, 600, 10)).toBe(false);
    expect(needsShrink('image/png', 800, 600, 5_000_000)).toBe(true);
    expect(needsShrink('image/gif', 4000, 4000, 5_000_000)).toBe(false);
  });

  it('normalizes Windows line breaks', () => {
    expect(normalizePastedText('a\r\nb\rc\u0000')).toBe('a\nb\nc');
  });
});

describe('composer: a leading /command that exists is highlighted', () => {
  // Imported lazily so the describe above stays focused on endpoints.
  it('matches known commands and skills only', async () => {
    const { leadingCommand } = await import('../src/webview/src/utils/composerText');
    const known = (n: string) => ['compact', 'pdf', 'frontend-design'].includes(n);
    expect(leadingCommand('/compact', known)).toEqual({ lead: '', command: '/compact' });
    expect(leadingCommand('  /pdf summarize this', known)).toEqual({ lead: '  ', command: '/pdf' });
    expect(leadingCommand('/frontend-design', known)?.command).toBe('/frontend-design');
    expect(leadingCommand('/nope do it', known)).toBeUndefined();
    expect(leadingCommand('/usr/bin/env', known)).toBeUndefined();
    expect(leadingCommand('run /compact', known)).toBeUndefined();
    expect(leadingCommand('/compac', known)).toBeUndefined();
  });
});

describe('mermaid fences', () => {
  it('draws mermaid, kind-labelled and bare diagram fences, and nothing else', async () => {
    const { isMermaidFence, mermaidSource } = await import('../src/webview/src/utils/mermaidBlocks');
    expect(isMermaidFence('mermaid', 'anything')).toBe(true);
    expect(isMermaidFence('Mermaid', 'x')).toBe(true);
    expect(isMermaidFence('', 'graph TD\n A-->B')).toBe(true);
    expect(isMermaidFence(undefined, 'sequenceDiagram\n A->>B: hi')).toBe(true);
    expect(isMermaidFence('', '%% comment\nflowchart LR\n a-->b')).toBe(true);
    expect(isMermaidFence('flowchart', 'LR\n a-->b')).toBe(false);
    expect(isMermaidFence('sequenceDiagram', 'A->>B: hi')).toBe(false);
    expect(isMermaidFence('sequenceDiagram', 'sequenceDiagram\nA->>B: hi')).toBe(true);
    expect(isMermaidFence('', 'graph of the data is below')).toBe(false);
    expect(isMermaidFence('ts', 'graph TD')).toBe(false);
    expect(isMermaidFence('', 'const x = 1')).toBe(false);
    expect(isMermaidFence('', 'architecture-beta\n  service db(database)[DB]')).toBe(true);
    expect(isMermaidFence('', 'C4Container\n  title x')).toBe(true);
    // Frontmatter before the header, and a direction-less graph with edges.
    expect(isMermaidFence('', '---\ntitle: Pipeline\n---\nflowchart LR\n  a --> b')).toBe(true);
    expect(isMermaidFence('', '---\nconfig:\n  theme: neutral\n---\nsequenceDiagram\n  A->>B: hi')).toBe(true);
    expect(isMermaidFence('', 'graph\n  A --> B')).toBe(true);
    expect(isMermaidFence('', 'flowchart\n  A -.-> B')).toBe(true);
    // ...but a lone word with no edges below is still prose, and frontmatter
    // over ordinary YAML is not a diagram.
    expect(isMermaidFence('', 'graph\nshows the data')).toBe(false);
    expect(isMermaidFence('', '---\ntitle: x\n---\nname: forge')).toBe(false);
    expect(mermaidSource('mermaid', 'graph TD')).toBe('graph TD');
    expect(mermaidSource('sequenceDiagram', 'sequenceDiagram\nA->>B: x')).toBe('sequenceDiagram\nA->>B: x');
  });
});

describe('retry and edit on a user message', () => {
  it('resumes just before the message, and sends a marked prompt once', async () => {
    const { resumePointBefore, markAutoSend, takeAutoSend, clearAutoSend } = await import('../src/webview/src/core/resend');
    const a = { uuid: 'u1', type: 'user' };
    const b = { uuid: 'a1', type: 'assistant' };
    const meta = { uuid: 'm1', type: 'meta' };
    const c = { uuid: 'u2', type: 'user' };
    const list = [a, b, meta, c];
    expect(resumePointBefore(list, c)).toBe('a1');
    expect(resumePointBefore(list, a)).toBeUndefined();
    markAutoSend('fix the bug');
    expect(takeAutoSend('something else')).toBe(false);
    expect(takeAutoSend('fix the bug')).toBe(true);
    expect(takeAutoSend('fix the bug')).toBe(false);
    markAutoSend('x');
    clearAutoSend();
    expect(takeAutoSend('x')).toBe(false);
  });
});
