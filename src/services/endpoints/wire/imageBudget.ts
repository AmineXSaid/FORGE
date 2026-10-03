/**
 * `capabilities.maxImageBytes`, applied.
 *
 * The profile field was documented and defaulted (profile.ts) but nothing read
 * it. Every request carries the whole conversation, so each picture is re-sent
 * on every later turn: a vision model answered the first few messages and then
 * stopped answering mid-conversation (reported 2026-10-03), because the body
 * had grown past the gateway's limit and the 413 left the CLI with nothing.
 *
 * The rule is the one profile.ts states: count base64 image bytes from the
 * newest picture back; once over budget, older pictures become a line saying
 * so. The newest picture is always sent, whatever it weighs.
 *
 * Pure: takes and returns Anthropic-shaped messages, never mutates its input.
 */

interface Block {
  type?: string;
  source?: { type?: string; data?: string };
  content?: unknown;
  [key: string]: unknown;
}

interface Message {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

export const IMAGE_DROPPED_TEXT =
  '[An earlier image was removed from this request to stay under the endpoint\'s size limit.]';

/** Where an image sits: message index, block index, and (inside a tool result) the inner index. */
type Path = [number, number] | [number, number, number];

function imageBytes(block: Block): number {
  return block?.type === 'image' && block.source?.type === 'base64' && typeof block.source.data === 'string'
    ? block.source.data.length
    : 0;
}

/** Every base64 image in conversation order, with its size. */
function findImages(messages: Message[]): Array<{ path: Path; bytes: number }> {
  const found: Array<{ path: Path; bytes: number }> = [];
  messages.forEach((msg, m) => {
    if (!Array.isArray(msg?.content)) return;
    (msg.content as Block[]).forEach((block, b) => {
      const bytes = imageBytes(block);
      if (bytes) found.push({ path: [m, b], bytes });
      if (block?.type === 'tool_result' && Array.isArray(block.content)) {
        (block.content as Block[]).forEach((inner, i) => {
          const innerBytes = imageBytes(inner);
          if (innerBytes) found.push({ path: [m, b, i], bytes: innerBytes });
        });
      }
    });
  });
  return found;
}

export function applyImageBudget<T extends Message>(
  messages: T[],
  maxBytes: number,
): { messages: T[]; removed: number } {
  if (!Array.isArray(messages) || !(maxBytes > 0)) return { messages, removed: 0 };
  const images = findImages(messages);
  if (images.length < 2) return { messages, removed: 0 };

  const drop: Path[] = [];
  let total = 0;
  for (let i = images.length - 1; i >= 0; i--) {
    total += images[i]!.bytes;
    // The newest is always kept; every older one must fit in what is left.
    if (i < images.length - 1 && total > maxBytes) drop.push(images[i]!.path);
  }
  if (!drop.length) return { messages, removed: 0 };

  const out = messages.map((msg) =>
    Array.isArray(msg.content)
      ? { ...msg, content: (msg.content as Block[]).map((b) => (Array.isArray(b?.content) ? { ...b, content: [...(b.content as Block[])] } : b)) }
      : msg,
  ) as T[];
  const placeholder = { type: 'text', text: IMAGE_DROPPED_TEXT };
  for (const path of drop) {
    const blocks = out[path[0]]!.content as Block[];
    if (path.length === 2) blocks[path[1]] = placeholder;
    else (blocks[path[1]]!.content as Block[])[path[2]] = placeholder;
  }
  return { messages: out, removed: drop.length };
}
