/**
 * What happens to pictures before a request leaves the relay.
 *
 *   - a model that can see gets its pictures, within `maxImageBytes`
 *     (`imageBudget.ts`) -- oldest dropped first, newest always kept;
 *   - a model that cannot see gets the text an OCR engine read from each
 *     picture (`imageText.ts`), so a text-only model can still use them.
 *
 * Whether a model can see is decided per model: a `vision` flag on the
 * profile's `models` entry wins over the profile's `capabilities.vision`, so
 * one endpoint can serve a vision model and a text-only one side by side
 * ("OCR ... under each model", 2026-10-03).
 */
import type { EndpointProfile, OcrSpec } from '../profile';
import { applyImageBudget } from './imageBudget';
import { hasImages, OcrCache, replaceImagesWithText, type OcrEngine } from './imageText';

/** Whether the model the request names can take images. */
export function modelSeesImages(profile: EndpointProfile, requestedModel: string | undefined): boolean {
  const mapped = requestedModel ? profile.modelMap?.[requestedModel] : undefined;
  const ids = [requestedModel, mapped].filter((id): id is string => !!id);
  const entry = profile.models?.find((m) => ids.includes(m.id));
  if (entry && typeof entry.vision === 'boolean') return entry.vision;
  return profile.capabilities.vision;
}

/** The OCR engines to try for this profile, in order (`auto` = model, then tesseract). */
export function ocrPlan(spec: OcrSpec | undefined): Array<'model' | 'tesseract'> {
  const engine = spec?.engine ?? 'auto';
  if (engine === 'off') return [];
  if (engine === 'model') return spec?.model ? ['model'] : [];
  if (engine === 'tesseract') return ['tesseract'];
  return spec?.model ? ['model', 'tesseract'] : ['tesseract'];
}

/** Chain engines: the first one that returns text wins. */
export function firstOf(engines: OcrEngine[]): OcrEngine | undefined {
  if (!engines.length) return undefined;
  return async (data, mediaType) => {
    for (const engine of engines) {
      try {
        const text = await engine(data, mediaType);
        if (text !== undefined) return text;
      } catch {
        // Try the next engine.
      }
    }
    return undefined;
  };
}

export interface PreparedImages<T> {
  messages: T[];
  /** The model can see: the caller must not strip the remaining images. */
  vision: boolean;
  notes: string[];
}

export async function prepareImages<T extends { role?: string; content?: unknown }>(
  messages: T[] | undefined,
  profile: EndpointProfile,
  requestedModel: string | undefined,
  engine: OcrEngine | undefined,
  cache: OcrCache,
): Promise<PreparedImages<T>> {
  const list = messages ?? [];
  const vision = modelSeesImages(profile, requestedModel);
  if (!hasImages(list as never)) return { messages: list, vision, notes: [] };

  if (vision) {
    const budget = applyImageBudget(list, profile.capabilities.maxImageBytes);
    return {
      messages: budget.messages,
      vision,
      notes: budget.removed
        ? [`dropped ${budget.removed} older image(s) to stay under maxImageBytes (${profile.capabilities.maxImageBytes})`]
        : [],
    };
  }

  const read = await replaceImagesWithText(list, engine, cache);
  return {
    messages: read.messages,
    vision,
    notes: read.converted ? [`${read.converted} image(s) given to "${requestedModel ?? profile.model}" as OCR text (no vision)`] : [],
  };
}
