import type { SelectionRange } from './Session';

/**
 * The IDE context block that rides along with a user message.
 *
 * A literal port of the official webview's `dR1`, which is one branch with two
 * arms:
 *
 * ```js
 * if (Z)
 *   if (Z.selectedText) z.push({type:"text", text:`<ide_selection>…`});
 *   else                z.push({type:"text", text:`<ide_opened_file>…`});
 * ```
 *
 * Forge shipped only the first arm. The consequence was not subtle: with a
 * plain cursor in a file and nothing highlighted, the model was told nothing at
 * all about the editor, so "what file am I seeing rn?" was answered with "I
 * don't have visibility into what file you're currently viewing" while the file
 * sat open beside the chat.
 *
 * Its own module rather than a private method on `Session`, so the wording can
 * be tested directly — this is a prompt, and a prompt whose text drifts is a
 * behaviour change that nothing else would catch.
 */
export function ideContextBlock(
  selection: SelectionRange | undefined,
): { type: 'text'; text: string } | undefined {
  if (!selection) return undefined;

  if (selection.selectedText) {
    return {
      type: 'text',
      text: `<ide_selection>The user selected the lines ${selection.startLine} to ${selection.endLine} from ${selection.filePath}:
${selection.selectedText}

This may or may not be related to the current task.</ide_selection>`,
    };
  }

  return {
    type: 'text',
    text: `<ide_opened_file>The user opened the file ${selection.filePath} in the IDE. This may or may not be related to the current task.</ide_opened_file>`,
  };
}
