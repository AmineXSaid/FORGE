/**
 * The files a Forge webview is drawn from, and what the panel shows when they
 * cannot be read.
 *
 * Found on Windows (2026-09-25): after an install, the side bar and the editor
 * tab both stayed blank. VS Code logged "Webview.loadLocalResource - Error using
 * fileReader" for `dist/media/main.js` and `dist/media/style.css`. The extension
 * code was running from `msaid.forge-0.1.0`, but those two files could not be
 * read from that folder. The VSIX had them, so the installed folder no longer
 * matched the package. A blank panel explains nothing. The failure is now
 * reported in two places:
 *
 * - the host checks the files before it builds the page, and renders
 *   `assetsMissingHtml` instead when they are gone;
 * - the page itself reports a script or stylesheet that fails to load after it
 *   was built (`WEBVIEW_LOAD_GUARD`), in the official `#claude-error` sentinel.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Relative to the extension folder: the webview's entry script and its stylesheet. */
export const WEBVIEW_ASSETS = ['dist/media/main.js', 'dist/media/style.css'] as const;

/** The assets that are not on disk, as absolute paths. */
export function missingWebviewAssets(
	extensionPath: string,
	exists: (file: string) => boolean = fs.existsSync
): string[] {
	return WEBVIEW_ASSETS.map((asset) => path.join(extensionPath, ...asset.split('/'))).filter(
		(file) => !exists(file)
	);
}

/** The official `Wb`: text made safe for an element body or a quoted attribute. */
export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** What to do about it, shared by the host's page and the in-page guard. */
export const REINSTALL_ADVICE =
	'Close every VS Code window, delete the extension folder, then install the Forge VSIX again.';

/**
 * The page a panel shows when the host finds its assets missing.
 *
 * No script at all (`default-src 'none'`, inline styles only). No font or
 * colour is named either: the page inherits VS Code's webview defaults, since
 * Forge's own fonts sit in the same `dist/media` that is missing.
 */
export function assetsMissingHtml(extensionPath: string, missing: readonly string[]): string {
	const files = missing.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('');
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Forge</title>
    <style>
      body { padding: 12px 16px; line-height: 1.5; }
      h1 { font-size: 1.15em; margin: 0 0 8px; }
      code { word-break: break-all; }
      ol, ul { padding-left: 20px; }
    </style>
</head>
<body>
    <h1>Forge could not load its interface</h1>
    <p>Forge is running, but the files that draw this panel are missing from the installed extension:</p>
    <ul>${files}</ul>
    <p>This happens when an install is interrupted, or when a reinstall of the same version reuses a damaged folder.</p>
    <ol>
      <li>Close every VS Code window.</li>
      <li>Delete the folder <code>${escapeHtml(extensionPath)}</code></li>
      <li>Install the Forge VSIX again, then open VS Code.</li>
    </ol>
</body>
</html>`;
}

/**
 * The official sentinel's style, verbatim from `extension.js`. An empty `<pre>`
 * keeps a 1px box with no margin and no opacity, and the body's flex layout,
 * copied from the official, is unchanged.
 */
export const ERROR_SENTINEL_STYLE = `
      #claude-error {
        max-height: 30vh;
        overflow: auto;
      }
      #claude-error:empty {
        min-width: 1px;
        min-height: 1px;
        opacity: 0;
        margin: 0;
        overflow: hidden;
      }`;

/**
 * Runs first, in `<head>`, before the stylesheet link, so even a 404 that
 * comes back at once is caught. It reports the app's module script or the
 * stylesheet failing to load.
 *
 * Resource errors do not bubble, so it listens in the capture phase, and only
 * for the two elements marked `data-forge-asset`. A lazy chunk that fails later
 * does not blank the page, so it is left alone. An error thrown before the app
 * has mounted is reported too. After that, `#app` has content and the app
 * reports its own errors. An error that arrives before `<body>` is parsed is
 * held until the sentinel exists.
 */
export const WEBVIEW_LOAD_GUARD = `(function () {
      var pending = '';
      function show(text) {
        var sentinel = document.getElementById('claude-error');
        if (!sentinel) { pending = pending || text; return; }
        if (!sentinel.textContent) sentinel.textContent = text;
      }
      document.addEventListener('DOMContentLoaded', function () { if (pending) show(pending); });
      window.addEventListener('error', function (event) {
        var target = event.target;
        if (target && target.hasAttribute && target.hasAttribute('data-forge-asset')) {
          var url = target.getAttribute('src') || target.getAttribute('href') || '';
          try { url = decodeURIComponent(url); } catch (e) {}
          show('Forge could not load its interface: ' + url + ' did not load.\\n' +
            'The file is missing or unreadable in the installed extension. ' + ${JSON.stringify(REINSTALL_ADVICE)});
          return;
        }
        var app = document.getElementById('app');
        if (!app || app.childElementCount === 0) {
          var error = event.error;
          show(error && error.stack ? String(error.stack) : String(event.message));
        }
      }, true);
    })();`;
