#!/usr/bin/env node
/**
 * Every surface and every row, clicked in the harness, with what each sent.
 *
 * Production audit, Phase 3. It drives the real built webview against the stub
 * host (`harness.mjs`) through headless Chrome (`cdp-driver.mjs`), with real
 * mouse and key input, and writes one table:
 *
 *   surface | row | request(s) sent | host answer | UI effect | verdict
 *
 * A row passes when it sent what it should (read from `__forgeSent`), the stub
 * answered it with a real handler (never the empty fallback, `__forgeFallbacks`)
 * and the page did what the row says. Each window is also measured with
 * `probe-oracle.js`; its structural rows are compared with the stored baseline
 * (`../baselines/oracle.json`, written with `--write-baseline`), so a new
 * structural difference fails the run.
 *
 *   node .claude/skills/ui-parity/scripts/harness.mjs --port 8771 &
 *   node .claude/skills/ui-parity/scripts/drive-all.mjs --port 8771 [--out <file.md>] [--write-baseline]
 *
 * It proves the webview <-> host contract, not the CLI: nothing here reaches a
 * real Claude Code process.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, ORACLE } from './cdp-driver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argOf = (flag, fallback) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback);
const PORT = argOf('--port', '8771');
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const OUT = argOf('--out', undefined);
const BASELINE_FILE = join(HERE, '..', 'baselines', 'oracle.json');
const WRITE_BASELINE = process.argv.includes('--write-baseline');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
const oracleRuns = [];
const problems = [];

function record(surface, row, fields) {
  const entry = { surface, row, sent: '', answer: '', effect: '', verdict: 'FAIL', ...fields };
  rows.push(entry);
  console.log(`${entry.verdict.padEnd(10)} ${surface} | ${row} | ${entry.sent} | ${entry.effect}`);
}

// ------------------------------------------------------------------ page ---

const page = await launch({ width: 800, height: 1000 });

async function boot(query, settleMs = 3000) {
  await page.navigate(`${BASE}?${query}`, 400);
  await page.eval(`localStorage.clear(); return true`);
  await page.navigate(`${BASE}?${query}`, settleMs);
  const sheets = await page.eval(`return [...document.styleSheets].map(s => { try { return s.cssRules.length } catch { return 'ERR' } })`);
  if (!Array.isArray(sheets) || !sheets.some((n) => typeof n === 'number' && n > 100)) {
    throw new Error(`stylesheets not parsed on ?${query}: ${JSON.stringify(sheets)}`);
  }
  await page.eval(`
    window.__driveFileInputClicks = 0;
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__driveFileInputClicks++; return; } return click.call(this); };
    window.__driveErrors = [];
    window.addEventListener('error', (e) => window.__driveErrors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__driveErrors.push(String(e.reason?.message ?? e.reason)));
    return true`);
}

const mark = () => page.eval(`return { sent: window.__forgeSent.length, fallbacks: window.__forgeFallbacks.length }`);

/** What was sent since the mark: request types, and top-level messages by type. */
async function since(m) {
  return page.eval(`
    const sent = window.__forgeSent.slice(${m.sent});
    return {
      requests: sent.filter(x => x.type === 'request').map(x => x.request),
      messages: sent.filter(x => x.type !== 'request').map(x => x.type === 'response' ? 'response:' + (x.response?.type ?? '') : x.type),
      fallbacks: window.__forgeFallbacks.slice(${m.fallbacks}),
      errors: window.__driveErrors.slice(),
    }`);
}

const describeSent = (s) =>
  [...s.requests.map((r) => r.type + (r.tab ? `{tab:${r.tab}}` : r.mode ? `{mode:${r.mode}}` : '')), ...s.messages].join(', ') || '(none)';

/** Centre of the first element matching `selector` whose text starts with `text`. */
async function centre(selector, text) {
  return page.eval(`
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter(e => ${text === undefined ? 'true' : `e.textContent.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(text)})`})
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!els.length) return null;
    // A row below a menu's scrolled viewport is laid out but not hittable.
    els[0].scrollIntoView({ block: 'nearest' });
    const r = els[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
}

async function clickOn(selector, text) {
  const at = await centre(selector, text);
  if (!at) return false;
  await page.click(at.x, at.y);
  return true;
}

const exists = (selector) => page.eval(`return !!document.querySelector(${JSON.stringify(selector)})`);
const escape = () => page.key('Escape', 'Escape', 27);

async function oracle(window, root, prep) {
  if (prep) await prep();
  await page.hover(2, 2);
  const result = await page.eval(ORACLE(root));
  oracleRuns.push({ window, root, ...result });
  return result;
}

// ------------------------------------------------------------ chat: "/" ---

const CHAT = 'mockSessions&endpoints=2&health=mixed';

/** Each "/" row: what it must send (request type and fields), or the DOM it must produce. */
const SLASH_ROWS = [
  { label: 'Attach file…', check: async () => ({ ok: (await page.eval(`return window.__driveFileInputClicks`)) === 1, effect: 'file chooser opened' }) },
  { label: 'Mention file from this project…', check: async () => ({ ok: await page.eval(`return (document.querySelector('.fg-composer__messageInput')?.textContent ?? '').includes('@')`), effect: '"@" inserted in the composer' }) },
  { label: 'Rewind', check: async () => ({ ok: await exists('[class*="fg-rewind__"]'), effect: 'rewind picker open' }), after: escape },
  { label: 'Clear conversation', check: async () => ({ ok: await exists('.fg-chat__emptyState'), effect: 'empty state (in place)' }), noNewTab: true },
  { label: 'Switch model…', check: async () => ({ ok: await exists('.fg-modelmenu__listbox'), effect: 'model menu open' }), after: escape },
  { label: 'Effort', optional: true, request: 'apply_settings', keepOpen: true },
  { label: 'Thinking', request: 'set_thinking_level', keepOpen: true },
  { label: 'Toggle fast mode', optional: true, request: 'open_claude_in_terminal' },
  { label: 'Output styles', request: 'get_output_style', check: async () => ({ ok: await exists('[class*="fg-stylewizard__"], [class*="fg-outputstyle__"]'), effect: 'output style picker open' }), after: escape },
  { label: 'MCP servers', request: 'open_forge_settings', field: ['tab', 'mcp-servers'] },
  { label: 'Hooks', request: 'open_forge_settings', field: ['tab', 'hooks'] },
  { label: 'Permissions', request: 'list_permission_rules', check: async () => ({ ok: await exists('[class*="fg-permissionrules__"]'), effect: 'permission rules dialog open' }), after: escape },
  { label: 'Endpoints', request: 'open_forge_settings', field: ['tab', 'endpoints'] },
  { label: 'Slash commands', request: 'open_forge_settings', field: ['tab', 'slash-commands'] },
  { label: 'Manage plugins', request: 'open_forge_settings', field: ['tab', 'plugins'] },
  { label: 'Open Forge in Terminal', request: 'open_claude_in_terminal', field: ['location', 'bottom'] },
  { label: 'Focus view', request: 'set_focus_view', keepOpen: true },
  { label: 'General config…', request: 'open_config' },
  { label: 'View help docs', request: 'open_help' },
];

async function openSlashMenu() {
  if (await exists('.fg-commandmenu__menuPopup')) return true;
  return clickOn('.fg-footer__menuButton');
}

async function driveSlashMenu() {
  await boot(CHAT);
  const channel = await page.eval(`return window.__forgeChannelId()`);
  await page.eval(`window.__forgeSeedTranscript(${JSON.stringify(channel)}); return true`);
  await sleep(500);
  await openSlashMenu();
  const shown = await page.eval(`return [...document.querySelectorAll('.fg-commandmenu__commandItem .fg-commandmenu__commandLabel')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())`);
  const sections = await page.eval(`return [...document.querySelectorAll('.fg-commandmenu__sectionHeader')].map(e => e.textContent.trim())`);
  record('"/" menu', 'rows and sections', {
    sent: '—',
    effect: `${shown.length} rows; sections ${sections.join(', ')}`,
    verdict: shown.length >= 15 ? 'PASS' : 'FAIL',
  });
  oracleRuns.push({ window: '"/" menu (open)', root: '.fg-commandmenu__menuPopup', ...(await page.eval(ORACLE('.fg-commandmenu__menuPopup'))) });
  await escape();

  for (const spec of SLASH_ROWS) {
    if (spec.label === 'Clear conversation') {
      await page.eval(`window.__forgeSeedTranscript(window.__forgeChannelId()); return true`);
      await sleep(300);
    }
    await openSlashMenu();
    const present = await centre('.fg-commandmenu__commandItem', spec.label);
    if (!present) {
      record('"/" menu', spec.label, { verdict: spec.optional ? 'LEFT OUT' : 'FAIL', effect: spec.optional ? 'not registered for this model (as the official)' : 'row missing' });
      await escape();
      continue;
    }
    const m = await mark();
    await page.click(present.x, present.y);
    await sleep(500);
    const s = await since(m);
    const menuOpen = await exists('.fg-commandmenu__menuPopup');
    let ok = true;
    const notes = [];
    if (spec.request) {
      const hit = s.requests.find((r) => r.type === spec.request);
      ok &&= !!hit;
      if (hit && spec.field) ok &&= hit[spec.field[0]] === spec.field[1];
    }
    if (spec.check) {
      const c = await spec.check();
      ok &&= c.ok;
      notes.push(c.effect);
    }
    if (spec.keepOpen !== undefined) {
      ok &&= menuOpen === spec.keepOpen;
      notes.push(menuOpen ? 'menu stays open' : 'menu closes');
    } else {
      notes.push(menuOpen ? 'menu stays open' : 'menu closes');
    }
    if (spec.noNewTab) {
      const tabs = await page.eval(`return window.__forgeNewTabs.length`);
      ok &&= tabs === 0;
    }
    ok &&= s.fallbacks.length === 0;
    record('"/" menu', spec.label, {
      sent: describeSent(s),
      answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
      effect: notes.filter(Boolean).join('; '),
      verdict: ok ? 'PASS' : 'FAIL',
    });
    if (menuOpen) await escape();
    if (spec.after) await spec.after();
    await sleep(200);
  }

  // Filter-only rows: offered only while typing.
  for (const [label, filter, check] of [
    ['New conversation', 'new con', async () => ({ ok: (await exists('.fg-chat__emptyState')) && (await page.eval(`return window.__forgeNewTabs.length`)) === 0, effect: 'side bar: starts over in place, no new tab' })],
    ['Resume conversation', 'resume', async () => ({ ok: await exists('.fg-sessionsdropdown__dropdown'), effect: 'past conversations dropdown open' })],
  ]) {
    await page.eval(`window.__forgeSeedTranscript(window.__forgeChannelId()); return true`);
    await sleep(300);
    await openSlashMenu();
    const unfiltered = await centre('.fg-commandmenu__commandItem', label);
    await page.type(filter);
    const at = await centre('.fg-commandmenu__commandItem', label);
    if (!at) {
      record('"/" menu', `${label} (filter only)`, { effect: 'not offered while filtering' });
      await escape();
      continue;
    }
    const m = await mark();
    await page.click(at.x, at.y);
    await sleep(600);
    const s = await since(m);
    const c = await check();
    record('"/" menu', `${label} (filter only)`, {
      sent: describeSent(s),
      answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
      effect: `${c.effect}; hidden until typed: ${unfiltered ? 'no' : 'yes'}`,
      verdict: c.ok && !unfiltered && s.fallbacks.length === 0 ? 'PASS' : 'FAIL',
    });
    if (await exists('.fg-sessionsdropdown__dropdown')) await escape();
  }

  // The CLI's own slash commands: a "Slash Commands" section while filtering.
  await openSlashMenu();
  await page.type('/');
  const cliRows = await page.eval(`
    const headers = [...document.querySelectorAll('.fg-commandmenu__sectionHeader')].map(e => e.textContent.trim());
    return { headers, rows: [...document.querySelectorAll('.fg-commandmenu__commandItem .fg-commandmenu__commandLabel')].map(e => e.textContent.trim()).slice(0, 40) }`);
  const cliRow = cliRows.rows.find((r) => r.startsWith('/'));
  if (cliRow) {
    const at = await centre('.fg-commandmenu__commandItem', cliRow);
    const m = await mark();
    await page.click(at.x, at.y);
    await sleep(500);
    const s = await since(m);
    const composer = await page.eval(`return (document.querySelector('.fg-composer__messageInput')?.textContent ?? '').trim()`);
    const sentCommand = s.messages.includes('io_message');
    record('"/" menu', `CLI command ${cliRow}`, {
      sent: describeSent(s),
      effect: sentCommand ? 'sent as a message' : `inserted: "${composer}"`,
      verdict: sentCommand || composer.startsWith(cliRow.split(' ')[0]) ? 'PASS' : 'FAIL',
    });
  } else {
    record('"/" menu', 'CLI slash commands', { effect: `none listed (sections: ${cliRows.headers.join(', ')})`, verdict: 'FAIL' });
  }
  if (await exists('.fg-commandmenu__menuPopup')) await escape();
}

// ------------------------------------------------------------ chat: "+" ---

async function driveAddMenu() {
  const rowsSeen = [];
  for (const [label, check] of [
    ['Upload from computer', async () => ({ ok: (await page.eval(`return window.__driveFileInputClicks`)) >= 1, effect: 'file chooser opened' })],
    ['Add context', async () => ({ ok: await page.eval(`return (document.querySelector('.fg-composer__messageInput')?.textContent ?? '').includes('@')`), effect: '"@" inserted' })],
    ['Browse the web', async () => ({ ok: await page.eval(`return (document.querySelector('.fg-composer__messageInput')?.textContent ?? '').includes('@browser:')`), effect: '"@browser:" inserted' })],
  ]) {
    // A fresh page per row: the previous row's "@" leaves a completion list open.
    await boot(CHAT);
    await clickOn('.fg-addmenu__addButton');
    await sleep(200);
    if (!rowsSeen.length) {
      rowsSeen.push(...(await page.eval(`return [...document.querySelectorAll('.fg-addmenu__menuItemLabel')].map(e => e.textContent.trim())`)));
      oracleRuns.push({ window: '"+" menu', root: '.fg-addmenu__menuPopup', ...(await page.eval(ORACLE('.fg-addmenu__menuPopup'))) });
    }
    const at = await centre('.fg-addmenu__menuItem', label);
    if (!at) {
      record('"+" menu', label, { effect: 'row missing' });
      await escape();
      continue;
    }
    const m = await mark();
    await page.click(at.x, at.y);
    await sleep(500);
    const s = await since(m);
    const c = await check();
    record('"+" menu', label, {
      sent: describeSent(s),
      answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
      effect: c.effect + ((await exists('.fg-addmenu__menuPopup')) ? '; menu stays open' : '; menu closes'),
      verdict: c.ok && !s.fallbacks.length ? 'PASS' : 'FAIL',
    });
    if (await exists('.fg-addmenu__menuPopup')) await escape();
  }
  record('"+" menu', 'rows', { sent: '—', effect: rowsSeen.join(' / '), verdict: rowsSeen.length === 3 ? 'PASS' : 'FAIL' });

  await boot(`${CHAT}&noBrowser`);
  await clickOn('.fg-addmenu__addButton');
  await sleep(200);
  const noBrowserRows = await page.eval(`return [...document.querySelectorAll('.fg-addmenu__menuItemLabel')].map(e => e.textContent.trim())`);
  record('"+" menu', 'Browse the web without browser support', {
    sent: '—',
    effect: noBrowserRows.join(' / '),
    verdict: !noBrowserRows.includes('Browse the web') ? 'PASS' : 'FAIL',
  });
}

// ------------------------------------------------------ chat: mode, model ---

async function driveModeMenu() {
  await boot(CHAT);
  const trigger = '.fg-menu__container button[title*="Shift+Tab"]';
  await clickOn(trigger);
  await sleep(200);
  const labels = await page.eval(`return [...document.querySelectorAll('.fg-menu__menuItemV2 .fg-menu__menuItemLabel')].map(e => e.textContent.trim())`);
  oracleRuns.push({ window: 'mode menu', root: '.fg-menu__menuPopup', ...(await page.eval(ORACLE('.fg-menu__menuPopup'))) });
  record('mode menu', 'rows', { sent: '—', effect: labels.join(' / '), verdict: labels.length >= 3 ? 'PASS' : 'FAIL' });
  await escape();
  for (const label of labels) {
    await clickOn(trigger);
    await sleep(200);
    const at = await centre('.fg-menu__menuItemV2', label);
    const m = await mark();
    await page.click(at.x, at.y);
    await sleep(500);
    const s = await since(m);
    const set = s.requests.find((r) => r.type === 'set_permission_mode' || r.type === 'enable_bypass_permissions' || r.type === 'set_expert_mode');
    const shown = await page.eval(`return document.querySelector(${JSON.stringify(trigger)})?.textContent.trim()`);
    // Expert (Forge-only, Phase 6): the plugin's style on through the flag layer.
    const expertOk = label !== 'Expert' || s.requests.some((r) => r.type === 'set_expert_mode' && r.enabled === true);
    record('mode menu', label, {
      sent: describeSent(s),
      answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
      effect: `footer shows "${shown}"`,
      verdict: (set || shown === label) && shown === label && expertOk && !s.fallbacks.length ? 'PASS' : 'FAIL',
    });
    if (await exists('.fg-menu__menuPopup')) await escape();
  }

  // Shift+Tab walks the rows in menu order and wraps to Expert.
  {
    const seen = [];
    await clickOn('.fg-composer__messageInput');
    for (let i = 0; i < labels.length; i++) {
      await page.key('Tab', 'Tab', 9, 8);
      await sleep(400);
      seen.push(await page.eval(`return document.querySelector(${JSON.stringify(trigger)})?.textContent.trim()`));
    }
    const start = labels.indexOf(seen.at(-1));
    record('mode menu', 'Shift+Tab cycle', {
      sent: '—',
      effect: seen.join(' → '),
      verdict: seen.includes('Expert') && seen.length === labels.length && new Set(seen).size === labels.length && start >= 0 ? 'PASS' : 'FAIL',
    });
  }
}

async function driveModelMenu() {
  await boot(CHAT);
  await clickOn('.fg-footer__modelPill');
  await sleep(300);
  const labels = await page.eval(`return [...document.querySelectorAll('.fg-modelmenu__listbox [role="option"] .fg-modelmenu__modelLabel, .fg-modelmenu__listbox .fg-modelmenu__modelLabel')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())`);
  const unique = [...new Set(labels)];
  oracleRuns.push({
    window: 'model menu (chips set aside)',
    root: '.fg-commandmenu__menuPopup',
    ...(await page.eval(`document.querySelectorAll('.forge-model-chips').forEach(e => e.style.display = 'none'); ${ORACLE('.fg-commandmenu__menuPopup')}`)),
  });
  record('model menu', 'rows', { sent: '—', effect: `${unique.length} pairs: ${unique.slice(0, 4).join(' / ')}${unique.length > 4 ? ' / …' : ''}`, verdict: unique.length > 0 ? 'PASS' : 'FAIL' });
  await escape();
  for (const label of unique.slice(0, 3)) {
    await clickOn('.fg-footer__modelPill');
    await sleep(300);
    const at = await centre('.fg-modelmenu__modelLabel', label);
    if (!at) continue;
    const m = await mark();
    await page.click(at.x, at.y);
    await sleep(500);
    const s = await since(m);
    const pill = await page.eval(`return document.querySelector('.fg-footer__modelPillLabel')?.textContent.trim()`);
    const setModel = s.requests.find((r) => r.type === 'set_model');
    record('model menu', label, {
      sent: describeSent(s),
      answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
      effect: `pill shows "${pill}"`,
      verdict: setModel && !s.fallbacks.length ? 'PASS' : 'FAIL',
    });
    if (await exists('.fg-commandmenu__menuPopup')) await escape();
  }
}

/** "Toggle fast mode" exists only for a model that supports it (the official `fastModeRows`). */
async function driveFastMode() {
  await boot(CHAT);
  await clickOn('.fg-footer__modelPill');
  await sleep(300);
  const fastModel = await page.eval(`
    const row = [...document.querySelectorAll('.fg-modelmenu__modelLabel')].find(e => /Fast/.test(e.textContent));
    return row ? row.textContent.replace(/(Max|Ultracode|Fast)/g, '').trim() : null`);
  if (!fastModel) {
    record('"/" menu', 'Toggle fast mode', { verdict: 'LEFT OUT', effect: 'no model in the stub supports fast mode' });
    await escape();
    return;
  }
  await clickOn('.fg-modelmenu__modelLabel', fastModel);
  await sleep(500);
  await openSlashMenu();
  const at = await centre('.fg-commandmenu__commandItem', 'Toggle fast mode');
  if (!at) {
    record('"/" menu', `Toggle fast mode (${fastModel})`, { effect: 'row missing for a fast-capable model' });
    await escape();
    return;
  }
  const m = await mark();
  await page.click(at.x, at.y);
  await sleep(500);
  const s = await since(m);
  const launch = s.requests.find((r) => r.type === 'open_claude_in_terminal');
  record('"/" menu', `Toggle fast mode (${fastModel})`, {
    sent: describeSent(s),
    answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
    effect: launch ? `claude ${launch.prompt ?? ''} in the ${launch.location ?? 'default'} terminal` : '',
    verdict: launch && !s.fallbacks.length ? 'PASS' : 'FAIL',
  });
}

// ------------------------------------------------------------- coverage ---

/** `probe-coverage.js`: official classes this state never renders (informational). */
async function coverage(state) {
  const r = await page.eval(`return eval(${JSON.stringify(readFileSync(join(HERE, 'probe-coverage.js'), 'utf8'))})`);
  coverageRuns.push({ state, present: r.present ?? null, missing: r.missing ?? null, error: r.error });
}
const coverageRuns = [];

async function driveCoverage() {
  await boot(CHAT);
  await page.eval(`window.__forgeSeedTranscript(window.__forgeChannelId()); window.__forgeSeedToolTranscript?.(window.__forgeChannelId()); return true`);
  await sleep(800);
  await coverage('chat with a transcript');
  await openSlashMenu();
  await coverage('"/" menu open');
  await escape();
  await page.eval(`window.__forgeSeedPermission({}); return true`);
  await sleep(500);
  await coverage('permission prompt up');
}

// --------------------------------------------------- chat: sessions dropdown ---

async function driveSessionsDropdown() {
  await boot(CHAT);
  await clickOn('button[aria-label="Session history"]');
  await sleep(600);
  const names = await page.eval(`return [...document.querySelectorAll('.fg-sessions__sessionItem .fg-sessions__sessionName')].map(e => e.textContent.trim())`);
  oracleRuns.push({ window: 'sessions dropdown', root: '.fg-sessionsdropdown__dropdown', ...(await page.eval(ORACLE('.fg-sessionsdropdown__dropdown'))) });
  record('sessions dropdown', 'list', { sent: 'list_sessions_request', effect: `${names.length} conversations`, verdict: names.length >= 2 ? 'PASS' : 'FAIL' });

  // Search, by title and by git branch.
  // "docs/tidy" is Session B's git branch and in no title, so only a branch
  // search can find it (step 23).
  for (const [query, expect] of [['tidy', 'Session B'], ['docs/tidy', 'Session B']]) {
    await page.eval(`const i = document.querySelector('.fg-sessions__searchBox input, input.fg-sessions__searchBox, .fg-sessions__searchRow input'); i.focus(); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true`);
    await page.type(query);
    await sleep(400);
    const shown = await page.eval(`return [...document.querySelectorAll('.fg-sessions__sessionItem .fg-sessions__sessionName')].map(e => e.textContent.trim())`);
    record('sessions dropdown', `search "${query}"`, { sent: '—', effect: shown.join(' / ') || '(none)', verdict: shown.length >= 1 && shown.every((n) => n.includes(expect)) ? 'PASS' : 'FAIL' });
  }
  await page.eval(`const i = document.querySelector('.fg-sessions__searchBox input, input.fg-sessions__searchBox, .fg-sessions__searchRow input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true`);
  await sleep(300);

  // Row actions: hover to reveal, then click by title. QW0 passes no status
  // feeds, so there is no dot and no "Mark as unread" here (Phase 6); both
  // live in the session manager.
  {
    const unread = await page.eval(`return [...document.querySelectorAll('.fg-sessions__actionButton')].some(b => (b.getAttribute('title') ?? '').startsWith('Mark as')) || !!document.querySelector('[data-status-dot]')`);
    record('sessions dropdown', 'no dot, no unread row (QW0)', { sent: '—', effect: unread ? 'an unread control or dot is shown' : 'none, as the official', verdict: unread ? 'FAIL' : 'PASS' });
  }
  for (const [title, request] of [['Archive session', 'archive_session']]) {
    const row = await centre('.fg-sessions__sessionItem');
    await page.hover(row.x, row.y);
    const at = await page.eval(`const b = [...document.querySelectorAll('.fg-sessions__sessionItem .fg-sessions__actionButton')].find(b => (b.getAttribute('title') ?? '').startsWith(${JSON.stringify(title)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`);
    if (!at) {
      record('sessions dropdown', title, { effect: 'button not found' });
      continue;
    }
    const m = await mark();
    await page.click(at.x, at.y);
    await sleep(500);
    const s = await since(m);
    record('sessions dropdown', title, {
      sent: describeSent(s),
      answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
      verdict: s.requests.some((r) => r.type === request) && !s.fallbacks.length ? 'PASS' : 'FAIL',
    });
  }

  // Rename: the pencil, a new title, Enter.
  {
    const row = await centre('.fg-sessions__sessionItem');
    await page.hover(row.x, row.y);
    const at = await page.eval(`const b = [...document.querySelectorAll('.fg-sessions__sessionItem .fg-sessions__actionButton')].find(b => b.getAttribute('title') === 'Rename session'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`);
    if (at) {
      await page.click(at.x, at.y);
      await sleep(200);
      await page.eval(`const e = document.querySelector('.fg-sessions__sessionNameEditing'); if (e) { if ('value' in e) e.value = ''; else e.textContent = ''; } return true`);
      const m = await mark();
      await page.type('Renamed by the harness');
      await page.key('Enter', 'Enter', 13);
      await sleep(500);
      const s = await since(m);
      const rename = s.requests.find((r) => r.type === 'rename_session');
      record('sessions dropdown', 'Rename session', {
        sent: describeSent(s),
        answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
        effect: rename ? `title "${rename.title}"` : '',
        verdict: rename?.title === 'Renamed by the harness' ? 'PASS' : 'FAIL',
      });
    } else {
      record('sessions dropdown', 'Rename session', { effect: 'button not found' });
    }
  }

  // Open a conversation.
  {
    const at = await centre('.fg-sessions__sessionItem .fg-sessions__sessionName', 'Session B');
    const m = await mark();
    if (at) await page.click(at.x, at.y);
    await sleep(900);
    const s = await since(m);
    const turns = await page.eval(`return document.querySelectorAll('.fg-chat__turn').length`);
    record('sessions dropdown', 'open a conversation', {
      sent: describeSent(s),
      answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
      effect: `${turns} turn(s) shown; dropdown ${await exists('.fg-sessionsdropdown__dropdown') ? 'open' : 'closed'}`,
      verdict: at && s.requests.some((r) => r.type === 'get_session_request') && turns > 0 ? 'PASS' : 'FAIL',
    });
  }
}

// ------------------------------------------- chat: message actions, prompt ---

async function driveMessageActions() {
  const seed = async () => {
    await boot(CHAT);
    await page.eval(`window.__forgeSeedTranscript(window.__forgeChannelId()); return true`);
    await sleep(600);
  };
  /** Open the actions of the `which`-th user message (0 = first, -1 = last). */
  const openActions = async (which) => {
    const at = await page.eval(`
      const buttons = [...document.querySelectorAll('.fg-messageactions__actionButton')];
      const b = buttons.at(${which});
      if (!b) return null;
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
    if (!at) return false;
    await page.hover(at.x - 40, at.y);
    await page.click(at.x, at.y);
    await sleep(300);
    return true;
  };

  await seed();
  await openActions(-1);
  const options = await page.eval(`return [...document.querySelectorAll('.fg-messageactions__popupOption .fg-messageactions__optionText')].map(e => e.textContent.trim())`);
  record('message actions', 'options', { sent: '—', effect: options.join(' / ') || '(none)', verdict: options.length === 3 ? 'PASS' : 'FAIL' });
  if (options.length) oracleRuns.push({ window: 'message actions', root: '.fg-messageactions__popup', ...(await page.eval(ORACLE('.fg-messageactions__popup'))) });

  // [option, message, expected requests in order, what the page must show]
  const cases = [
    ['Fork conversation from here', -1, ['fork_conversation'], 'the fork opens'],
    // The first message: its checkpoint has changes, so Rewind is enabled.
    ['Rewind code to here', 0, ['rewind_code', 'rewind_code'], 'dry run, confirm, rewind'],
    ['Fork conversation and rewind code', -1, ['rewind_code', 'rewind_code', 'fork_conversation'], 'dry run, confirm, rewind, then fork'],
  ];
  for (const [option, which, expected, effect] of cases) {
    await seed();
    const m = await mark();
    await openActions(which);
    await clickOn('.fg-messageactions__popupOption', option);
    await sleep(700);
    const dialog = await exists('.fg-dialog__actions');
    if (dialog) {
      if (option !== 'Fork conversation from here') oracleRuns.push({ window: `rewind dialog (${option})`, root: '.fg-dialog__overlay', ...(await page.eval(ORACLE('.fg-dialog__overlay'))) });
      await clickOn('.fg-dialog__actions button');
      await sleep(800);
    }
    const s = await since(m);
    const types = s.requests.map((r) => r.type).filter((t) => t === 'rewind_code' || t === 'fork_conversation');
    const dryRuns = s.requests.filter((r) => r.type === 'rewind_code').map((r) => r.dryRun === true);
    record('message actions', option, {
      sent: describeSent(s),
      answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
      effect: `${effect}${dialog ? '; confirmation answered' : ''}${dryRuns.length ? `; dryRun ${dryRuns.join(',')}` : ''}`,
      verdict: JSON.stringify(types) === JSON.stringify(expected) && (dryRuns.length === 0 || (dryRuns[0] === true && dryRuns.slice(1).every((d) => !d))) && !s.fallbacks.length ? 'PASS' : 'FAIL',
    });
  }

  // A checkpoint with no changes: "The code has not changed", and Rewind is
  // disabled (the official `disabled unless B`), so nothing is rewound.
  {
    await seed();
    const m = await mark();
    await openActions(-1);
    await clickOn('.fg-messageactions__popupOption', 'Rewind code to here');
    await sleep(700);
    const state = await page.eval(`const b = document.querySelector('.fg-dialog__actions button'); return { label: b?.textContent.trim(), disabled: b?.disabled ?? null, text: document.querySelector('.fg-dialog__content')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80) }`);
    const s = await since(m);
    record('message actions', 'Rewind with no code changes', {
      sent: describeSent(s),
      effect: `${state.label} ${state.disabled ? 'disabled' : 'enabled'}: "${state.text}"`,
      verdict: state.disabled === true && s.requests.filter((r) => r.type === 'rewind_code').every((r) => r.dryRun === true) ? 'PASS' : 'FAIL',
    });
    await escape();
  }

  // The first message has nothing before it to fork from: the official starts
  // a new conversation with the prompt in the composer (`if(f){Q(X);return}`).
  await seed();
  const m = await mark();
  await openActions(0);
  await clickOn('.fg-messageactions__popupOption', 'Fork conversation from here');
  await sleep(700);
  const s = await since(m);
  const draft = await page.eval(`return document.querySelector('.fg-composer__messageInput')?.textContent.trim() ?? ''`);
  record('message actions', 'Fork from the first message', {
    sent: describeSent(s),
    effect: `new conversation, composer: "${draft.slice(0, 40)}"`,
    verdict: !s.requests.some((r) => r.type === 'fork_conversation') && draft.length > 0 ? 'PASS' : 'FAIL',
  });
}

async function drivePermissionPrompt() {
  await boot(CHAT);
  for (const [index, label, expectBehavior] of [[0, 'option 1 (Yes)', 'allow'], [1, 'option 2 (Yes, and don’t ask again…)', 'allow'], [2, 'option 3 (No)', 'deny']]) {
    await page.eval(`window.__forgeSeedPermission({ suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'pnpm run build' }], behavior: 'allow', destination: 'localSettings' }] }); return true`);
    await sleep(600);
    if (index === 0) {
      // With the input shown: inside a closed <details> the <pre> measures 0px
      // in the live page and its width in the oracle's clone, a difference in
      // how hidden content is measured, not in the styles.
      await page.eval(`document.querySelector('.fg-permission__permissionRequestContainer details')?.setAttribute('open', ''); return true`);
      await sleep(200);
      oracleRuns.push({ window: 'permission prompt (input shown)', root: '.fg-permission__permissionRequestContainer', ...(await page.eval(ORACLE('.fg-permission__permissionRequestContainer'))) });
    }
    const buttons = await page.eval(`return [...document.querySelectorAll('.fg-permission__button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())`);
    // The number, not the middle: option 2's middle is its destination link,
    // which changes where the rule is saved instead of answering.
    const at = await page.eval(`const b = document.querySelectorAll('.fg-permission__button')[${index}]; if (!b) return null; const n = b.querySelector('.fg-permission__shortcutNum') ?? b; const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`);
    const answersBefore = await page.eval(`return window.__forgeAnswers.length`);
    const m = await mark();
    if (at) await page.click(at.x, at.y);
    await sleep(500);
    const s = await since(m);
    const answer = await page.eval(`return window.__forgeAnswers[${answersBefore}] ?? null`);
    record('permission prompt', label, {
      sent: describeSent(s),
      answer: answer ? `${answer.behavior}${answer.updatedPermissions?.length ? ` + ${answer.updatedPermissions.length} rule(s)` : ''}` : '(none)',
      effect: `buttons: ${buttons.join(' | ')}; prompt ${await exists('.fg-permission__permissionRequestContainer') ? 'still up' : 'closed'}`,
      verdict: answer?.behavior === expectBehavior && (index !== 1 || answer.updatedPermissions?.length > 0) ? 'PASS' : 'FAIL',
    });
  }
}

async function driveErrorBanner() {
  await boot(CHAT);
  await page.eval(`window.__forgeCloseChannel('Claude Code stopped unexpectedly (exit code 1). The Forge output channel has the details.'); return true`);
  await sleep(500);
  const banner = await exists('.fg-chat__errorBanner');
  await oracle('error banner', '.fg-chat__errorBanner');
  const m = await mark();
  await clickOn('.fg-chat__errorBanner a', 'View output logs');
  await sleep(300);
  const s = await since(m);
  record('chat', 'error banner: View output logs', {
    sent: describeSent(s),
    answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real',
    effect: banner ? 'banner shown on close_channel {error}' : 'no banner',
    verdict: banner && s.requests.some((r) => r.type === 'open_output_panel') ? 'PASS' : 'FAIL',
  });
  await clickOn('.fg-chat__errorDismiss');
  await sleep(200);
  record('chat', 'error banner: dismiss', { sent: '—', effect: (await exists('.fg-chat__errorBanner')) ? 'still shown' : 'dismissed', verdict: (await exists('.fg-chat__errorBanner')) ? 'FAIL' : 'PASS' });
}

/** The chat's own windows: the header, the idle composer and a transcript. */
async function driveChatSurfaces() {
  await boot(CHAT);
  await oracle('header', '.fg-shell__header');
  await page.eval(`document.querySelector('.fg-composer__messageInput')?.blur(); return true`);
  await oracle('composer (idle)', '.fg-composer__inputWrapper');
  await page.eval(`window.__forgeSeedTranscript(window.__forgeChannelId()); return true`);
  await sleep(800);
  // The seeded turns end with results, so the window is measured idle (the
  // spinner's height is divergence #46, not this window).
  for (let i = 0; i < 25 && (await exists('.fg-spinner__container')); i++) await sleep(200);
  await oracle('transcript', '.fg-chat__messagesContainer');
  record('chat', 'header, composer and transcript render', {
    sent: '—',
    effect: `${await page.eval(`return document.querySelectorAll('.fg-chat__turn').length`)} turns`,
    verdict: (await exists('.fg-composer__inputWrapper')) && (await exists('.fg-chat__turn')) ? 'PASS' : 'FAIL',
  });
}

// ------------------------------------------------------------- welcome ---

async function driveWelcome() {
  for (const [state, query, expectWelcome] of [
    ['no endpoint', 'endpoints=0', true],
    // `models=none`: the gate is for nothing to talk to (drive-health.mjs's case B).
    ['endpoints never checked', 'endpoints=2&health=never&models=none', true],
    ['nothing answered', 'endpoints=2&health=none', true],
    ['some answered', 'endpoints=2&health=mixed', false],
  ]) {
    await boot(query);
    const shown = await exists('.fg-welcome__container');
    const buttons = await page.eval(`return [...document.querySelectorAll('.fg-welcome__fullWidthButton, .forge-welcome__action')].map(b => b.textContent.trim())`);
    if (shown) await oracle(`welcome: ${state}`, '.fg-welcome__container');
    record('welcome', state, {
      sent: '—',
      effect: shown ? `welcome with ${buttons.join(' / ')}` : 'chat (no welcome)',
      verdict: shown === expectWelcome ? 'PASS' : 'FAIL',
    });
  }
}

// ------------------------------------------------------------ sessions page ---

async function driveSessionsPage() {
  // The activity-bar session manager: the official KW0 around the shared list
  // (`At`, isSessionListOnly). Production audit, Phase 6.
  const SM = 'page=sessions&mockSessions&endpoints=1';
  await boot(SM);
  const S = 'session manager';
  const names = await page.eval(`return [...document.querySelectorAll('.fg-sessions__sessionItem .fg-sessions__sessionName')].map(e => e.textContent.trim())`);
  await oracle('session manager', '.fg-sessionmanager__root');
  record(S, 'list', { sent: 'list_sessions_request, get_session_groups, get_collapsed_panel_sections', effect: `${names.length} rows`, verdict: names.length >= 2 ? 'PASS' : 'FAIL' });

  const groups = () => page.eval(`return window.__forgeGroups()`);
  const menuRows = () => page.eval(`return [...document.querySelectorAll('.fg-contextmenu__contextMenu .fg-contextmenu__menuItem')].map(e => e.textContent.replace('›', '').trim())`);
  const rowAt = (text) => centre('.fg-sessions__sessionItem', text);
  async function rightClick(at, modifiers = 0) {
    await page.raw('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    await page.raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'right', buttons: 2, clickCount: 1, modifiers });
    await page.raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'right', buttons: 0, clickCount: 1, modifiers });
    await sleep(300);
  }
  async function modClick(at, modifiers) {
    await page.raw('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    await page.raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await page.raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
    await sleep(250);
  }
  /** Run `act`, then record what it sent and whether `check` holds. */
  async function step(row, act, check) {
    const m = await mark();
    const ok0 = await act();
    await sleep(450);
    const s = await since(m);
    const { ok, effect } = ok0 === false ? { ok: false, effect: 'control not found' } : await check(s);
    record(S, row, { sent: describeSent(s), answer: s.fallbacks.length ? `fallback: ${s.fallbacks.join(', ')}` : 'real', effect, verdict: ok && !s.fallbacks.length && !s.errors.length ? 'PASS' : 'FAIL' });
  }
  const sentOf = (s, type) => s.requests.filter((r) => r.type === type);

  await step('Collapse session manager', () => clickOn('.fg-sessionmanager__sectionToggle'), async (s) => {
    const t = sentOf(s, 'update_collapsed_panel_sections')[0]?.toggle;
    const hidden = await exists('.fg-sessionmanager__sessionsBodyCollapsed');
    return { ok: t?.section === 'sessions' && t.collapsed === true && hidden, effect: `toggle ${JSON.stringify(t)}; body ${hidden ? 'collapsed' : 'open'}` };
  });
  await step('Expand session manager', () => clickOn('.fg-sessionmanager__sectionToggle'), async (s) => {
    const t = sentOf(s, 'update_collapsed_panel_sections')[0]?.toggle;
    return { ok: t?.collapsed === false && !(await exists('.fg-sessionmanager__sessionsBodyCollapsed')), effect: `toggle ${JSON.stringify(t)}` };
  });
  await step('New session', () => clickOn('.fg-sessionmanager__newSessionButton'), async (s) => {
    const r = sentOf(s, 'reveal_chat')[0];
    return { ok: r?.newConversation === true && !r.sessionId, effect: r ? `reveal_chat {newConversation:${r.newConversation}, fromView:${r.fromView}}` : '' };
  });
  await step('Search sessions (reveal, type, Escape)', async () => {
    if (!(await clickOn('.fg-sessions__searchToggleButton'))) return false;
    await page.type('tidy');
  }, async () => {
    await sleep(200);
    const shown = await page.eval(`return [...document.querySelectorAll('.fg-sessions__sessionItem .fg-sessions__sessionName')].map(e => e.textContent.trim())`);
    await escape();
    await sleep(200);
    const folded = !(await exists('.fg-sessions__searchBox'));
    return { ok: shown.length === 1 && shown[0].includes('Session B') && folded, effect: `"tidy" -> ${shown.join(' / ')}; Escape folds the box: ${folded}` };
  });

  let groupId;
  await step('New group (and name it inline)', async () => {
    if (!(await clickOn('.fg-sessions__newGroupButton', 'New group'))) return false;
    await sleep(250);
    await page.type('Refactor');
    await page.key('Enter', 'Enter', 13);
  }, async (s) => {
    const g = await groups();
    groupId = g[0]?.id;
    return { ok: g.length === 1 && g[0].name === 'Refactor' && sentOf(s, 'update_session_groups').length >= 2, effect: `groups: ${g.map((x) => x.name).join(', ')}` };
  });
  await oracle('session manager, a group', '.fg-sessionmanager__root');

  await step('Row menu: Add to group ▸ Refactor', async () => {
    await rightClick(await rowAt('Session A'));
    await oracle('session row menu', '.fg-contextmenu__contextMenu');
    const rowsShown = (await menuRows()).join(' / ');
    record(S, 'row menu (mH0)', { sent: '—', effect: rowsShown, verdict: rowsShown === 'Resume session / New group from session / Add to group / Mark as unread / Archive session' ? 'PASS' : 'FAIL' });
    await clickOn('.fg-contextmenu__menuItem', 'Add to group');
    await sleep(250);
    return clickOn('.fg-contextmenu__contextMenu + .fg-contextmenu__contextMenu .fg-contextmenu__menuItem', 'Refactor');
  }, async (s) => {
    const g = await groups();
    return { ok: g[0]?.sessionIds.length === 1 && sentOf(s, 'update_session_groups').length === 1, effect: `Refactor holds ${g[0]?.sessionIds.length ?? 0}` };
  });
  await step('Collapse a group', () => clickOn('.fg-sessions__groupHeader', 'Refactor'), async () => {
    const g = await groups();
    return { ok: g[0]?.collapsed === true, effect: `collapsed: ${g[0]?.collapsed}` };
  });
  await clickOn('.fg-sessions__groupHeader', 'Refactor');
  await sleep(300);

  await step('Group menu: Rename group', async () => {
    await rightClick(await centre('.fg-sessions__groupHeader', 'Refactor'));
    await oracle('session group menu', '.fg-contextmenu__contextMenu');
    const rowsShown = (await menuRows()).join(' / ');
    record(S, 'group menu (_W0)', { sent: '—', effect: rowsShown, verdict: rowsShown === 'Start new session in this group / New group / Rename group / Delete group' ? 'PASS' : 'FAIL' });
    await clickOn('.fg-contextmenu__menuItem', 'Rename group');
    await sleep(250);
    await page.key('a', 'KeyA', 65, 2);
    await page.type('Cleanup');
    await page.key('Enter', 'Enter', 13);
  }, async () => {
    const g = await groups();
    return { ok: g[0]?.name === 'Cleanup', effect: `name: ${g[0]?.name}` };
  });
  await step('Group menu: Start new session in this group', async () => {
    await rightClick(await centre('.fg-sessions__groupHeader', 'Cleanup'));
    return clickOn('.fg-contextmenu__menuItem', 'Start new session in this group');
  }, async (s) => {
    const r = sentOf(s, 'reveal_chat')[0];
    return { ok: r?.newConversation === true && r.groupId === groupId, effect: r ? `reveal_chat {newConversation:true, groupId:${r.groupId?.slice(0, 8)}…}` : '' };
  });

  await step('Multi-select (Ctrl+click) and "New group from 2 sessions"', async () => {
    await clickOn('.fg-sessions__groupHeader', 'Ungrouped');
    await sleep(200);
    await clickOn('.fg-sessions__groupHeader', 'Ungrouped');
    await sleep(200);
    await modClick(await rowAt('Session A'), 2);
    await modClick(await rowAt('Session B'), 2);
    const selected = await page.eval(`return document.querySelectorAll('.fg-sessions__sessionItem.fg-sessions__selected').length`);
    if (selected !== 2) return false;
    await rightClick(await rowAt('Session B'));
    return clickOn('.fg-contextmenu__menuItem', 'New group from 2 sessions');
  }, async () => {
    const g = await groups();
    const last = g.at(-1);
    await escape();
    return { ok: g.length === 2 && last?.sessionIds.length === 2 && g[0].sessionIds.length === 0, effect: `groups: ${g.map((x) => `${x.name}(${x.sessionIds.length})`).join(', ')}` };
  });
  await sleep(300);
  await step('Row menu: Remove from group', async () => {
    await rightClick(await rowAt('Session B'));
    return clickOn('.fg-contextmenu__menuItem', 'Remove from group');
  }, async () => {
    const g = await groups();
    return { ok: g.at(-1)?.sessionIds.length === 1, effect: `groups: ${g.map((x) => `${x.name}(${x.sessionIds.length})`).join(', ')}` };
  });
  await step('Drag a row onto a group', async () => {
    return page.eval(`
      const row = [...document.querySelectorAll('.fg-sessions__sessionItem')].find(e => e.textContent.includes('Session B'));
      const header = [...document.querySelectorAll('.fg-sessions__groupHeader')].find(e => e.textContent.includes('Cleanup'));
      if (!row || !header) return false;
      const dt = new DataTransfer();
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const r = header.getBoundingClientRect(); const at = { clientX: r.x + 5, clientY: r.y + 5 };
      header.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
      header.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
      row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return true`);
  }, async () => {
    const g = await groups();
    const cleanup = g.find((x) => x.name === 'Cleanup');
    return { ok: cleanup?.sessionIds.length === 1, effect: `Cleanup holds ${cleanup?.sessionIds.length ?? 0} (a synthetic DragEvent: CDP cannot drive native drag here)` };
  });

  await step('Row menu: Mark as unread', async () => {
    await rightClick(await rowAt('Session A'));
    return clickOn('.fg-contextmenu__menuItem', 'Mark as unread');
  }, async (s) => {
    const r = sentOf(s, 'set_session_unread')[0];
    await sleep(300);
    const dot = await page.eval(`return document.querySelector('[data-status-dot="unread"]') ? 'unread dot' : 'no dot'`);
    return { ok: r?.unread === true && dot === 'unread dot', effect: `set_session_unread {unread:${r?.unread}}; ${dot}` };
  });
  await step('Active · N (needs input, working or unread)', () => clickOn('.fg-sessions__activeFilterToggle'), async () => {
    const shown = await page.eval(`return [...document.querySelectorAll('.fg-sessions__sessionItem .fg-sessions__sessionName')].map(e => e.textContent.trim())`);
    const pressed = await page.eval(`return document.querySelector('.fg-sessions__activeFilterToggle')?.getAttribute('aria-pressed')`);
    await clickOn('.fg-sessions__activeFilterToggle');
    return { ok: pressed === 'true' && shown.length === 1 && shown[0].includes('Session A'), effect: `pressed; shows ${shown.join(' / ')}` };
  });
  await step('Filter by status (checks keep the menu open)', async () => {
    await clickOn('.fg-sessions__statusFilterMenuButton');
    await oracle('status filter menu', '.fg-contextmenu__contextMenu');
    return clickOn('.fg-contextmenu__menuItem', 'Working');
  }, async () => {
    const open = await exists('.fg-contextmenu__contextMenu');
    const checked = await page.eval(`return [...document.querySelectorAll('.fg-contextmenu__menuItem[aria-checked="true"]')].map(e => e.textContent.trim())`);
    const empty = await page.eval(`return document.querySelector('.fg-sessions__emptyState')?.textContent.trim() ?? ''`);
    await clickOn('.fg-contextmenu__menuItem', 'Working');
    await escape();
    return { ok: open && checked.length === 1 && empty === 'No sessions found', effect: `menu ${open ? 'stays open' : 'closed'}; checked ${checked.join(', ')}; list: ${empty}` };
  });

  await step('Row menu: Archive session', async () => {
    await rightClick(await rowAt('Session B'));
    return clickOn('.fg-contextmenu__menuItem', 'Archive session');
  }, async (s) => {
    await sleep(200);
    const header = await page.eval(`return [...document.querySelectorAll('.fg-sessions__groupHeader')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()).find(t => t.startsWith('Archived')) ?? ''`);
    return { ok: sentOf(s, 'archive_session').length === 1 && header.startsWith('Archived sessions'), effect: `archive_session; header "${header}"` };
  });
  await step('Expand Archived sessions', () => clickOn('.fg-sessions__groupHeader', 'Archived sessions'), async (s) => {
    const p = sentOf(s, 'update_session_section_collapse_state')[0]?.patch;
    return { ok: p?.archivedCollapsed === false, effect: `patch ${JSON.stringify(p)}` };
  });
  await step('Archived row menu: Unarchive session', async () => {
    await rightClick(await rowAt('Session B'));
    const rowsShown = (await menuRows()).join(' / ');
    record(S, 'archived row menu (cH0)', { sent: '—', effect: rowsShown, verdict: rowsShown === 'Resume session / Unarchive session' ? 'PASS' : 'FAIL' });
    return clickOn('.fg-contextmenu__menuItem', 'Unarchive session');
  }, async (s) => ({ ok: sentOf(s, 'unarchive_session').length === 1, effect: 'unarchive_session' }));

  await step('Rename session (the pencil)', async () => {
    const row = await rowAt('Session A');
    await page.hover(row.x, row.y);
    const at = await page.eval(`const b = [...document.querySelectorAll('.fg-sessions__actionButton')].find(b => b.getAttribute('title') === 'Rename session' && b.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`);
    if (!at) return false;
    await page.click(at.x, at.y);
    await sleep(200);
    await page.type('Renamed in the manager');
    await page.key('Enter', 'Enter', 13);
  }, async (s) => {
    const r = sentOf(s, 'rename_session')[0];
    return { ok: r?.title === 'Renamed in the manager', effect: r ? `title "${r.title}"` : '' };
  });
  await step('Group menu: Delete group', async () => {
    await rightClick(await centre('.fg-sessions__groupHeader', 'Cleanup'));
    return clickOn('.fg-contextmenu__menuItem', 'Delete group');
  }, async () => {
    const g = await groups();
    return { ok: !g.some((x) => x.name === 'Cleanup'), effect: `groups: ${g.map((x) => x.name).join(', ') || '(none)'}` };
  });
  await step('open a conversation', () => clickOn('.fg-sessions__sessionItem .fg-sessions__sessionName', 'Session'), async (s) => {
    const r = sentOf(s, 'reveal_chat')[0];
    return { ok: !!r?.sessionId, effect: r ? `reveal_chat {sessionId:${r.sessionId?.slice(0, 8)}…, fromView:${r.fromView}}` : '' };
  });

  // Reloaded: the groups, the section state and the panel sections come back from the host.
  await page.navigate(`${BASE}?${SM}`, 3000);
  {
    const headers = await page.eval(`return [...document.querySelectorAll('.fg-sessions__groupHeader .fg-sessions__groupName')].map(e => e.textContent.trim())`);
    const stored = (await groups()).map((g) => g.name);
    record(S, 'groups survive a reload', { sent: 'get_session_groups', effect: `stored: ${stored.join(', ')}; shown: ${headers.join(' / ')}`, verdict: stored.length > 0 && stored.every((name) => headers.includes(name)) ? 'PASS' : 'FAIL' });
  }

  // No endpoint: the setup stands where the official has its login page.
  await boot('page=sessions&mockSessions');
  {
    const welcome = await exists('.fg-sessionmanager__root .fg-welcome__container');
    const list = await exists('.fg-sessions__root');
    const m = await mark();
    const clicked = await clickOn('.fg-sessionmanager__root button', 'Set up');
    await sleep(500);
    const s = await since(m);
    const run = sentOf(s, 'run_endpoint_action')[0];
    record(S, 'no endpoint: the setup', { sent: describeSent(s), effect: `setup ${welcome ? 'shown' : 'missing'}, list ${list ? 'shown' : 'hidden'}; ${run ? `run_endpoint_action {action:${run.action}}` : 'nothing sent'}`, verdict: welcome && !list && clicked && run?.action === 'add' ? 'PASS' : 'FAIL' });
  }

  await boot('page=sessions&endpoints=1');
  const empty = await page.eval(`return document.querySelector('.fg-sessions__nullStateText')?.textContent.trim() ?? ''`);
  record(S, 'empty', { sent: 'list_sessions_request', effect: empty || '(nothing)', verdict: empty === 'No sessions yet' ? 'PASS' : 'FAIL' });

  // A read that fails ends in the list's own states, as the official's does
  // (it has no error state): here, "No sessions yet", not a spinner forever.
  await boot('page=sessions&endpoints=1');
  await page.eval(`window.__forgeListFails = true;
    window.__forgeHostPush({ type: 'visibility_changed', isVisible: false });
    window.__forgeHostPush({ type: 'visibility_changed', isVisible: true }); return true`);
  await sleep(800);
  const settled = await page.eval(`return document.querySelector('.fg-sessions__nullStateText')?.textContent.trim() ?? (document.querySelector('.fg-sessions__disconnectedText') ? 'spinner' : '')`);
  await page.eval(`window.__forgeListFails = false; return true`);
  record(S, 'list error', { sent: 'list_sessions_request', effect: settled || '(nothing)', verdict: settled === 'No sessions yet' ? 'PASS' : 'FAIL' });
}

// ------------------------------------------------------------- settings ---

const SETTINGS_TABS = ['general', 'models', 'profiles', 'plugins', 'environments', 'memory-and-rules', 'permissions', 'sandbox', 'network', 'hooks', 'skills', 'agents', 'mcp-servers', 'slash-commands', 'endpoints'];

async function driveSettings() {
  for (const tab of SETTINGS_TABS) {
    await boot(`page=settings&tab=${tab}&mockSessions&endpoints=2&health=mixed`, 3500);
    const state = await page.eval(`
      const active = document.querySelector('[aria-selected="true"], [aria-current="page"], .active, [data-active="true"]');
      const heading = document.querySelector('.cursor-settings-pane-content h1, .cursor-settings-pane-content h2, .cursor-settings-pane-content [class*="title"]');
      return {
        active: active?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40) ?? '',
        heading: heading?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60) ?? '',
        text: document.querySelector('.cursor-settings-pane-content')?.innerText.length ?? 0,
        requests: [...new Set(window.__forgeSent.filter(m => m.type === 'request').map(m => m.request.type))],
        fallbacks: window.__forgeFallbacks.slice(),
        errors: window.__driveErrors.slice(),
      }`);
    const ok = state.text > 0 && state.fallbacks.length === 0 && state.errors.length === 0;
    record('settings', tab, {
      sent: state.requests.join(', '),
      answer: state.fallbacks.length ? `fallback: ${state.fallbacks.join(', ')}` : 'real',
      effect: `${state.heading || state.active || '(no heading)'}${state.errors.length ? `; errors: ${state.errors.join(' | ')}` : ''}`,
      verdict: ok ? 'PASS' : 'FAIL',
    });
  }
}

// --------------------------------------------------------- plan preview ---

async function drivePlanPreview() {
  await boot('page=plan-preview', 3500);
  const shown = await exists('.forge-plan-preview');
  let probe = null;
  if (shown) {
    probe = await page.eval(`const r = await eval(await (await fetch('/probes/probe-planpreview.js')).text()); return { checked: r.checked, clean: r.clean, structural: (r.structural ?? r.structuralRows ?? []).length ?? r.structural }`);
  }
  record('plan preview', 'page', {
    sent: '—',
    effect: shown ? `probe-planpreview: ${JSON.stringify(probe)}` : 'no .forge-plan-preview',
    verdict: shown ? 'PASS' : 'FAIL',
  });
}

// --------------------------------------------------------------- run ---

const steps = [
  ['"/" menu', driveSlashMenu],
  ['"+" menu', driveAddMenu],
  ['mode menu', driveModeMenu],
  ['model menu', driveModelMenu],
  ['fast mode', driveFastMode],
  ['sessions dropdown', driveSessionsDropdown],
  ['message actions', driveMessageActions],
  ['permission prompt', drivePermissionPrompt],
  ['error banner', driveErrorBanner],
  ['chat surfaces', driveChatSurfaces],
  ['welcome', driveWelcome],
  ['sessions page', driveSessionsPage],
  ['settings', driveSettings],
  ['plan preview', drivePlanPreview],
  ['coverage', driveCoverage],
];
const only = argOf('--only', undefined);
try {
  for (const [name, step] of steps) {
    if (only && !only.split(',').includes(name)) continue;
    try {
      await step();
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
      record(name, '(step failed)', { effect: String(error.message).slice(0, 200), verdict: 'FAIL' });
    }
  }
} finally {
  await page.close();
}

// ------------------------------------------------------------- oracle ---

const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
const oracleTable = oracleRuns.map((run) => {
  if (run.missing) return { ...run, verdict: 'FAIL', note: 'root not found' };
  const now = (run.structural ?? []).map((r) => `${r.el} ${Object.keys(r.diffs ?? {}).sort().join(',')}`).sort();
  const known = baseline[run.window];
  const added = known ? now.filter((r) => !known.includes(r)) : [];
  return {
    ...run,
    rowsNow: now,
    added,
    verdict: known === undefined ? 'NEW' : added.length ? 'FAIL' : 'PASS',
  };
});
if (WRITE_BASELINE) {
  const next = { ...baseline };
  for (const run of oracleTable) if (!run.missing) next[run.window] = run.rowsNow;
  mkdirSync(dirname(BASELINE_FILE), { recursive: true });
  writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
}

// -------------------------------------------------------------- report ---

const count = (v) => rows.filter((r) => r.verdict === v).length;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = [
  '| Surface | Row | Sent | Host answer | UI effect | Verdict |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${esc(r.surface)} | ${esc(r.row)} | ${esc(r.sent)} | ${esc(r.answer)} | ${esc(r.effect)} | ${r.verdict} |`),
  '',
  `**Counts:** PASS ${count('PASS')} · FAIL ${count('FAIL')} · LEFT OUT ${count('LEFT OUT')}`,
  '',
  '| Window | Root | Checked | Clean | Structural | New vs baseline | Verdict |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...oracleTable.map((o) => `| ${esc(o.window)} | \`${o.root}\` | ${o.checked ?? '—'} | ${o.clean ?? '—'} | ${o.diffs ?? '—'} | ${o.added?.length ? esc(o.added.join('; ')) : '—'} | ${o.verdict} |`),
];
if (coverageRuns.length) {
  lines.push('', '| State (probe-coverage) | Official classes rendered | Not rendered in this state |', '| --- | --- | --- |');
  for (const c of coverageRuns) lines.push(`| ${esc(c.state)} | ${c.present ?? '—'} | ${c.missing ?? '—'} |`);
}
const report = lines.join('\n');
console.log(`\n${report}`);
if (OUT) writeFileSync(OUT, `${report}\n`);
if (problems.length) console.error(`\nSteps that failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
process.exit(count('FAIL') || oracleTable.some((o) => o.verdict === 'FAIL') ? 1 : 0);
