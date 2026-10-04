/**
 * Pasted text, as the composer stores it: one kind of line break, no NULs.
 *
 * Windows clipboards carry `\r\n`; a pre-wrap editable paints the `\r` as an
 * extra break in some engines and not others, so the input and its mirror
 * disagreed about where each line ended.
 */
export function normalizePastedText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split(String.fromCharCode(0)).join('');
}

/**
 * The leading `/command` of a draft, when it names a command or skill that
 * exists: `{ lead, command }`, where `lead` is any whitespace before it.
 * Undefined otherwise, so a path like `/usr/bin` or a typo stays plain text.
 *
 * Asked for on 2026-10-03: "highlight the skill with color like its cmd in
 * terminal when exists when user typed it with /".
 */
export function leadingCommand(
  text: string,
  isKnown: (name: string) => boolean,
): { lead: string; command: string } | undefined {
  const match = /^(\s*)(\/([^\s/]+))(?=\s|$)/.exec(text);
  if (!match) return undefined;
  return isKnown(match[3]!) ? { lead: match[1]!, command: match[2]! } : undefined;
}
