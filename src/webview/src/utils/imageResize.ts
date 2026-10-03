/**
 * Shrink an image before it is attached.
 *
 * Reported 2026-10-03: an uploaded picture worked, a pasted one got no answer.
 * A pasted screenshot is a full-resolution PNG -- several megabytes of base64
 * on a HiDPI screen -- where a picked file is usually a small JPEG. Anthropic
 * rejects images over 5 MB or 8000 px, and an OpenAI-shaped gateway behind the
 * relay answers a body that size with a 413, so the turn ended with nothing.
 *
 * The model sees no more than ~1568 px on the long edge anyway (larger images
 * are downscaled server-side), so that is the cap here; a result still over
 * the byte budget is re-encoded as JPEG.
 */

/** The long edge Anthropic recommends; larger images cost latency, not detail. */
export const MAX_IMAGE_EDGE = 1568;

/** Base64 length above which an image is re-encoded as JPEG (~1 MB of bytes). */
export const MAX_IMAGE_BASE64 = 1_400_000;

/** The size to draw an image at: within `maxEdge`, aspect kept, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height);
  if (!(long > maxEdge)) return { width, height, scaled: false };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true };
}

/** Whether an image needs re-drawing at all. GIFs are left alone (animation). */
export function needsShrink(mediaType: string, width: number, height: number, base64Length: number): boolean {
  if (mediaType === 'image/gif') return false;
  return fitWithin(width, height).scaled || base64Length > MAX_IMAGE_BASE64;
}

/**
 * Re-draw a base64 image within the caps. Returns the original when it is
 * already small, or when the browser cannot decode it (the CLI may still).
 */
export async function shrinkImage(
  data: string,
  mediaType: string,
): Promise<{ data: string; mediaType: string }> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return { data, mediaType };
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = `data:${mediaType};base64,${data}`;
    });
    if (!needsShrink(mediaType, img.naturalWidth, img.naturalHeight, data.length)) return { data, mediaType };

    const size = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { data, mediaType };
    ctx.drawImage(img, 0, 0, size.width, size.height);

    // Keep PNG for screenshots (sharp text) when it fits; else JPEG.
    const keepType = mediaType === 'image/png' || mediaType === 'image/webp' ? mediaType : 'image/jpeg';
    let url = canvas.toDataURL(keepType, 0.9);
    let outType = keepType;
    if (url.length - url.indexOf(',') - 1 > MAX_IMAGE_BASE64) {
      // JPEG has no alpha: paint a white ground first so transparency stays legible.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size.width, size.height);
      url = canvas.toDataURL('image/jpeg', 0.85);
      outType = 'image/jpeg';
    }
    const out = url.slice(url.indexOf(',') + 1);
    return out.length < data.length || size.scaled ? { data: out, mediaType: outType } : { data, mediaType };
  } catch {
    return { data, mediaType };
  }
}
