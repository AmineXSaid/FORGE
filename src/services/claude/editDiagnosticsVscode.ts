/**
 * The VS Code side of `editDiagnostics.ts`: errors from the language servers.
 *
 * Kept apart so the diffing and wording can be tested without an editor. What
 * this file does cannot be exercised outside real VS Code -- when a language
 * server publishes, and whether it has a view of a file the CLI just changed
 * -- so it is kept to the two calls the API offers.
 */
import * as vscode from 'vscode';
import type { DiagnosticsSource, EditorDiagnostic } from './editDiagnostics';

/**
 * After the first change event, how long to keep waiting for a second one:
 * TypeScript publishes syntax errors first and type errors a moment later.
 */
const SECOND_PASS_MS = 400;

function codeOf(code: vscode.Diagnostic['code']): string | undefined {
  if (code === undefined) return undefined;
  return typeof code === 'object' ? String(code.value) : String(code);
}

export const vscodeDiagnostics: DiagnosticsSource = {
  errors(file) {
    const uri = vscode.Uri.file(file);
    // No open document and no diagnostics means the editor has no view of the
    // file, which is different from "no errors".
    const open = vscode.workspace.textDocuments.some((d) => d.uri.fsPath === uri.fsPath);
    const all = vscode.languages.getDiagnostics(uri);
    if (!open && !all.length) return undefined;
    return all
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
      .map((d): EditorDiagnostic => ({
        message: d.message,
        line: d.range.start.line,
        source: d.source,
        code: codeOf(d.code),
      }));
  },

  settle(file, ms) {
    const target = vscode.Uri.file(file).fsPath;
    return new Promise<void>((resolve) => {
      let second: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        sub.dispose();
        clearTimeout(timer);
        if (second) clearTimeout(second);
        resolve();
      };
      const sub = vscode.languages.onDidChangeDiagnostics((e) => {
        if (!e.uris.some((u) => u.fsPath === target)) return;
        if (second) {
          finish();
        } else {
          second = setTimeout(finish, SECOND_PASS_MS);
        }
      });
      const timer = setTimeout(finish, ms);
    });
  },
};
