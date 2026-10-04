import { shrinkImage } from '../utils/imageResize';
/**
 * 附件相关类型定义
 */

/**
 * 附件预览（UI 显示用）
 */
export interface AttachmentPreview {
  id: string;
  fileName: string;
  fileSize: number;
  mediaType: string;
}

/**
 * 附件完整数据（发送到后端）
 */
export interface AttachmentPayload {
  fileName: string;
  mediaType: string;
  data: string; // base64 编码（不含 data:xxx 前缀）
  fileSize?: number;
  /** Saved into the workspace by the host (`stage_attachment`): sent as this text. */
  staged?: { path: string; text: string };
}

/**
 * 附件内部数据（包含 ID）
 */
export interface AttachmentItem extends AttachmentPayload {
  id: string;
  fileSize: number;
  /**
   * Forge: set while the file is still being read or prepared, so a large file
   * shows up as a chip the moment it is dropped instead of only once it is
   * done. `reading` has a byte count; `processing` (shrinking an image, the
   * host staging an archive) has none and shows as indeterminate.
   */
  pending?: AttachmentProgress;
}

export interface AttachmentProgress {
  phase: 'reading' | 'processing';
  /** Bytes read so far (`reading` only). */
  loaded: number;
  total: number;
}

/** Whether any attachment is still loading: a message must not go out without it. */
export function hasPendingAttachments(items: readonly AttachmentItem[]): boolean {
  return items.some((item) => item.pending !== undefined);
}

/** 0–100 for a chip in the `reading` phase, undefined when there is no measure. */
export function attachmentPercent(progress: AttachmentProgress | undefined): number | undefined {
  if (!progress || progress.phase !== 'reading' || !(progress.total > 0)) return undefined;
  return Math.min(100, Math.max(0, Math.round((progress.loaded / progress.total) * 100)));
}

/** Reported while a file is read: bytes so far and the file's size. */
export type ReadProgress = (loaded: number, total: number) => void;

/** `FileReader.readAsDataURL`, with progress events forwarded. */
function readDataUrl(file: File, onProgress?: ReadProgress): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    if (onProgress) {
      reader.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      };
    }
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 支持的图片 MIME 类型 (the official `Dj0`)
 */
export const IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

/**
 * Text-ish `application/*` types (the official `Pj0`).
 *
 * `text/*` is handled by prefix; these are the ones browsers label as
 * `application/…` while being perfectly readable source.
 */
export const TEXT_MEDIA_TYPES = [
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-javascript',
  'application/x-typescript',
  'application/x-yaml',
  'application/yaml',
  'application/x-sh',
  'application/x-shellscript',
  'application/sql',
  'application/graphql',
  'application/toml',
  'application/x-toml',
] as const;

/**
 * Extensions that mean "this is text" (the official `cR1`).
 *
 * This set is why the classifier takes a file *name* and not just a MIME type.
 * Browsers report `""` or `application/octet-stream` for most source files —
 * and `.ts` is commonly reported as `video/mp2t` — so a MIME-only rule rejects
 * exactly the files a coding agent is most likely to be handed.
 */
export const TEXT_EXTENSIONS = new Set([
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'env', 'properties',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts',
  'py', 'pyw', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'cs', 'fs', 'fsx', 'swift', 'php', 'pl', 'pm',
  'lua', 'r', 'jl', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs', 'cljc', 'elm', 'hs',
  'ml', 'mli', 'v', 'sv', 'vhd', 'vhdl', 'asm', 's',
  'html', 'htm', 'xhtml', 'xml', 'svg', 'css', 'scss', 'sass', 'less',
  'vue', 'svelte', 'astro',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'bat', 'cmd',
  'csv', 'tsv', 'sql', 'graphql', 'gql', 'prisma',
  'md', 'mdx', 'markdown', 'rst', 'txt', 'text', 'rtf', 'tex', 'latex', 'org',
  'adoc', 'asciidoc',
  'makefile', 'cmake', 'gradle', 'dockerfile', 'containerfile', 'vagrantfile',
  'rakefile', 'gemfile', 'podfile', 'fastfile', 'brewfile', 'procfile',
  'lock', 'sum', 'log', 'diff', 'patch',
  'gitignore', 'gitattributes', 'editorconfig', 'prettierrc', 'eslintrc',
  'babelrc', 'npmrc', 'nvmrc', 'yarnrc',
]);

/** Extensionless files that are still text (the official's tail in `Mj0`). */
export const BARE_TEXT_FILENAMES = new Set([
  'license', 'readme', 'changelog', 'authors', 'contributors', 'copying',
]);

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'unsupported';

/** The official `Mj0`. */
function isTextLike(mediaType: string, fileName: string): boolean {
  if (mediaType.startsWith('text/')) return true;
  if ((TEXT_MEDIA_TYPES as readonly string[]).includes(mediaType)) return true;

  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension && TEXT_EXTENSIONS.has(extension)) return true;

  const name = fileName.toLowerCase();
  return TEXT_EXTENSIONS.has(name) || BARE_TEXT_FILENAMES.has(name);
}

/**
 * The official `lR1`: what kind of content block this file becomes.
 *
 * Both arguments matter. Classifying on the MIME type alone is what made Forge
 * drop `.ts`, `.py` and `.ps1` files on the floor.
 */
export function classifyAttachment(mediaType: string, fileName: string): AttachmentKind {
  const type = (mediaType || 'application/octet-stream').toLowerCase();
  if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(type)) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (isTextLike(type, fileName)) return 'text';
  return 'unsupported';
}

/**
 * The official `jj0`: may this file be attached at all?
 *
 * Checked when the file is picked, not when the message is sent. Forge used to
 * accept everything into the chip row and discard the unusable ones silently at
 * send time, so a `.zip` looked attached and simply never arrived.
 */
export function isSupportedAttachment(file: { type: string; name: string }): boolean {
  return classifyAttachment(file.type, file.name) !== 'unsupported';
}

/**
 * Forge: the largest file the host will save into the workspace for the model
 * (`attachmentStaging.ts` MAX_STAGED_BYTES).
 */
export const MAX_STAGED_FILE_BYTES = 64 * 1024 * 1024;

/** Read a file as bare base64 (no `data:` prefix). */
export async function readFileBase64(file: File, onProgress?: ReadProgress): Promise<string> {
  const dataUrl = await readDataUrl(file, onProgress);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/**
 * Base64 → text, the official's way.
 *
 * `atob` alone yields one byte per char, so any file that is not pure ASCII
 * arrives mojibake'd. Round-tripping through `Uint8Array` and `TextDecoder`
 * reads it as the UTF-8 it almost always is.
 */
export function decodeBase64Text(data: string): string {
  const binary = globalThis.atob(data);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/**
 * 文件大小格式化
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * 将 File 对象转换为 AttachmentItem
 */
export async function convertFileToAttachment(file: File, onProgress?: ReadProgress): Promise<AttachmentItem> {
  // 读取文件为 base64
  const dataUrl = await readDataUrl(file, onProgress);

  // 解析 data URL: "data:image/png;base64,iVBORw0KGgo..."
  const [prefix, rawData] = dataUrl.split(',');
  const match = prefix.match(/data:([^;]+);base64/);
  let mediaType = (match ? match[1] : 'application/octet-stream').toLowerCase();
  let data = rawData ?? '';
  let fileName = file.name || 'attachment';

  // Images are shrunk to what the model can use (utils/imageResize.ts): a
  // pasted screenshot is otherwise a multi-megabyte PNG that the endpoint
  // refuses, and the turn ends with no answer.
  if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    const shrunk = await shrinkImage(data, mediaType);
    if (shrunk.mediaType !== mediaType) {
      fileName = fileName.replace(/\.[^.]*$/, '') + '.jpg';
    }
    data = shrunk.data;
    mediaType = shrunk.mediaType;
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fileName,
    mediaType,
    data, // 纯 base64 字符串（不含前缀）
    fileSize: Math.floor((data.length * 3) / 4),
  };
}
