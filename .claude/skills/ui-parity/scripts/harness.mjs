#!/usr/bin/env node
/**
 * Boot Forge's real built webview with a stubbed extension host.
 *
 * This serves `dist/media` plus a stub that answers the init handshake, so what
 * gets measured is the shipping bundle -- Vue scoped styles and all. A
 * hand-written mock page cannot be trusted for parity work: scoped styles never
 * apply to it, so it reports a UI that does not exist.
 *
 * Usage: node harness.mjs [--port 8733] [--root <forge-root>]
 */
import { createServer } from 'node:http';
import { readFile, cp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

const PORT = Number(argOf('--port', 8733));
const ROOT = argOf('--root', join(HERE, '..', '..', '..', '..'));
const DIST = join(ROOT, 'dist', 'media');
const SERVE = join(HERE, '..', '.harness');
const OFFICIAL_CSS = argOf('--ref', join(ROOT, '..', 'Real_Claude_Code_VSCODE_extension_files', 'webview', 'index.css'));

if (!existsSync(DIST)) {
  console.error(`harness: no build at ${DIST}\nRun \`pnpm run build\` first.`);
  process.exit(1);
}

await mkdir(SERVE, { recursive: true });
await cp(DIST, SERVE, { recursive: true });
await cp(join(HERE, '..', 'harness'), SERVE, { recursive: true });

// The stub host's index.html replaces the build's, which expects the extension.
await writeFile(join(SERVE, 'index.html'), await readFile(join(HERE, '..', 'harness', 'index.html')));

// Oracle inputs for probe-oracle.js: the official stylesheet, the reference
// class map, and Forge's module-name -> official-hash table (read out of the
// port script, which is the single source of truth for that mapping).
await mkdir(join(SERVE, 'oracle'), { recursive: true });
if (existsSync(OFFICIAL_CSS)) {
  await cp(OFFICIAL_CSS, join(SERVE, 'oracle', 'official.css'));
} else {
  console.warn(`harness: official stylesheet not found at ${OFFICIAL_CSS}; probe-oracle.js will not run.`);
}
const referenceJson = join(HERE, '..', 'reference.json');
if (existsSync(referenceJson)) await cp(referenceJson, join(SERVE, 'oracle', 'reference.json'));
const portScript = await readFile(join(ROOT, 'scripts', 'port-official-css.mjs'), 'utf8');
const moduleMap = Object.fromEntries(
  [...portScript.matchAll(/^\s*([a-z]+):\s*\{\s*hash:\s*'([-A-Za-z0-9_]{6})'/gm)].map((m) => [m[1], m[2]])
);
await writeFile(join(SERVE, 'oracle', 'modules.json'), JSON.stringify(moduleMap, null, 2));

// The plan preview (step 17) is not in index.css: the official host builds its
// page from an inline template (`zd$`) in extension.js, next to the webview
// folder. Serve that template so probe-planpreview.js can render it beside
// Forge's page.
const OFFICIAL_EXTENSION = join(dirname(dirname(OFFICIAL_CSS)), 'extension.js');
if (existsSync(OFFICIAL_EXTENSION)) {
  const bundle = await readFile(OFFICIAL_EXTENSION, 'utf8');
  // `var zd$=`<!DOCTYPE html>...` in 2.1.270; the name is minified, the opening is not.
  const start = bundle.indexOf('var zd$=`<!DOCTYPE html>');
  if (start !== -1) {
    const at = start + 'var zd$=`'.length;
    const end = bundle.indexOf('</html>', at);
    // The template is a JS template literal: undo its escapes (`\\` -> `\`).
    const template = bundle.slice(at, end + '</html>'.length).replace(/\\\\/g, '\\');
    await writeFile(join(SERVE, 'oracle', 'plan-preview.html'), template);
  }
}

// Probes are served too, so the browser can run one without pasting it:
//   eval(await (await fetch('/probes/probe-oracle.js')).text())
await mkdir(join(SERVE, 'probes'), { recursive: true });
for (const name of await readdir(HERE)) {
  if (name.startsWith('probe-') && name.endsWith('.js')) await cp(join(HERE, name), join(SERVE, 'probes', name));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(SERVE, path === '/' ? '/index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      // No caching: a stale bundle silently invalidates every measurement.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`harness: http://127.0.0.1:${PORT}/index.html`);
  console.log('Wait ~3s after load, then confirm the stylesheet parsed:');
  console.log("  [...document.styleSheets].map(s => { try { return s.cssRules.length } catch { return 'ERR' } })");
});
