/**
 * The model list and its labels, ported from the official webview bundle.
 *
 * Every function here is a literal port of one in `webview/index.js`; the
 * minified name is given beside each so the two can be diffed. They are pure, so
 * `test/modelMetadata.spec.ts` covers them without a DOM.
 *
 * The rows are the CLI's `ModelInfo` (`sdk.d.ts` L1313) exactly as the
 * initialize response carries them. Two of its fields are not in the published
 * typings -- the CLI marks them `@internal` -- but the CLI sends them and the
 * official picker renders them, so they are typed here from the CLI's own schema:
 *
 * - `disabled`: "Model is visible but not selectable (e.g. a model the org's Zero
 *   Data Retention setting excludes). The human-readable reason is folded into
 *   `description`." Such rows arrive in `unavailable_models`, never in `models`.
 * - `promoListPrice`: "List price (e.g. `$3/$15`) for a model currently on a
 *   launch promo ... rich pickers prepend this struck-through before the first
 *   `$X/$Y` in `description`."
 */
import type { CliModelInfo } from '../../../../shared/messages';

export type ModelRow = CliModelInfo;

/** What the rows are read from: the CLI initialize response's two model lists. */
export interface ModelCatalog {
  models?: ModelRow[];
  unavailable_models?: ModelRow[];
}

/** `q01`: the families the labels know how to name. */
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const;
/** `jo`: the 1M-context suffix on a model id. */
const ONE_M_ID = /\[1m\]$/i;
/** `Jz0`: the 1M-context suffix on a display name. */
const ONE_M_LABEL = /\s*\(1M context\)$/i;
/** `Z55`: rows that describe themselves as an alias sort after the concrete models. */
const ALIAS_ROW = /\balias(?:es)?\b/i;
/** `DM1`: Bedrock inference-profile prefixes (`us.anthropic.claude-…`). */
const INFERENCE_PREFIXES = ['us', 'eu', 'apac', 'jp', 'au', 'us-gov', 'global'];
/** `kM1`: what the pill says when it cannot name the model that answered. */
export const PREVIOUS_MODEL_LABEL = 'The previous model';
/** `JT`: the model id the CLI stamps on messages it made up itself. */
export const SYNTHETIC_MODEL = '<synthetic>';
/** `GA0`: the words that may follow a family name in a display name. */
const VERSION_WORD = /^(?:[\d.]+|1m|fast)$/i;
/** `YA0`: codename ids (`claude-<name>-v<n>-…`). */
const CODENAME_ID = /^(?:claude-)?([a-z]+)-v(\d+)((?:-[a-z]+)*)/;
/** `V75`: the price in a description that a promo list price is struck through before. */
const PRICE_PER_MTOK = /\$[\d.]+\/\$[\d.]+ per Mtok/;

/** `IH`: every row the picker shows -- selectable ones first, then unavailable ones. */
export function allModelRows(catalog: ModelCatalog | undefined): ModelRow[] {
  return [...(catalog?.models ?? []), ...(catalog?.unavailable_models ?? [])];
}

/** `PK1`: rows describing themselves as an alias go last; order is otherwise kept. */
export function orderAliasRowsLast<T extends Pick<ModelRow, 'displayName' | 'description'>>(rows: readonly T[]): T[] {
  const isAlias = (row: T) => ALIAS_ROW.test(`${row.displayName} ${row.description}`);
  return [...rows.filter((row) => !isAlias(row)), ...rows.filter(isAlias)];
}

/** `bK`: the row for a selection -- by value, else by the model id an alias resolves to. */
export function findModelRow(rows: readonly ModelRow[], selection: string | undefined): ModelRow | undefined {
  const value = !selection || selection === 'default' ? 'default' : selection;
  return (
    rows.find((row) => row.value === value) ??
    rows.find((row) => row.value !== 'default' && row.resolvedModel === value)
  );
}

/**
 * The official session's `currentModelInfo`: like `bK`, but it also matches the
 * selection with its `[1m]` suffix dropped, and lets `default` match by
 * `resolvedModel` too. This is the row `supportsEffort`, `supportedEffortLevels`,
 * `supportsFastMode` and `supportsAutoMode` are read from.
 */
export function currentModelInfo(rows: readonly ModelRow[], selection: string | undefined): ModelRow | undefined {
  const value = !selection || selection === 'default' ? 'default' : selection;
  const withoutOneM = value.replace(/\[1m\]$/i, '');
  return (
    rows.find((row) => row.value === value) ??
    rows.find((row) => row.value === withoutOneM) ??
    rows.find((row) => row.resolvedModel === value || row.resolvedModel === withoutOneM)
  );
}

/**
 * `Xz0`: which row the picker ticks. A persisted explicit id (`claude-opus-5`)
 * ticks the alias row that covers it (`opus`), so the check never disappears
 * just because the setting was written as a full id.
 */
export function pickerCurrentValue(rows: readonly ModelRow[], selection: string | undefined): string {
  if (!selection || selection === 'default') return 'default';
  const withoutOneM = selection.replace(ONE_M_ID, '');
  const aliasFor = (id: string) =>
    orderAliasRowsLast(rows.filter((row) => row.value !== 'default' && row.resolvedModel === id))[0];
  return (
    (
      rows.find((row) => row.value === selection) ??
      rows.find((row) => row.value === withoutOneM) ??
      aliasFor(selection) ??
      aliasFor(withoutOneM)
    )?.value ?? selection
  );
}

// ---- Model id parsing (`X01`, `eF0`, `tF0`, `V01`) --------------------------

interface ParsedModelId {
  family: string;
  major: number;
  minor?: number;
  legacyVersionFirst: boolean;
  base: string;
  trailer?: string;
  date?: string;
}

/** `eF0`: `claude-<family>-<major>[-<minor>]`, or the legacy `claude-<major>[-<minor>]-<family>`. */
function parseModelBase(id: string): Omit<ParsedModelId, 'trailer' | 'date'> | null {
  const modern = /^claude-([a-z]+)-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?/.exec(id);
  if (modern) {
    const [base, family = '', major = '', minor] = modern;
    return { family, major: Number(major), minor: minor === undefined ? undefined : Number(minor), legacyVersionFirst: false, base };
  }
  const legacy = /^claude-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?-([a-z]+)/.exec(id);
  if (legacy) {
    const [base, major = '', minor, family = ''] = legacy;
    return { family, major: Number(major), minor: minor === undefined ? undefined : Number(minor), legacyVersionFirst: true, base };
  }
  return null;
}

/** `tF0`: a trailer that is only a date / `-latest` / `-fast` / version stamp. */
function isPlainTrailer(trailer: string): boolean {
  return /^(?:-fast|-latest)?(?:-v\d{1,3}@\d{8}|[-@]\d{8})?(?:-v\d{1,3}(?::\d{1,3})?)?$/.test(trailer);
}

/** `X01`. */
function parseModelId(raw: string): ParsedModelId | null {
  let id = raw.trim().toLowerCase();
  if (id === '' || /\s/.test(id)) return null;
  id = id.replace(/\[[12]m\]$/, '');
  const slash = id.lastIndexOf('/');
  if (slash !== -1) id = id.slice(slash + 1);
  const bedrock = /^(?:([a-z-]+)\.)?anthropic\.(claude-.*)$/.exec(id);
  if (bedrock) {
    const [, prefix, rest = ''] = bedrock;
    if (prefix !== undefined && !INFERENCE_PREFIXES.includes(prefix)) return null;
    id = rest;
  }
  const base = parseModelBase(id);
  if (!base) return null;
  const trailer = id.slice(base.base.length);
  if (trailer !== '' && !/^[-@]/.test(trailer)) return null;
  const parsed: ParsedModelId = { family: base.family, major: base.major, legacyVersionFirst: base.legacyVersionFirst, base: base.base };
  if (base.minor !== undefined) parsed.minor = base.minor;
  if (!isPlainTrailer(trailer)) parsed.trailer = trailer;
  else {
    const date = /(?:-v\d+@|[-@])(\d{8})/.exec(trailer)?.[1];
    if (date !== undefined) parsed.date = date;
  }
  return parsed;
}

/** `V01`: family, `major[.minor]` and fast-ness of a known-family model id. */
function describeModelId(raw: string): { family: string; version: string; fast: boolean } | undefined {
  const lower = raw.trim().toLowerCase();
  if (/\s/.test(lower)) return undefined;
  let id = lower;
  let parsed = parseModelId(id);
  if (!parsed) {
    const at = lower.indexOf('claude-');
    if (at <= 0 || /[a-z0-9]/.test(lower[at - 1] ?? '')) return undefined;
    id = lower.slice(at);
    parsed = parseModelId(id);
  }
  const fastTrailer = parsed?.trailer !== undefined && /^[-@]\d{8}-fast$/.test(parsed.trailer);
  if (!parsed || (parsed.trailer !== undefined && !fastTrailer) || parsed.legacyVersionFirst) return undefined;
  if (!(FAMILIES as readonly string[]).includes(parsed.family)) return undefined;
  return {
    family: parsed.family,
    version: parsed.minor !== undefined ? `${parsed.major}.${parsed.minor}` : `${parsed.major}`,
    fast: fastTrailer || /-fast(?![a-z0-9])/.test(id.slice(id.lastIndexOf(parsed.base) + parsed.base.length)),
  };
}

// ---- Labels -----------------------------------------------------------------

/** `MM1` / `J55`. */
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** `XA0`: a codename is shown masked past its first three letters. */
function maskCodename(name: string): string {
  const shown = capitalize(name);
  const keep = name.length <= 3 ? 1 : 3;
  return shown.length <= keep ? shown : shown.slice(0, keep) + '*'.repeat(Math.max(0, name.length - keep));
}

/** `mj`: the family a model id or alias belongs to. */
export function modelFamily(id: string | undefined): string | undefined {
  return id ? FAMILIES.find((family) => id.includes(family)) : undefined;
}

/** `QA0`: a readable name for a raw model id ("Opus 5", "Sonnet 5 1M"). */
function labelForModelId(id: string): string {
  const oneM = /\[1m\]/i.test(id) ? '1M' : undefined;
  const known = describeModelId(id);
  if (known) return [`${capitalize(known.family)} ${known.version}`, known.fast ? 'Fast' : undefined, oneM].filter(Boolean).join(' ');
  const codename = id.match(CODENAME_ID);
  if (codename) {
    const [, name = '', version = '', tail = ''] = codename;
    const words = tail.split('-').filter((w) => w && w !== 'prod').map(capitalize).join(' ');
    return [`${maskCodename(name)} ${version}`, words || undefined, oneM].filter(Boolean).join(' ');
  }
  return PREVIOUS_MODEL_LABEL;
}

/** `H01`: "Opus", "Opus 5", "Opus 5 1M" name the `opus` family and nothing more. */
function isBareFamilyName(label: string, family: string): boolean {
  const words = label.split(/\s+/);
  return words[0]?.toLowerCase() === family && words.slice(1).every((w) => VERSION_WORD.test(w));
}

/** `kH`: the label for the model that actually served a turn. */
function servedModelLabel(served: string, rows: readonly ModelRow[]): string {
  const exact = rows.find((row) => row.value === served)?.displayName;
  if (exact !== undefined) return exact;
  const fromId = labelForModelId(served);
  const family = modelFamily(served);
  const familyRow = family ? rows.find((row) => row.value === family) : undefined;
  const familyName = familyRow?.displayName.trim();
  if (familyRow === undefined || !familyName) return fromId;
  if (fromId === PREVIOUS_MODEL_LABEL) return familyName;
  return isBareFamilyName(familyName, familyRow.value) ? fromId : familyName;
}

/**
 * `wC`: the selected row's name, unless the model that served the last turn is
 * a different family -- then that model, so the pill never claims Sonnet while
 * Opus is answering.
 */
export function selectedModelLabel(
  selection: string | undefined,
  lastServedModel: string | undefined,
  rows: readonly ModelRow[]
): string | undefined {
  const row = rows.find((r) => r.value === selection);
  const servedFamily = modelFamily(lastServedModel);
  const selectedFamily = modelFamily(selection);
  if (
    lastServedModel &&
    servedFamily &&
    !(row && selection !== 'default' && selectedFamily === undefined) &&
    servedFamily !== selectedFamily
  ) {
    return servedModelLabel(lastServedModel, rows);
  }
  return row?.displayName ?? (lastServedModel ? servedModelLabel(lastServedModel, rows) : undefined);
}

/** `OR`: "Opus 5", "Sonnet 5 Fast (1M)" from a model id, else the fallback. */
function formatModelId(id: string | undefined, fallback: string, opts: { oneMillion?: boolean } = {}): string {
  if (!id) return fallback;
  const oneM = opts.oneMillion || ONE_M_ID.test(id);
  const known = describeModelId(id.replace(ONE_M_ID, ''));
  if (!known) return fallback;
  return `${capitalize(known.family)} ${known.version}${known.fast ? ' Fast' : ''}${oneM ? ' (1M)' : ''}`;
}

/** `Qz0`: a row's family, from what it resolves to or else its own value. */
function rowFamily(row: ModelRow): string | undefined {
  return modelFamily(row.resolvedModel) ?? modelFamily(row.value);
}

/** `Zz0`. */
function isBareFamilyDisplayName(displayName: string, family: string): boolean {
  return isBareFamilyName(displayName.replace(ONE_M_LABEL, ''), family);
}

/** `Yz0`: a row whose display name says more than its family ("Opus Plan Mode"). */
function hasOwnDisplayName(row: ModelRow): boolean {
  const family = rowFamily(row);
  return family !== undefined && !isBareFamilyDisplayName(row.displayName, family);
}

/** `$z0`. */
const withoutOneMSuffix = (id: string) => id.replace(ONE_M_ID, '');

/** `Mo`: the pill text for a row -- its concrete model ("Sonnet 5"), not its alias. */
function rowPillLabel(row: ModelRow, lastServedModel: string | undefined): string {
  const family = rowFamily(row);
  if (row.value !== 'default' && (family === undefined || !isBareFamilyDisplayName(row.displayName, family))) {
    return row.displayName;
  }
  if (
    lastServedModel !== undefined &&
    family !== undefined &&
    modelFamily(lastServedModel) === family &&
    withoutOneMSuffix(lastServedModel) !== withoutOneMSuffix(row.resolvedModel ?? '')
  ) {
    return formatModelId(lastServedModel, row.displayName);
  }
  return formatModelId(row.resolvedModel, row.displayName, { oneMillion: ONE_M_LABEL.test(row.displayName) });
}

/**
 * The official footer's pill label (`d` in the footer component). `undefined`
 * means the pill falls back to "Model", as the official `HF1` does.
 */
export function modelPillLabel(
  rows: readonly ModelRow[],
  selection: string | undefined,
  lastServedModel: string | undefined
): string | undefined {
  const row = findModelRow(rows, selection);
  const label = selectedModelLabel(row?.value ?? selection, lastServedModel, rows);
  if (row !== undefined && row.value !== 'default' && hasOwnDisplayName(row)) return row.displayName;
  const labelled =
    label === undefined ? undefined : row?.displayName === label ? row : rows.find((r) => r.displayName === label);
  if (labelled) return rowPillLabel(labelled, lastServedModel);
  return label ?? (selection && rows.length > 0 ? formatModelId(selection, 'Model') : undefined);
}

/**
 * `V75`: a promo's list price is shown struck through just before the first
 * `$X/$Y per Mtok` in the description. Returned as parts so the template can
 * render the `<s>` without `v-html`.
 */
export function promoDescriptionParts(
  row: Pick<ModelRow, 'description' | 'promoListPrice'>
): { before: string; listPrice: string; price: string; after: string } | undefined {
  const { description, promoListPrice } = row;
  if (!promoListPrice) return undefined;
  const match = PRICE_PER_MTOK.exec(description);
  if (match === null || match.index === undefined) return undefined;
  return {
    before: description.slice(0, match.index),
    listPrice: promoListPrice,
    price: match[0],
    after: description.slice(match.index + match[0].length),
  };
}

/**
 * The official session records the model that served each top-level turn
 * (`lastServedModel`), skipping sub-agent turns and messages the CLI synthesised.
 */
export function servedModelOf(message: {
  type?: string;
  parent_tool_use_id?: string | null;
  message?: { model?: string };
}): string | undefined {
  if (message.type !== 'assistant' || message.parent_tool_use_id) return undefined;
  const model = message.message?.model;
  return model && model !== SYNTHETIC_MODEL ? model : undefined;
}
