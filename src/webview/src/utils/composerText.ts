/**
 * Pasted text, as the composer stores it: one kind of line break, no NULs.
 *
 * Windows clipboards carry `\r\n`; a pre-wrap editable paints the `\r` as an
 * extra break in some engines and not others, so the input and its mirror
 * disagreed about where each line ended.
 */
export function normalizePastedText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
}
