/**
 * Step 29: the output-style picker's pure parts.
 *
 * The official ships the *same* three checks on both sides of the wire -- the
 * webview's `FU0` / `AU0` / `DU0` (index.js @4906xxx) and the host's `If$` /
 * `Ef$` / `Cf$` (extension.js @2891336) are the same functions. The webview
 * copy is what greys out "Next" and paints the problem line; the host copy is
 * what actually refuses to write. Neither is allowed to be the only one:
 * `test/outputStyles.spec.ts` runs a table through both and asserts they agree,
 * so a change to one that is not made to the other fails the build.
 *
 * (The host's live in `src/services/claude/outputStyles.ts`, which imports `fs`
 * and `os`, so the webview cannot import it.)
 */

/** The official `cA0`, `lA0`, `dA0`. */
const NAME_SEPARATORS = /[\\/:*?"<>|]/;
// eslint-disable-next-line no-control-regex -- the official `lA0`, verbatim
const NAME_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export type OutputStyleNameProblem = 'empty' | 'characters' | 'taken' | null;

/** The official `FU0`. */
export function outputStyleNameProblem(name: string, existing?: readonly string[]): OutputStyleNameProblem {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'empty';
  if (
    NAME_SEPARATORS.test(trimmed) ||
    NAME_CONTROL_CHARS.test(trimmed) ||
    trimmed.startsWith('.') ||
    WINDOWS_DEVICE_NAMES.test(trimmed) ||
    trimmed.includes('---')
  ) {
    return 'characters';
  }
  const lower = trimmed.toLowerCase();
  if (existing?.some((style) => style.toLowerCase() === lower)) return 'taken';
  return null;
}

/** The official `AU0`. */
export function outputStyleDescriptionProblem(description: string): 'fence' | null {
  return description.includes('---') ? 'fence' : null;
}

/** The official `DU0`. */
export function outputStyleFileName(name: string): string {
  return `${name.trim()}.md`;
}

/**
 * The official `$85`: a style name comes off disk, so it is rendered with every
 * invisible or ambiguous code point spelled out (`\u{200b}`), and runs of
 * spaces made visible. A file called "Concise\u{202e}" cannot repaint the row.
 */
export function outputStyleLabel(name: string): string {
  return name
    .replace(
      /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\u2800]/gu,
      (ch) => `\\u{${ch.codePointAt(0)?.toString(16) ?? '?'}}`
    )
    .replace(/^ +| +$| {2,}/g, (run) => '\\u{20}'.repeat(run.length));
}

/** The official `f6`, the wizard's copy, verbatim. */
export const OUTPUT_STYLE_COPY = {
  title: 'Build a custom style',
  step: (current: number, total: number) => `Step ${current} of ${total}`,
  back: 'Back',
  next: 'Next',
  saveButton: 'Save',
  replace: 'Replace',
  done: 'Done',
  name: {
    label: 'Name',
    placeholder: 'Diagrams first',
    help: 'Shows in the Output styles menu and becomes the file name',
    problems: {
      empty: 'Enter a name',
      taken: (name: string) => `${name} is already a style name. Choose another.`,
      characters: `A name can't contain / \\ : * ? " < > | or ---`,
    },
  },
  description: {
    label: 'Description',
    placeholder: 'Lead every explanation with a diagram',
    help: 'Optional. One line about what the style does',
    fence: "A description can't contain ---",
  },
  instructions: {
    label: 'Instructions',
    placeholder:
      'When explaining code, architecture, or data flow, start with a diagram, then explain in prose.',
    help: "Added to Forge's system prompt whenever this style is active",
    empty: 'Enter the instructions',
    keepCodingInstructions: 'Include the coding instructions',
    keepCodingInstructionsHelp:
      'Keeps the default coding instructions alongside your style. Turn off for styles that are not about writing code.',
  },
  save: {
    label: 'Save to',
    project: { label: 'Project', help: 'This project only' },
    user: { label: 'User', help: 'All your projects' },
    switchNow: 'Switch to this style now',
    exists: (fileName: string) => `A style file named ${fileName} already exists here.`,
    failed: (message: string) => `Couldn't save the style. ${message}`,
    savedWithoutReload: 'Saved. The style will appear in the Output styles menu in new sessions.',
  },
} as const;

/** The official `lo`: the wizard's steps, in order. */
export const OUTPUT_STYLE_STEPS = ['name', 'description', 'instructions', 'save'] as const;

export type OutputStyleStep = (typeof OUTPUT_STYLE_STEPS)[number];
