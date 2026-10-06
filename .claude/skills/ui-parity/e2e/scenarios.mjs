/**
 * The end-to-end scenarios. Each one drives the real extension in the
 * isolated host and records evidence it read back from disk, from the
 * gateway's request log or from the webview's DOM, never from the UI alone.
 *
 * `run(ctx)` throws on failure, returns 'partial' when only part of the
 * scenario could be proven, and otherwise passes. `needs` marks what a
 * scenario cannot run without: 'stub' (it scripts the model), 'windows'
 * (VS Code desktop on Windows).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Every session .jsonl the CLI wrote under the isolated home. */
export function sessionFiles(dirs) {
  const projects = path.join(dirs.home, '.claude', 'projects');
  if (!fs.existsSync(projects)) return [];
  const files = [];
  for (const project of fs.readdirSync(projects)) {
    const dir = path.join(projects, project);
    for (const name of fs.readdirSync(dir)) if (name.endsWith('.jsonl')) files.push(path.join(dir, name));
  }
  return files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
}

/** A JSON file's content, or {} when it is absent. */
export function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

/** The host's settings files a machine-scoped setting can land in. */
export function settingsFiles(dirs) {
  return ['User', 'Machine'].map((scope) => path.join(dirs.userData, scope, 'settings.json')).filter((file) => fs.existsSync(file));
}

export async function waitUntil(fn, { timeoutMs = 30_000, label = 'a condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${label}${last ? ` (last: ${String(last).slice(0, 160)})` : ''}`);
}

async function stubLog(ctx) {
  return (await fetch(`${ctx.stubUrl}/__log`)).json();
}

async function stubControl(ctx, values) {
  if (ctx.stubUrl) await fetch(`${ctx.stubUrl}/__control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
}

async function stubReset(ctx) {
  if (ctx.stubUrl) await fetch(`${ctx.stubUrl}/__reset`, { method: 'POST' });
}

/**
 * Close the tip cards ("Meet Ultracode", "Keep moving with Edit
 * automatically"): while one is open, the next click outside it only closes
 * it, as it would for a user.
 */
export async function dismissNotices(chat) {
  for (let i = 0; i < 5; i++) {
    const open = await chat.evaluate(`return !!document.querySelector('.fg-notice__container .fg-notice__header .fg-iconbutton__iconButton')`);
    if (!open) return;
    // A card can go between the check and the click; the next pass sees it gone.
    await chat.click('.fg-notice__container .fg-notice__header .fg-iconbutton__iconButton').catch(() => {});
    await sleep(300);
  }
}

/** Open the chat (side bar) and wait for its composer. */
export async function openChat(ctx) {
  const { wb } = ctx;
  let chat;
  try {
    chat = await wb.forge({ test: `document.querySelector('.fg-composer__messageInput')`, timeoutMs: 3_000 });
  } catch {
    await wb.runCommand('Forge: Open in Side Bar');
    chat = await wb.forge({ test: `document.querySelector('.fg-composer__messageInput')`, timeoutMs: 45_000, label: 'the Forge composer' });
  }
  await dismissNotices(chat);
  return chat;
}

/** Wait for an assistant row containing `text`, and for the turn to end. */
export async function waitForReply(chat, text, { timeoutMs = 90_000 } = {}) {
  await chat.waitFor(
    `[...document.querySelectorAll('.fg-chat__messagesContainer .fg-chat__timelineMessage')].some(e => e.textContent.includes(${JSON.stringify(text)}))`,
    { timeoutMs, label: `an assistant row with "${text}"` },
  );
  await waitForIdle(chat, { timeoutMs });
}

/** The turn is over when the send button stops showing Stop. */
export const waitForIdle = (chat, { timeoutMs = 90_000 } = {}) =>
  chat.waitFor(`!document.querySelector('.fg-footer__stopIcon')`, { timeoutMs, label: 'the turn to end' });

/** Send a prompt and wait for the stub's echo of it ("Stub reply N: <prompt>"). */
export async function turn(chat, prompt, options) {
  await chat.send(prompt);
  await waitForReply(chat, prompt.slice(0, 60), options);
}

/** The session file whose text includes `needle`. */
export const sessionWith = (dirs, needle) => sessionFiles(dirs).find((f) => fs.readFileSync(f, 'utf8').includes(needle));

/** Open the sessions dropdown; returns the row names. */
export async function openHistory(chat) {
  if (!(await chat.evaluate(`return !!document.querySelector('.fg-sessionsdropdown__dropdown')`))) {
    await chat.click('button[aria-label="Session history"]');
  }
  await chat.waitFor(`document.querySelector('.fg-sessionsdropdown__dropdown .fg-sessions__sessionItem')`, { label: 'the history rows' });
  return chat.evaluate(`return [...document.querySelectorAll('.fg-sessions__sessionItem .fg-sessions__sessionName')].map(e => e.textContent.trim())`);
}

/** Close the sessions dropdown and wait until it is gone. */
export async function closeHistory(ctx, chat) {
  if (!(await chat.evaluate(`return !!document.querySelector('.fg-sessionsdropdown__dropdown')`))) return;
  await ctx.wb.key('Escape');
  await chat.waitFor(`!document.querySelector('.fg-sessionsdropdown__dropdown')`, { label: 'the history to close', timeoutMs: 5_000 }).catch(() => {});
}

/**
 * The activity-bar session manager ("Forge: Past Conversations"), as a frame
 * handle, once its list has rows. Production audit, Phase 6.
 */
export async function openManager(ctx) {
  await ctx.wb.runCommand('Forge: Past Conversations');
  const sm = await ctx.wb.forge({ test: `document.querySelector('.fg-sessionmanager__root .fg-sessions__sessionItem')`, label: 'the session manager', timeoutMs: 30_000 });
  await sleep(500);
  return sm;
}

/** Right-click a row (or a group header) in the manager and choose a menu row, following a submenu. */
export async function managerMenu(ctx, sm, target, path, { header = false } = {}) {
  await sm.clickWith(header ? '.fg-sessions__groupHeader' : '.fg-sessions__sessionItem', { text: target }, { button: 'right' });
  await sm.waitFor(`document.querySelector('.fg-contextmenu__contextMenu')`, { label: 'the context menu' });
  const [first, sub] = Array.isArray(path) ? path : [path];
  if (sub) {
    // Hover, never click, a row with a submenu: in a narrow view the submenu
    // opens over its parent (the official's `o85` flips and clamps it), so a
    // click on the parent row lands on whatever submenu row is under it.
    await sm.hover('.fg-contextmenu__menuItem', { text: first });
    await sm.waitFor(`document.querySelectorAll('.fg-contextmenu__contextMenu').length === 2`, { label: 'the submenu' });
    await sm.click('.fg-contextmenu__contextMenu + .fg-contextmenu__contextMenu .fg-contextmenu__menuItem', { text: sub });
  } else {
    await sm.click('.fg-contextmenu__menuItem', { text: first });
  }
  await sleep(400);
}

/** The manager's group headers as "name count". */
export async function managerGroups(sm) {
  return sm.evaluate(`return [...document.querySelectorAll('.fg-sessions__groupHeader')].map(h => h.querySelector('.fg-sessions__groupName').textContent.trim() + ' ' + h.querySelector('.fg-sessions__groupCount').textContent.trim())`);
}

/**
 * Replace User/settings.json through VS Code's own settings editor, as a user
 * editing it would. code-server does not pick up an edit made to that file on
 * disk behind its back, so a write must go through the workbench.
 */
export async function writeUserSettings(wb, text, file) {
  await wb.runCommand('Preferences: Open User Settings (JSON)');
  await wb.waitFor(`[...document.querySelectorAll('.tabs-container .tab.active')].some(t => (t.getAttribute('aria-label') ?? '').startsWith('settings.json'))`, { label: 'settings.json open', timeoutMs: 20_000 });
  await sleep(500);
  await wb.key('a', 2);
  await wb.type(text);
  // Whatever the editor left after the typed text (a closing bracket it
  // added) goes: select to the end of the file, and delete.
  await wb.key('End', 2 | 8);
  await wb.key('Delete');
  await sleep(300);
  await wb.runCommand('File: Save');
  await sleep(800);
  await wb.runCommand('View: Close Editor');
  // What was saved must parse: VS Code refuses to write to a settings file
  // that does not, so Forge's own writes (the picker's choice) would fail.
  if (file) {
    try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${file} does not parse after the edit: ${error.message}`); }
  }
}

/** Start a new conversation from the chat header. */
export async function newSession(chat) {
  // The header is hidden while the welcome page is up, and on a fresh profile
  // the chat opens on the first-run welcome for about a second, until the
  // host's handshake says an endpoint exists.
  await chat.waitFor(`document.querySelector('button[aria-label="New session"]')`, { label: 'the header\'s New session button' });
  await chat.click('button[aria-label="New session"]');
  await chat.waitFor(`!document.querySelector('.fg-chat__messagesContainer .fg-chat__message')`, { label: 'an empty conversation' });
  // A new conversation can bring up a tip card; it would take the next click.
  await sleep(600);
  await dismissNotices(chat);
}

/** Close the "/" menu and wait until it is gone (it animates out). */
export async function closeSlashMenu(ctx, chat) {
  const open = () => chat.evaluate(`return !!document.querySelector('.fg-commandmenu__menuPopup')`);
  if (!(await open())) return;
  await ctx.wb.key('Escape');
  // After a row that keeps the menu open (a toggle) focus has left the filter,
  // so Escape does not reach it -- in the official too (`KZ`: keepMenuOpen
  // runs the command and returns). Back into the filter, then Escape, as a
  // user would.
  if (await chat.waitFor(`!document.querySelector('.fg-commandmenu__menuPopup')`, { timeoutMs: 1_500 }).catch(() => false)) return;
  await chat.click('.fg-commandmenu__menuPopup input');
  await ctx.wb.key('Escape');
  await chat.waitFor(`!document.querySelector('.fg-commandmenu__menuPopup')`, { label: 'the "/" menu to close', timeoutMs: 5_000 });
}

/** Open the "/" menu, optionally typing a filter; returns the visible rows. */
export async function slashMenu(ctx, chat, filter) {
  await dismissNotices(chat);
  // A popup still open (history, a tip) takes the first click to close itself,
  // as it does for a user: click again if the menu did not open.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await chat.evaluate(`return !!document.querySelector('.fg-commandmenu__menuPopup')`)) break;
    await chat.click('.fg-footer__menuButton');
    if (await chat.waitFor(`document.querySelector('.fg-commandmenu__menuPopup')`, { timeoutMs: 2_000 }).catch(() => false)) break;
  }
  await chat.waitFor(`document.querySelector('.fg-commandmenu__menuPopup')`, { label: 'the "/" menu', timeoutMs: 5_000 });
  if (filter) {
    await ctx.wb.type(filter);
    await sleep(500);
  }
  return chat.evaluate(`return [...document.querySelectorAll('.fg-commandmenu__commandItem')].map(e => ({ label: e.querySelector('.fg-commandmenu__commandLabel')?.textContent.trim() ?? e.innerText.trim(), title: e.getAttribute('title') ?? '' }))`);
}

/** Palette rows matching `query` (the palette is left closed). */
export async function paletteRows(wb, query) {
  await wb.key('Escape');
  await wb.key('F1');
  await sleep(500);
  await wb.type(query);
  await sleep(1200);
  const rows = await wb.evaluate(`return [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.getAttribute('aria-label'))`);
  await wb.key('Escape');
  return rows.filter((r) => r && r !== 'No matching commands');
}

/** Click a workbench element (by selector and text) with real input. */
export async function clickWorkbench(wb, selector, text) {
  const read = () =>
    wb.evaluate(`
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text === undefined ? 'true' : `e.textContent.trim() === ${JSON.stringify(text)}`});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
  // Dialogs slide in: wait until the target stops moving.
  let at = await read();
  for (let i = 0; at && i < 20; i++) {
    await sleep(120);
    const again = await read();
    if (again && Math.abs(again.x - at.x) < 0.5 && Math.abs(again.y - at.y) < 0.5) break;
    at = again;
  }
  if (!at) throw new Error(`no ${selector}${text ? ` "${text}"` : ''} in the workbench`);
  await wb.click(at.x, at.y);
}

export const SCENARIOS = [
  {
    // First: the host opens the workspace untrusted.
    id: 15,
    title: 'Restricted Mode: Forge stays off until the workspace is trusted, then activates',
    async run(ctx) {
      const { wb, evidence } = ctx;
      const status = await waitUntil(async () => {
        const items = await wb.evaluate(`return [...document.querySelectorAll('.statusbar-item')].map(e => e.textContent.trim()).filter(Boolean)`);
        return items.includes('Restricted Mode') && items;
      }, { label: 'Restricted Mode in the status bar', timeoutMs: 20_000 });
      assert(status, 'the workspace is not in Restricted Mode');
      evidence('status bar: Restricted Mode');
      const rows = await paletteRows(wb, 'Forge:');
      assert(rows.length === 0, `Forge commands offered in Restricted Mode: ${rows.join(', ')}`);
      evidence('palette: no Forge command in Restricted Mode (untrustedWorkspaces.supported: false)');
      assert(!(await wb.forgeFrames()).length, 'a Forge webview exists in Restricted Mode');
      evidence('no Forge webview in Restricted Mode');

      await wb.runCommand('Workspaces: Manage Workspace Trust');
      await wb.waitFor(`[...document.querySelectorAll('.workspace-trust-editor .monaco-button')].some(b => b.textContent === 'Trust')`, { label: 'the Trust button' });
      await clickWorkbench(wb, '.workspace-trust-editor .monaco-button', 'Trust');
      await wb.waitFor(`![...document.querySelectorAll('.statusbar-item')].some(e => e.textContent.trim() === 'Restricted Mode')`, { label: 'trust to be granted' });
      evidence('trusted through the Workspace Trust editor (real click)');
      await waitUntil(async () => (await paletteRows(wb, 'Forge: Open in Side Bar')).length > 0, { label: 'Forge commands after trust', timeoutMs: 30_000 });
      evidence('palette: Forge commands present once trusted');
      await wb.runCommand('View: Close All Editors');
    },
  },
  {
    id: 1,
    title: 'Install and activate: Forge never writes ~/.claude/settings.json',
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      evidence(`chat opened (webview ${chat.id})`);
      const settings = path.join(dirs.home, '.claude', 'settings.json');
      assert(!fs.existsSync(settings), `${settings} exists after activation`);
      evidence('~/.claude/settings.json absent after activation');
      const forgeJson = path.join(dirs.home, '.claude', 'forge.json');
      if (fs.existsSync(forgeJson)) evidence(`Forge's own flag layer present: ~/.claude/forge.json (${Object.keys(JSON.parse(fs.readFileSync(forgeJson, 'utf8'))).join(', ')})`);
      const notices = await ctx.wb.notifications();
      for (const n of notices) evidence(`notification: ${n.message}`);
    },
  },
  {
    id: 2,
    title: 'First message: a streamed reply from the endpoint, recorded in the session .jsonl',
    async run(ctx) {
      const { dirs, evidence } = ctx;
      await stubReset(ctx);
      const chat = await openChat(ctx);
      const before = sessionFiles(dirs).length;
      const prompt = `hello from e2e ${Date.now()}`;
      await chat.send(prompt);
      evidence(`sent "${prompt}"`);
      ctx.firstPrompt = prompt;
      if (ctx.stubUrl) {
        await waitForReply(chat, prompt);
        evidence('assistant row shows the stub reply');
        const log = await stubLog(ctx);
        const models = [...new Set(log.map((e) => e.model))];
        assert(log.length > 0, 'the gateway saw no request');
        assert(!models.some((m) => /^claude-/.test(m)), `a claude-* id reached the gateway: ${models.join(', ')}`);
        evidence(`gateway saw ${log.length} request(s), model ids: ${models.join(', ')}, streamed: ${log.some((e) => e.stream)}`);
      } else {
        await chat.waitFor(`document.querySelectorAll('.fg-chat__messagesContainer .fg-chat__timelineMessage').length > 0`, { timeoutMs: 120_000, label: 'an assistant row' });
        evidence('assistant row appeared');
      }
      const files = await waitUntil(() => {
        const all = sessionFiles(dirs);
        return all.length > before && all.find((f) => fs.readFileSync(f, 'utf8').includes(prompt));
      }, { label: 'the session .jsonl with the prompt' });
      evidence(`session file: ${path.relative(dirs.home, files)}`);
      assert(!fs.existsSync(path.join(dirs.home, '.claude', 'settings.json')), '~/.claude/settings.json appeared after the first message');
      evidence('~/.claude/settings.json still absent after the first turn');
    },
  },
  {
    id: 3,
    title: 'History and resume: a second conversation, the list, reopening the first, continuing it in the same file',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      if (!sessionFiles(dirs).length) await turn(chat, `hello from e2e ${Date.now()}`);
      const first = sessionFiles(dirs)[0];
      const firstPrompt = /hello from e2e \d+/.exec(fs.readFileSync(first, 'utf8'))?.[0];
      assert(firstPrompt, 'no first conversation to resume');
      await newSession(chat);
      const second = `second conversation ${Date.now()}`;
      await turn(chat, second);
      evidence(`new session, replied: "${second}"`);
      const rows = await openHistory(chat);
      assert(rows.some((r) => r.includes(firstPrompt)) && rows.some((r) => r.includes(second)), `history rows: ${rows.join(' / ')}`);
      evidence(`history lists ${rows.length} conversation(s), both present`);
      await chat.click('.fg-sessions__sessionItem .fg-sessions__sessionName', { text: firstPrompt });
      await chat.waitFor(`document.querySelector('.fg-chat__messagesContainer')?.textContent.includes(${JSON.stringify(firstPrompt)})`, { label: 'the first conversation' });
      evidence('reopened the first conversation from the list: its transcript is shown');
      const follow = `follow-up ${Date.now()}`;
      await turn(chat, follow);
      const resumed = sessionWith(dirs, follow);
      assert(resumed === first, `the follow-up went to ${resumed && path.basename(resumed)}, not the first conversation's ${path.basename(first)}`);
      evidence(`the follow-up was appended to the same file (${path.basename(first)})`);
      const log = await stubLog(ctx);
      const last = log.at(-1);
      assert(last.lastUser.includes(follow) && last.messages >= 3, `the resumed request carried ${last.messages} message(s)`);
      evidence(`the gateway got the resumed history: ${last.messages} messages in the last request`);
    },
  },
  {
    id: 4,
    title: 'The slash list: the real CLI\'s commands in the "/" menu, and one run end to end',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const chat = await openChat(ctx);
      const rows = await slashMenu(ctx, chat, '/');
      const slash = rows.filter((r) => r.label.startsWith('/'));
      assert(slash.length >= 10, `only ${slash.length} slash rows`);
      evidence(`${slash.length} slash commands from the CLI (e.g. ${slash.slice(0, 6).map((r) => r.label).join(' ')})`);
      const outOfScope = ['/feedback', '/bug', '/btw', '/remote-control', '/login', '/logout'].filter((c) => slash.some((r) => r.label === c));
      assert(!outOfScope.length, `out-of-scope rows shown: ${outOfScope.join(', ')}`);
      evidence('no out-of-scope row (/feedback /bug /btw /remote-control /login /logout)');
      // Run /compact on a conversation with a few turns: the CLI summarises
      // through the gateway and writes a compact boundary.
      await wb.key('Escape');
      await newSession(chat);
      for (let i = 0; i < 2; i++) await turn(chat, `compact me ${i} ${Date.now()}`);
      const file = sessionFiles(dirs).at(-1);
      // As a user types it: "/compact", Enter picks the completion, Enter sends.
      await chat.compose('/compact');
      await chat.waitFor(`document.querySelector('.dropdown-popover .dropdown-menu-item')`, { label: 'the slash completion' });
      await wb.key('Enter');
      const picked = await chat.evaluate(`return document.querySelector('.fg-composer__messageInput').textContent.trim()`);
      assert(picked === '/compact', `Enter on "/compact" picked "${picked}"`);
      evidence('"/compact" + Enter picks /compact (exact name ranks first)');
      await wb.key('Enter');
      await chat.waitFor(`!document.querySelector('.fg-composer__messageInput').textContent.trim()`, { label: 'the composer to send' });
      evidence('sent "/compact"');
      await waitUntil(() => fs.readFileSync(file, 'utf8').includes('compact_boundary'), { label: 'a compact boundary in the session file', timeoutMs: 90_000 });
      evidence(`the CLI wrote a compact_boundary to ${path.basename(file)}`);
      await waitForIdle(chat);
      const api = slash.find((r) => r.label === '/claude-api');
      if (api) {
        assert(!/Forge API/.test(api.title), `"/claude-api" reads: ${api.title.slice(0, 60)}`);
        evidence(`"/claude-api" keeps the product name: "${api.title.slice(0, 50)}"`);
      }
    },
  },
  {
    id: 5,
    title: 'Editor selection: <ide_selection> reaches the CLI and the session .jsonl',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const chat = await openChat(ctx);
      await newSession(chat);
      await wb.runCommand('Go to File...');
      await wb.type('readme.txt');
      await sleep(800);
      await wb.key('Enter');
      // Monaco draws spaces as U+00A0.
      await wb.waitFor(`document.querySelector('.editor-instance .monaco-editor .view-lines')?.textContent.replace(/\u00a0/g, ' ').includes('line two')`, { label: 'readme.txt in an editor' });
      await wb.runCommand('Go to Line/Column...');
      await wb.type('2');
      await wb.key('Enter');
      await wb.key('Home');
      await wb.key('End', 8);
      await sleep(800);
      const chip = await chat.evaluate(`return document.querySelector('.fg-composer__inputWrapper')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
      evidence(`composer shows: "${chip.slice(0, 80)}"`);
      const prompt = `what is selected ${Date.now()}`;
      await turn(chat, prompt);
      const file = sessionWith(dirs, prompt);
      const text = fs.readFileSync(file, 'utf8');
      assert(/ide_selection/.test(text) && text.includes('line two'), 'no <ide_selection> with "line two" in the session file');
      evidence(`${path.basename(file)} holds <ide_selection> with "line two"`);
      const last = (await stubLog(ctx)).at(-1);
      assert(last.lastUser.includes('line two'), 'the gateway did not receive the selection');
      evidence('the gateway received the selected text');
    },
  },
  {
    id: 6,
    title: 'Permission prompt option 2 writes its rule; Plan mode presents the plan and approving it leaves Plan',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const chat = await openChat(ctx);
      await newSession(chat);
      await setMode(chat, 'Manual');
      // A command the CLI asks about (it allows read-only ones like `echo` on its own).
      const marker = `e2e-perm-${Date.now()}`;
      const touched = path.join(dirs.workspace, `${marker}.txt`);
      await chat.send(`run :: touch ${touched}`);
      await chat.waitFor(`document.querySelector('.fg-permission__permissionRequestContainer')`, { label: 'the permission prompt', timeoutMs: 60_000 });
      // The official's guard (`P`): the buttons ignore input for 500 ms.
      await sleep(700);
      const buttons = await chat.evaluate(`return [...document.querySelectorAll('.fg-permission__button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())`);
      evidence(`prompt options: ${buttons.join(' | ')}`);
      // The number, not the middle: option 2's middle is its save-destination link.
      await chat.click('.fg-permission__button .fg-permission__shortcutNum', { index: 1 });
      await waitForReply(chat, 'Done: Bash');
      const local = path.join(dirs.workspace, '.claude', 'settings.local.json');
      const rules = await waitUntil(() => fs.existsSync(local) && JSON.parse(fs.readFileSync(local, 'utf8')).permissions?.allow, { label: `an allow rule in ${local}` });
      assert(rules.some((r) => r.includes('touch')), `allow rules: ${JSON.stringify(rules)}`);
      evidence(`.claude/settings.local.json permissions.allow: ${JSON.stringify(rules)}`);
      assert(fs.existsSync(touched), `${touched} was not created`);
      evidence(`the command ran: ${path.basename(touched)} exists`);

      // Plan mode: the model presents a plan (ExitPlanMode); approving it
      // leaves Plan mode.
      await setMode(chat, 'Plan');
      const plan = `E2E plan ${Date.now()}: change nothing`;
      await chat.send(`plan :: ${plan}`);
      await chat.waitFor(`document.body.innerText.includes(${JSON.stringify(plan)}) && document.querySelector('.fg-permission__permissionRequestContainer')`, { label: 'the plan approval', timeoutMs: 60_000 });
      await sleep(700);
      const planButtons = await chat.evaluate(`return [...document.querySelectorAll('.fg-permission__button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())`);
      evidence(`plan prompt: ${planButtons.join(' | ')}`);
      await chat.click('.fg-permission__button .fg-permission__shortcutNum', { index: 0 });
      await waitForReply(chat, 'Done: ExitPlanMode');
      const mode = await currentMode(chat);
      assert(mode !== 'Plan', 'still in Plan mode after approving the plan');
      evidence(`approved: mode is now "${mode}"`);
      await setMode(chat, 'Manual');
    },
  },
  {
    id: 7,
    title: 'Effort and thinking: saved where the official saves them, and each reaches the gateway',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      await newSession(chat);
      const lastEffort = async () => (await stubLog(ctx)).at(-1).reasoning_effort;

      // 1. A middle rung, thinking on: that rung reaches the gateway.
      await setThinking(ctx, chat, true);
      const middle = (await setEffortAt(ctx, chat, 0.5)).toLowerCase();
      await turn(chat, `effort ${middle} ${Date.now()}`);
      assert((await lastEffort()) === middle, `effort ${middle} sent reasoning_effort ${await lastEffort()}`);
      evidence(`effort "${middle}", thinking on: the gateway got reasoning_effort "${middle}"`);
      await chat.waitFor(`document.querySelector('.fg-chat__messagesContainer')?.innerText.includes('Thinking')`, { label: 'a thinking block', timeoutMs: 10_000 });
      evidence('the transcript shows the thinking block');

      // 2. Thinking off: the weakest rung, whatever the effort.
      await setThinking(ctx, chat, false);
      await turn(chat, `thinking off ${Date.now()}`);
      assert((await lastEffort()) === 'low' && middle !== 'low', `thinking off sent ${await lastEffort()}`);
      evidence(`thinking off: the gateway got reasoning_effort "low" (was "${middle}")`);
      await setThinking(ctx, chat, true);

      // 3. The lowest rung: saved to the official layer, and sent.
      const lowest = (await setEffortAt(ctx, chat, 0)).toLowerCase();
      const userSettings = path.join(dirs.home, '.claude', 'settings.json');
      const saved = await waitUntil(() => fs.existsSync(userSettings) && JSON.parse(fs.readFileSync(userSettings, 'utf8')).effortLevel === lowest && lowest, { label: `effortLevel ${lowest} in ~/.claude/settings.json` });
      evidence(`~/.claude/settings.json effortLevel: "${saved}" (the official userSettings layer)`);
      await turn(chat, `effort ${lowest} ${Date.now()}`);
      assert((await lastEffort()) === lowest, `effort ${lowest} sent reasoning_effort ${await lastEffort()}`);
      evidence(`effort "${lowest}": the gateway got reasoning_effort "${lowest}"`);
    },
  },
  {
    id: 8,
    title: 'Rewind changes files on disk; fork continues in a new session file',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      await newSession(chat);
      await setMode(chat, 'Edit automatically');
      const target = path.join(dirs.workspace, `rewind-${Date.now()}.txt`);
      await turn(chat, `baseline ${Date.now()}`);
      await chat.send(`write ${target} :: v1`);
      await waitForReply(chat, 'Done: Write');
      await waitUntil(() => fs.existsSync(target) && fs.readFileSync(target, 'utf8') === 'v1', { label: `${target} with v1` });
      evidence(`the model wrote ${path.basename(target)} ("v1")`);

      await messageAction(chat, -1, 'Rewind code to here');
      const dialog = await chat.waitFor(`document.querySelector('.fg-dialog__actions button') && { text: document.querySelector('.fg-dialog__content')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 120), disabled: document.querySelector('.fg-dialog__actions button').disabled }`, { label: 'the rewind dialog' });
      evidence(`dry-run dialog: "${dialog.text}"`);
      assert(!dialog.disabled, 'Rewind is disabled although the message changed a file');
      await chat.click('.fg-dialog__actions button');
      await waitUntil(() => !fs.existsSync(target), { label: `${path.basename(target)} removed by the rewind`, timeoutMs: 20_000 });
      evidence(`rewound: ${path.basename(target)} is gone from disk`);

      const original = sessionFiles(dirs).at(-1);
      const before = new Set(sessionFiles(dirs));
      await messageAction(chat, -1, 'Fork conversation from here');
      // The fork holds the history before that message and puts the message
      // back in the composer, as the official does.
      const draft = await chat.waitFor(`document.querySelector('.fg-composer__messageInput')?.textContent.trim()`, { label: 'the forked message in the composer' });
      assert(draft.includes(path.basename(target)), `composer after fork: "${draft.slice(0, 60)}"`);
      evidence(`fork: the composer holds the forked message ("${draft.slice(0, 50)}…")`);
      await chat.click('.fg-composer__messageInput');
      await ctx.wb.key('a', 2);
      await ctx.wb.key('Backspace');
      const next = `after fork ${Date.now()}`;
      await turn(chat, next);
      const forked = sessionWith(dirs, next);
      assert(forked && !before.has(forked), `the fork wrote to ${forked && path.basename(forked)}, an existing file`);
      assert(!fs.readFileSync(original, 'utf8').includes(next), 'the fork also wrote to the original');
      evidence(`forked: "${next}" went to a new file ${path.basename(forked)}; the original is untouched`);
      await setMode(chat, 'Manual');
    },
  },
  {
    id: 9,
    title: 'Rename, archive, mark unread: written where the official writes them, and still so after a reload',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb, host } = ctx;
      let chat = await openChat(ctx);
      // Three conversations of our own to act on.
      const names = [];
      for (const n of ['rename', 'archive', 'unread']) {
        await newSession(chat);
        const prompt = `to ${n} ${Date.now()}`;
        await turn(chat, prompt);
        names.push(prompt);
      }
      const [toRename, toArchive, toUnread] = names;
      await newSession(chat);
      await openHistory(chat);

      const title = `E2E renamed ${Date.now()}`;
      await rowAction(ctx, chat, toRename, 'Rename session');
      await chat.waitFor(`document.querySelector('.fg-sessions__sessionNameEditing')`, { label: 'the rename field' });
      await wb.key('a', 2);
      await wb.type(title);
      await wb.key('Enter');
      const renamedFile = sessionWith(dirs, toRename);
      await waitUntil(() => fs.readFileSync(renamedFile, 'utf8').includes(title), { label: 'the new title in the session file' });
      const titleLine = fs.readFileSync(renamedFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => JSON.stringify(e).includes(title));
      evidence(`renamed: ${path.basename(renamedFile)} gained a "${titleLine.type}" entry "${title}"`);

      await rowAction(ctx, chat, toArchive, 'Archive session');
      await chat.waitFor(`![...document.querySelectorAll('.fg-sessions__sessionItem .fg-sessions__sessionName')].some(e => e.textContent.includes(${JSON.stringify(toArchive)}))`, { label: 'the archived row to leave the list' });
      evidence('archived: the row left the list');
      await wb.key('Escape');

      // Unread and its dot live in the session manager, as the official's do
      // (the dropdown's QW0 mount passes no status feeds). Phase 6.
      let sm = await openManager(ctx);
      await managerMenu(ctx, sm, toUnread, 'Mark as unread');
      const dotOf = `[...document.querySelectorAll('.fg-sessions__sessionItem')].find(r => r.textContent.includes(${JSON.stringify(toUnread)}))?.querySelector('[data-status-dot]')?.getAttribute('data-status-dot')`;
      const dot = await sm.waitFor(`${dotOf} === 'unread' && 'unread'`, { label: 'the unread dot' });
      evidence(`marked unread in the session manager: the row's status dot is "${dot}"`);

      await host.reload();
      await wb.ready();
      chat = await openChat(ctx);
      const rows = await openHistory(chat);
      assert(rows.includes(title), `after reload the list has no "${title}"`);
      assert(!rows.some((r) => r.includes(toArchive)), 'after reload the archived conversation is back');
      await closeHistory(ctx, chat);
      sm = await openManager(ctx);
      const dotAfter = await sm.evaluate(`return ${dotOf}`);
      assert(dotAfter === 'unread', `after reload the unread dot is "${dotAfter}"`);
      evidence('after a window reload: the new title, the archive and the unread dot all held');
    },
  },
  {
    id: 10,
    title: 'A message sent mid-turn, then Stop: the turn ends and the interrupt is recorded',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      // No editor left open by an earlier scenario: an open file puts its name
      // in the footer's selection chip, and in a narrow side bar that squeezes
      // the mode button until its icon overlaps the Stop button (the ported
      // official layout does the same), so the click would land on the mode
      // button instead. This scenario is about Stop, not about that layout.
      await wb.runCommand('View: Close All Editor Groups');
      await sleep(500);
      const chat = await openChat(ctx);
      await newSession(chat);
      const slow = `slow 9000 ${Date.now()}`;
      await chat.send(slow);
      await chat.waitFor(`document.querySelector('.fg-footer__stopIcon')`, { label: 'the turn to start' });
      const queued = `queued mid-turn ${Date.now()}`;
      await chat.send(queued);
      await chat.waitFor(`document.body.innerText.includes(${JSON.stringify(queued)})`, { label: 'the mid-turn message shown', timeoutMs: 5_000 });
      evidence('the mid-turn message is shown while the turn runs');
      const stopAt = Date.now();
      await chat.click('.fg-footer__sendButton');
      await waitForIdle(chat, { timeoutMs: 15_000 });
      evidence(`Stop: the turn ended ${Date.now() - stopAt} ms after the click`);
      const file = await waitUntil(() => sessionWith(dirs, slow), { label: 'the session file' });
      await waitUntil(() => /interrupted/i.test(fs.readFileSync(file, 'utf8')), { label: 'an interrupt entry in the session file' });
      evidence(`${path.basename(file)} records the interrupt`);
      await sleep(4000);
      const sent = (await stubLog(ctx)).some((e) => e.lastUser.includes(queued));
      evidence(`the mid-turn message ${sent ? 'was sent to the gateway after the stop' : 'was not sent after the stop'}`);
      await waitForIdle(chat, { timeoutMs: 60_000 });
    },
  },
  {
    id: 11,
    title: 'Output styles, forge:Expert included: saved to the local layer and applied to the system prompt',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      const local = path.join(dirs.workspace, '.claude', 'settings.local.json');
      for (const [style, phrase] of [['Explanatory', 'Insight'], ['forge:Expert', 'master teacher']]) {
        await newSession(chat);
        await pickOutputStyle(ctx, chat, style);
        const saved = await waitUntil(() => fs.existsSync(local) && JSON.parse(fs.readFileSync(local, 'utf8')).outputStyle === style && style, { label: `outputStyle ${style} in settings.local.json` });
        evidence(`chose ${saved}: .claude/settings.local.json outputStyle = "${saved}"`);
        const prompt = `style probe ${style} ${Date.now()}`;
        await turn(chat, prompt);
        const log = await (await fetch(`${ctx.stubUrl}/__log?system=1`)).json();
        const entry = log.findLast((e) => e.lastUser.includes(prompt));
        assert(entry?.system.includes(phrase), `the system prompt for ${style} lacks "${phrase}"`);
        evidence(`the gateway's system prompt carries the ${style} text ("${phrase}")`);
      }
      await pickOutputStyle(ctx, chat, 'default');
    },
  },
  {
    id: 12,
    title: 'Settings page: each layer writes its own file',
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      await wb.runCommand('Forge: Open Settings');
      const settings = await wb.forge({ test: `document.querySelector('.cursor-settings-pane-content input[placeholder^="e.g. japanese"]')`, label: 'the Settings page' });
      const files = {
        User: path.join(dirs.home, '.claude', 'settings.json'),
        Workspace: path.join(dirs.workspace, '.claude', 'settings.json'),
        Local: path.join(dirs.workspace, '.claude', 'settings.local.json'),
      };
      const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
      const stamp = Date.now();
      await settings.waitFor(`document.querySelectorAll('.scope-tab-trigger').length === 3`, { label: 'the User / Workspace / Local switch' });
      for (const layer of Object.keys(files)) {
        await settings.click('.scope-tab-trigger', { text: layer });
        await settings.waitFor(`[...document.querySelectorAll('.scope-tab-trigger')].find(t => t.textContent.includes(${JSON.stringify(layer)}))?.getAttribute('aria-selected') === 'true'`, { label: `the ${layer} layer selected` });
        const value = `e2e-${layer.toLowerCase()}-${stamp}`;
        await settings.click('input[placeholder^="e.g. japanese"]');
        await wb.key('a', 2);
        await wb.type(value);
        await wb.key('Tab');
        await waitUntil(() => read(files[layer]).language === value, { label: `language in the ${layer} file` });
        evidence(`${layer}: language "${value}" -> ${path.relative(dirs.root, files[layer])}`);
      }
      for (const [layer, file] of Object.entries(files)) {
        assert(read(file).language === `e2e-${layer.toLowerCase()}-${stamp}`, `${layer} file changed by another layer's write`);
      }
      evidence('each layer kept its own value (no write crossed layers)');
      await wb.runCommand('View: Close Editor');
    },
  },
  {
    id: 14,
    title: 'Reload: effort, thinking, output style and history survive a window reload',
    async run(ctx) {
      const { dirs, evidence, wb, host } = ctx;
      let chat = await openChat(ctx);
      const pill = () => chat.evaluate(`return document.querySelector('.fg-footer__modelPill')?.innerText.replace(/\\s+/g, ' ').trim()`);
      const beforePill = await pill();
      const beforeRows = await openHistory(chat);
      await closeHistory(ctx, chat);
      await slashMenu(ctx, chat);
      const thinkingBefore = await chat.evaluate(`return !![...document.querySelectorAll('.fg-commandmenu__commandItem')].find(e => /^Thinking/.test(e.innerText))?.querySelector('.fg-toggle__trackOn')`);
      await ctx.wb.key('Escape');
      await host.reload();
      await wb.ready();
      chat = await openChat(ctx);
      // The pill draws "Model" until the config arrives; wait for the real value.
      const afterPill = await chat
        .waitFor(`(() => { const p = document.querySelector('.fg-footer__modelPill')?.innerText.replace(/\\s+/g, ' ').trim(); return p === ${JSON.stringify(beforePill)} && p; })()`, { label: `the model pill to read "${beforePill}"`, timeoutMs: 20_000 })
        .catch(async () => pill());
      assert(afterPill === beforePill, `model pill "${beforePill}" -> "${afterPill}"`);
      evidence(`model and effort: "${afterPill}" before and after`);
      await slashMenu(ctx, chat);
      const thinkingAfter = await chat.evaluate(`return !![...document.querySelectorAll('.fg-commandmenu__commandItem')].find(e => /^Thinking/.test(e.innerText))?.querySelector('.fg-toggle__trackOn')`);
      await ctx.wb.key('Escape');
      assert(thinkingAfter === thinkingBefore, `thinking ${thinkingBefore} -> ${thinkingAfter}`);
      evidence(`thinking: ${thinkingAfter ? 'on' : 'off'} before and after`);
      // A reload keeps what is on disk. Conversations that exist only in the
      // webview (a new one never sent, one whose launch failed) are not
      // expected to survive it, so the check is against the session files.
      // A row's title may change with the reload: the live list shows the
      // first prompt, the SDK's `listSessions` the custom title or the last
      // prompt (as the official lists them), so each saved conversation is
      // matched under any title it can carry.
      const afterRows = await openHistory(chat);
      const saved = sessionTitleSets(dirs).filter((titles) => beforeRows.some((row) => titles.has(row)));
      const lost = saved.filter((titles) => !afterRows.some((row) => titles.has(row)));
      assert(!lost.length, `after reload the list lost ${lost.map((t) => [...t][0]).join(' / ')}`);
      evidence(`history: all ${saved.length} saved conversations listed before and after (${beforeRows.length} -> ${afterRows.length} rows)`);
      await closeHistory(ctx, chat);
    },
  },
  {
    id: 16,
    title: 'Open in Terminal runs the CLI through the endpoint; the "+" menu; a failed @browser attach says why',
    async run(ctx) {
      const { evidence, wb, dirs } = ctx;
      const chat = await openChat(ctx);
      // Paused for now (terminalAvailability.ts): the row is greyed out with
      // "(soon)", and choosing it opens nothing.
      await slashMenu(ctx, chat);
      const row = await chat.evaluate(`const r = [...document.querySelectorAll('.fg-commandmenu__commandItem')].find(e => e.textContent.includes('Open Forge in Terminal')); return r ? { soon: r.getAttribute('aria-disabled') === 'true', text: r.textContent.trim(), opacity: getComputedStyle(r).opacity } : null`);
      assert(row, 'no "Open Forge in Terminal" row');
      if (row.soon) {
        fs.mkdirSync(path.join(dirs.root, 'report', 'terminal'), { recursive: true });
        await wb.screenshot(path.join(dirs.root, 'report', 'terminal', 'paused-row.png'));
        const terminalsBefore = await wb.evaluate(`return document.querySelectorAll('.terminal-tabs-entry, .single-terminal-tab').length`);
        await chat.click('.fg-commandmenu__commandItem', { text: 'Open Forge in Terminal' });
        await sleep(3000);
        const terminalsAfter = await wb.evaluate(`return document.querySelectorAll('.terminal-tabs-entry, .single-terminal-tab').length`);
        assert(/\(soon\)/.test(row.text) && Number(row.opacity) < 1, `the row is not greyed out with (soon): ${JSON.stringify(row)}`);
        assert(terminalsAfter === terminalsBefore, 'choosing the paused row opened a terminal');
        evidence(`"/" menu: "${row.text}" greyed out (opacity ${row.opacity}); choosing it opened no terminal`);
        await closeSlashMenu(ctx, chat);
      } else {
        await closeSlashMenu(ctx, chat);
        const cliBefore = cliProcesses(dirs);
        await slashMenu(ctx, chat);
        await chat.click('.fg-commandmenu__commandItem', { text: 'Open Forge in Terminal' });
        await wb.waitFor(`[...document.querySelectorAll('.tabs-container .tab, .terminal-tabs-entry, .single-terminal-tab')].some(t => /Forge/.test(t.textContent) || /Forge/.test(t.getAttribute('aria-label') ?? ''))`, { label: 'a terminal named Forge', timeoutMs: 20_000 });
        evidence('a terminal named "Forge" opened');
        const started = await waitUntil(() => cliProcesses(dirs).find((p) => !cliBefore.some((b) => b.pid === p.pid) && !p.args.includes('stream-json')), { label: 'an interactive CLI process', timeoutMs: 30_000 });
        evidence(`the terminal runs the bundled CLI (pid ${started.pid}${started.baseUrl ? `, ANTHROPIC_BASE_URL ${started.baseUrl}` : ''})`);
        assert(!started.baseUrl || /127\.0\.0\.1|localhost/.test(started.baseUrl), `the terminal CLI goes to ${started.baseUrl}`);

        // What the user sees, in the real terminal (xterm.js): the banner and the
        // CLI once it is up, then after one turn (the status line updates).
        const shots = path.join(dirs.root, 'report', 'terminal');
        fs.mkdirSync(shots, { recursive: true });
        await wb.runCommand('View: Toggle Maximized Panel').catch(() => {});
        const screen = () => wb.evaluate(`return [...document.querySelectorAll('.xterm-rows > div')].map(r => r.textContent).join('\\n')`);
        await sleep(6000);
        await wb.screenshot(path.join(shots, '0-first-screen.png'));
        await wb.runCommand('Terminal: Focus Terminal').catch(() => {});
        // A fresh profile gets Claude Code's own first-run screens (the theme,
        // the folder trust): Enter through them, as a first-time user would.
        // Forge must add none of its own: no question about the relay's token.
        let seen = '';
        for (let i = 0; i < 8; i++) {
          const text = await screen();
          seen += text;
          if (/▛◆ Forge/.test(text) && !/Enter to confirm|Press Enter|Yes, I trust/i.test(text)) break;
          // The folder-trust question defaults to "No, exit".
          if (/Yes, I trust this folder/.test(text)) await wb.key('ArrowDown');
          await wb.key('Enter');
          await sleep(2500);
        }
        assert(!seen.includes('Detected a custom API key'), 'the CLI asked whether to use an API key');
        assert(!seen.includes("isn't described by this version's model catalog"), 'the CLI printed its unknown-model notice');
        await sleep(1500);
        await wb.screenshot(path.join(shots, '1-start.png'));
        await wb.type('hello from the terminal');
        await wb.key('Enter');
        await waitUntil(async () => (await screen()).includes('Stub reply'), { label: 'the stub\'s answer in the terminal', timeoutMs: 60_000 }).catch(() => {});
        await sleep(3000);
        await wb.screenshot(path.join(shots, '2-after-turn.png'));
        const text = await screen();
        fs.writeFileSync(path.join(shots, 'screen.txt'), text);
        assert(/▛◆ Forge/.test(text), 'no Forge status line in the terminal');

        // Every launch after the first: no onboarding, so this is the everyday
        // view -- the banner, one short launch line, Claude Code's box, the
        // welcome line, the prompt and the status line.
        await wb.runCommand('Terminal: Kill All Terminals');
        await sleep(1500);
        await slashMenu(ctx, chat);
        await chat.click('.fg-commandmenu__commandItem', { text: 'Open Forge in Terminal' });
        // No keystroke until the CLI is up: a key pressed while the shell is
        // still starting lands in its input and eats the command's first letter.
        await waitUntil(async () => /▛◆ Forge/.test(await screen()), { label: 'the status line on the second launch', timeoutMs: 45_000 });
        // Maximized, checked: the toggle is a toggle.
        const panelTall = () => wb.evaluate(`return (document.querySelector('.part.panel')?.getBoundingClientRect().height ?? 0) > window.innerHeight * 0.6`);
        for (let i = 0; i < 2 && !(await panelTall()); i++) {
          await wb.runCommand('View: Toggle Maximized Panel').catch(() => {});
          await sleep(1200);
        }
        await sleep(1500);
        await wb.screenshot(path.join(shots, '3-second-launch.png'));
        // The banner is the first thing in the buffer: scroll up to read it.
        await wb.runCommand('Terminal: Scroll to Top').catch(() => {});
        await sleep(800);
        await wb.screenshot(path.join(shots, '4-second-launch-top.png'));
        const again = await screen();
        fs.writeFileSync(path.join(shots, 'screen-second.txt'), again);
        assert(again.includes('Claude Code, reforged.'), 'the Forge banner is not on screen on the second launch');
        assert(!again.includes('Detected a custom API key'), 'the second launch asked about an API key');
        evidence(`terminal: no API-key question, no unknown-model notice, the Forge status line up (${(text.split('\n').find((l) => l.includes('▛◆ Forge')) ?? '').trim()}); screenshots in report/terminal/`);
        await wb.runCommand('View: Toggle Maximized Panel').catch(() => {});
        await wb.runCommand('Terminal: Kill All Terminals');
      }

      await chat.click('.fg-addmenu__addButton');
      await chat.waitFor(`document.querySelector('.fg-addmenu__menuItemLabel')`, { label: 'the "+" menu' });
      const rows = await chat.evaluate(`return [...document.querySelectorAll('.fg-addmenu__menuItemLabel')].map(e => e.textContent.trim())`);
      await wb.key('Escape');
      // Forge offers the row whenever the bundled CLI resolves (step 28: the
      // browser MCP server is that binary). Whether the attach then works needs
      // the Claude in Chrome extension, which this host does not have.
      evidence(`"+" menu: ${rows.join(' / ')}`);
      assert(rows.includes('Browse the web'), 'no "Browse the web" row');

      // Without the extension the attach fails; the chat says why, in the
      // browser server's own words, and keeps the message (Phase 6, item 4).
      const typed = `@browser:new_tab look at example.com ${Date.now()}`;
      await chat.compose(typed);
      await wb.key('Enter');
      const banner = await chat.waitFor(`document.querySelector('.fg-chat__errorBanner .fg-chat__errorMessage')?.textContent`, { label: 'the attach error', timeoutMs: 60_000 });
      assert(/^Couldn't attach a browser tab: Browser extension is not connected/.test(banner), `banner: ${banner.slice(0, 200)}`);
      evidence(`the attach failed and the chat said why: "${banner.split('View output logs')[0].trim().slice(0, 170)}…"`);
      const kept = await chat.evaluate(`return document.querySelector('.fg-composer__messageInput')?.textContent ?? ''`);
      assert(kept.includes(typed), `the composer holds "${kept.slice(0, 80)}"`);
      evidence('the message is back in the composer, not lost');
      await chat.click('.fg-chat__errorDismiss').catch(() => {});
      await chat.click('.fg-composer__messageInput');
      await wb.key('a', 2);
      await wb.key('Backspace');
      evidence('a successful attach needs the Claude in Chrome extension: on the Windows checklist');
      return 'partial';
    },
  },
  {
    id: 17,
    title: 'Errors: the gateway down, then back; the CLI binary missing',
    needs: ['stub'],
    timeoutSec: 420,
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      const control = (body) => fetch(`${ctx.stubUrl}/__control`, { method: 'POST', body: JSON.stringify(body) });

      // (a) The gateway resets every connection.
      await newSession(chat);
      await control({ down: true });
      const started = Date.now();
      try {
        await chat.send(`while down ${Date.now()}`);
        const shown = await chat.waitFor(
          `(() => { const t = document.querySelector('.fg-chat__messagesContainer')?.innerText ?? ''; const b = document.querySelector('.fg-chat__errorBanner')?.innerText ?? ''; const m = /(error|failed|unable|connect|refused|reset)[^\\n]{0,160}/i.exec(b + '\\n' + t); return !document.querySelector('.fg-footer__stopIcon') && m && m[0]; })()`,
          { label: 'an error shown and the turn over', timeoutMs: 300_000 },
        );
        evidence(`gateway down: after ${Math.round((Date.now() - started) / 1000)}s the chat shows "${shown.slice(0, 120)}" and the turn is over`);
      } finally {
        await control({ down: false });
      }
      const back = `after recovery ${Date.now()}`;
      await turn(chat, back);
      evidence('gateway back: the next message is answered in the same conversation');

      // (b) The CLI binary is gone (a damaged install).
      const binary = cliBinary(dirs);
      const aside = `${binary}.e2e-aside`;
      fs.renameSync(binary, aside);
      try {
        await newSession(chat);
        await chat.send(`without a binary ${Date.now()}`);
        const banner = await chat.waitFor(`document.querySelector('.fg-chat__errorBanner')?.innerText`, { label: 'the error banner', timeoutMs: 60_000 });
        // Windows x64 and Linux x64: "The Claude Code binary is missing from
        // this Forge install"; elsewhere the platform notice says there is no binary.
        assert(/binary is missing|no Claude Code binary/i.test(banner), `banner: ${banner}`);
        evidence(`binary missing: the banner reads "${banner.replace(/\s+/g, ' ').slice(0, 140)}"`);
      } finally {
        fs.renameSync(aside, binary);
      }
      await chat.click('.fg-chat__errorDismiss').catch(() => {});
      await newSession(chat);
      await turn(chat, `binary restored ${Date.now()}`);
      evidence('binary restored: a new conversation works again');
    },
  },
  {
    id: 18,
    title: 'Soak: 20 turns in one conversation',
    needs: ['stub'],
    timeoutSec: 600,
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      await newSession(chat);
      const errorsBefore = forgeLogErrors(dirs).length;
      const times = [];
      for (let i = 0; i < 20; i++) {
        const t = Date.now();
        await turn(chat, `soak turn ${i} ${Date.now()}`);
        times.push(Date.now() - t);
      }
      const sorted = [...times].sort((a, b) => a - b);
      evidence(`20/20 turns answered; latency p50 ${sorted[10]} ms, max ${sorted[19]} ms (first ${times[0]} ms, last ${times[19]} ms)`);
      const rows = await chat.evaluate(`return document.querySelectorAll('.fg-chat__messagesContainer .fg-chat__userMessageContainer.fg-chat__message').length`);
      assert(rows >= 20, `the transcript shows ${rows} user messages`);
      evidence(`the transcript holds all ${rows} user messages`);
      const errors = forgeLogErrors(dirs).slice(errorsBefore);
      assert(!errors.length, `Forge logged errors: ${errors.slice(0, 3).join(' / ')}`);
      evidence('no [error] line in the Forge output channel during the soak');
      assert(sorted[19] < Math.max(10 * sorted[10], 15_000), 'a turn took far longer than the median');
    },
  },
  {
    id: 19,
    title: 'Soak: open and close Forge tabs and conversations without leaking CLI processes',
    needs: ['stub'],
    timeoutSec: 600,
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const chat = await openChat(ctx);
      await newSession(chat);
      await sleep(3000);
      const baseline = cliProcesses(dirs).length;
      for (let i = 0; i < 6; i++) {
        const frames = (await wb.forgeFrames()).length;
        await wb.runCommand('Forge: Open in New Tab');
        const tab = await waitUntil(async () => {
          const all = await wb.forgeFrames();
          return all.length > frames && all;
        }, { label: 'the new Forge tab' });
        const handle = await wb.forge({ test: `document.querySelector('.fg-composer__messageInput') && document.hasFocus()`, timeoutMs: 20_000 }).catch(() => null);
        if (handle) await turn(handle, `tab ${i} ${Date.now()}`);
        await wb.runCommand('View: Close Editor');
        await sleep(1500);
      }
      await sleep(5000);
      const after = cliProcesses(dirs).length;
      evidence(`6 tabs opened, each answered a message, then closed; CLI processes ${baseline} -> ${after}`);
      assert(after <= baseline + 1, `CLI processes grew from ${baseline} to ${after}`);
    },
  },
  {
    id: 20,
    title: 'Bypass permissions: the confirmation writes the setting; the mode shows in deep red and runs without prompts',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const chat = await openChat(ctx);
      await newSession(chat);
      await dismissNotices(chat);
      await chat.click('.fg-menu__container button[title*="Shift+Tab"]');
      await chat.waitFor(`document.querySelector('.fg-menu__menuItemV2')`, { label: 'the mode menu' });
      if (process.platform !== 'win32' && process.getuid?.() === 0 && process.env.IS_SANDBOX !== '1') {
        // Claude Code refuses bypass as root, and with it every launch that
        // allows it; Forge applies the same rule (`bypassGate.ts`) and leaves
        // the row out. The unprompted run is only observable as a normal user.
        const rows = await chat.evaluate(`return [...document.querySelectorAll('.fg-menu__menuItemV2')].map(e => e.innerText.split('\\n')[0].trim())`);
        await ctx.wb.key('Escape');
        assert(!rows.includes('Bypass permissions'), `the Bypass row is offered as root: ${JSON.stringify(rows)}`);
        evidence(`running as root: the mode menu offers ${rows.join(' | ')}, no Bypass permissions (the CLI refuses it as root)`);
        evidence('the confirmation, the colours and the unprompted run are not observable as root: on the Windows checklist');
        return 'partial';
      }
      await chat.click('.fg-menu__menuItemV2', { text: 'Bypass permissions' });
      // The host asks with a modal (drawn in the DOM: window.dialogStyle custom).
      const dialog = await wb.waitFor(`document.querySelector('.monaco-dialog-box')?.innerText`, { label: 'the bypass confirmation', timeoutMs: 15_000 });
      assert(/Allow bypass permissions\?/.test(dialog), `dialog: ${dialog.slice(0, 80)}`);
      evidence('the host asked: "Allow bypass permissions?"');
      await clickWorkbench(wb, '.monaco-dialog-box .monaco-button', 'Allow bypass permissions');
      // A machine setting: desktop VS Code keeps it in User/settings.json,
      // code-server (a remote host to VS Code) in Machine/settings.json.
      const written = await waitUntil(() => settingsFiles(dirs).find((file) => readJson(file)['forge.allowDangerouslySkipPermissions'] === true), { label: 'forge.allowDangerouslySkipPermissions in the settings' });
      evidence(`${path.relative(dirs.userData, written)}: forge.allowDangerouslySkipPermissions = true`);
      try {
        await chat.waitFor(`document.querySelector('.fg-menu__container button[title*="Shift+Tab"]')?.innerText.trim() === 'Bypass permissions'`, { label: 'the footer in bypass' });
        await chat.compose('x');
        const colours = await chat.evaluate(`
          const probe = (v) => { const p = document.createElement('div'); p.style.color = v; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
          return {
            fill: getComputedStyle(document.querySelector('.fg-footer__sendButton')).backgroundColor,
            glyph: getComputedStyle(document.querySelector('.fg-menu__container button[title*="Shift+Tab"] .fg-modeTint')).color,
            red700: probe('var(--pajamas-red-700)'),
            red800: probe('var(--pajamas-red-800)'),
          };`);
        await ctx.wb.key('Backspace');
        assert(colours.fill === colours.red800 && colours.glyph === colours.red700, `colours: ${JSON.stringify(colours)}`);
        evidence(`send button ${colours.fill} (red-800), mode glyph ${colours.glyph} (red-700)`);

        const touched = path.join(dirs.workspace, `bypass-${Date.now()}.txt`);
        await chat.send(`run :: touch ${touched}`);
        await waitForReply(chat, 'Done: Bash');
        assert(fs.existsSync(touched), 'the command did not run');
        assert(!(await chat.evaluate(`return !!document.querySelector('.fg-permission__permissionRequestContainer')`)), 'a permission prompt came up in bypass');
        evidence(`in bypass the model ran "touch ${path.basename(touched)}" with no prompt`);
      } finally {
        // The setting applies to every launch; later scenarios run without it.
        const settings = readJson(written);
        delete settings['forge.allowDangerouslySkipPermissions'];
        fs.writeFileSync(written, JSON.stringify(settings, null, 2));
        await sleep(1500);
        await chat.click('.fg-chat__errorDismiss').catch(() => {});
        await setMode(chat, 'Manual').catch(() => {});
      }
    },
  },
  {
    id: 21,
    title: 'Expert: the style reaches the model through the session flag layer, survives a relaunch, and turns off',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      // "New session" on a conversation that is still empty keeps its idle
      // CLI rather than launching another, and the scenario before this one
      // can leave exactly that (20 stops early as root). The snapshot below
      // would then already hold this conversation's CLI, so leave an empty
      // conversation first.
      if (!(await chat.evaluate(`return !!document.querySelector('.fg-chat__messagesContainer .fg-chat__message')`))) {
        await turn(chat, `warm-up ${Date.now()}`);
      }
      // Before the new conversation: it launches its CLI straight away.
      const cliBefore = new Set(cliProcesses(dirs).map((p) => p.pid));
      await newSession(chat);
      const local = path.join(dirs.workspace, '.claude', 'settings.local.json');
      const localBefore = fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : '';
      const systemOf = async (prompt) => (await (await fetch(`${ctx.stubUrl}/__log?system=1`)).json()).findLast((e) => e.lastUser.includes(prompt))?.system ?? '';
      // A plain turn first: Expert then comes on mid-conversation, the case
      // where the CLI's system prompt is already fixed.
      const plain = `before expert ${Date.now()}`;
      await turn(chat, plain);
      assert(!(await systemOf(plain)).includes('master teacher'), 'the Expert text is there before Expert');
      await setMode(chat, 'Expert');
      const colours = await chat.evaluate(`
        const p = document.createElement('div'); p.style.color = 'var(--pajamas-orange-400)'; document.body.append(p); const gold = getComputedStyle(p).color; p.remove();
        return { glyph: getComputedStyle(document.querySelector('.fg-menu__container button[title*="Shift+Tab"] .fg-modeTint')).color, gold };`);
      assert(colours.glyph === colours.gold, `glyph ${colours.glyph}, gold ${colours.gold}`);
      evidence(`footer: "Expert", glyph ${colours.glyph} (orange-400, the gold token)`);
      const first = `expert on ${Date.now()}`;
      await turn(chat, first);
      assert((await systemOf(first)).includes('# Output Style: forge:Expert'), 'the Expert style did not reach the model');
      evidence('turned on after a plain turn: the next request carries "# Output Style: forge:Expert" and its text');
      assert((fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : '') === localBefore, 'Expert wrote .claude/settings.local.json');
      evidence('no settings file changed: the style is in the session flag layer only');

      // A relaunch: the CLI process ends, the next message starts a new one.
      const cli = cliProcesses(dirs).find((p) => !cliBefore.has(p.pid) && p.args.includes('stream-json'));
      assert(cli, 'no CLI process for this conversation');
      process.kill(cli.pid, 'SIGKILL');
      await waitUntil(() => !cliProcesses(dirs).some((p) => p.pid === cli.pid), { label: 'the CLI to exit' });
      await sleep(1500);
      await chat.click('.fg-chat__errorDismiss').catch(() => {});
      const second = `expert after relaunch ${Date.now()}`;
      await turn(chat, second);
      const relaunched = cliProcesses(dirs).find((p) => !cliBefore.has(p.pid) && p.pid !== cli.pid && p.args.includes('stream-json'));
      assert((await systemOf(second)).includes('master teacher'), 'after the relaunch the Expert style is gone');
      evidence(`CLI ${cli.pid} killed; the next message relaunched it${relaunched ? ` (pid ${relaunched.pid})` : ''} and the style was re-applied`);

      // Off mid-conversation: the CLI keeps its system prompt stable (the
      // sections are memoized for the prompt cache) and sends the change as a
      // notice instead, "The output style was reset to the default" (gTt(null)
      // in CLI 2.1.274), after the last "forge:Expert output style is active".
      await setMode(chat, 'Manual');
      const third = `expert off ${Date.now()}`;
      await turn(chat, third);
      const after = await systemOf(third);
      const reset = after.lastIndexOf('The output style was reset to the default');
      assert(reset >= 0 && reset > after.lastIndexOf('output style is active'), 'Manual: no reset notice after the last Expert reminder');
      evidence('Manual: the next request ends with the CLI\'s "The output style was reset to the default" notice');
    },
  },
  {
    id: 22,
    title: 'Session manager: groups, the collapsed section and "Start new session in this group" survive a reload',
    needs: ['stub'],
    async run(ctx) {
      const { evidence, wb, host } = ctx;
      let chat = await openChat(ctx);
      const first = `group me ${Date.now()}`;
      await newSession(chat);
      await turn(chat, first);
      const name = `E2E group ${Date.now() % 100000}`;

      let sm = await openManager(ctx);
      await sm.click('.fg-sessions__newGroupButton', { text: 'New group' });
      await sm.waitFor(`document.activeElement?.classList.contains('fg-sessions__groupNameEditing')`, { label: 'the group name field' });
      await wb.key('a', 2);
      await wb.type(name);
      await wb.key('Enter');
      await sm.waitFor(`[...document.querySelectorAll('.fg-sessions__groupName')].some(e => e.textContent.trim() === ${JSON.stringify(name)})`, { label: 'the new group' });
      await managerMenu(ctx, sm, first, ['Add to group', name]);
      const grouped = await sm.waitFor(`(() => { const h = [...document.querySelectorAll('.fg-sessions__groupHeader')].find(h => h.textContent.includes(${JSON.stringify(name)})); return h?.querySelector('.fg-sessions__groupCount')?.textContent.trim() === '1' && h.textContent; })()`, { label: 'the conversation in the group' });
      evidence(`"New group", named inline, then "Add to group ▸ ${name}": ${grouped.replace(/\s+/g, ' ').trim()}`);

      // "Start new session in this group": the chat opens a new conversation,
      // and the host puts it in the group once the CLI names its session.
      await managerMenu(ctx, sm, name, 'Start new session in this group', { header: true });
      chat = await openChat(ctx);
      const second = `joined the group ${Date.now()}`;
      await turn(chat, second);
      sm = await openManager(ctx);
      const joined = await sm.waitFor(`(() => { const h = [...document.querySelectorAll('.fg-sessions__groupHeader')].find(h => h.textContent.includes(${JSON.stringify(name)})); return h?.querySelector('.fg-sessions__groupCount')?.textContent.trim() === '2' && h.textContent; })()`, { label: 'the new conversation in the group', timeoutMs: 20_000 });
      evidence(`"Start new session in this group", then a message: the group reads "${joined.replace(/\s+/g, ' ').trim()}"`);

      // Collapse the whole section; it stays collapsed across the reload.
      await sm.click('.fg-sessionmanager__sectionToggle');
      await sm.waitFor(`document.querySelector('.fg-sessionmanager__sessionsBodyCollapsed')`, { label: 'the collapsed section' });

      await host.reload();
      await wb.ready();
      await ctx.wb.runCommand('Forge: Past Conversations');
      sm = await ctx.wb.forge({ test: `document.querySelector('.fg-sessionmanager__root .fg-sessionmanager__sectionToggle')`, label: 'the session manager' });
      await sleep(800);
      const stillCollapsed = await sm.evaluate(`return !!document.querySelector('.fg-sessionmanager__sessionsBodyCollapsed')`);
      assert(stillCollapsed, 'after reload the section is open again');
      await sm.click('.fg-sessionmanager__sectionToggle');
      await sm.waitFor(`document.querySelector('.fg-sessions__groupHeader')`, { label: 'the list' });
      const after = await managerGroups(sm);
      assert(after.includes(`${name} 2`), `after reload the groups read ${after.join(' / ')}`);
      evidence(`after a window reload: the section stayed collapsed and the groups read ${after.join(' / ')}`);

      await managerMenu(ctx, sm, name, 'Delete group', { header: true });
      await sm.waitFor(`![...document.querySelectorAll('.fg-sessions__groupName')].some(e => e.textContent.trim() === ${JSON.stringify(name)})`, { label: 'the group gone' });
      evidence('Delete group: the group is gone and its conversations are ungrouped');
    },
  },
  {
    id: 23,
    title: 'One VSIX for Windows and Linux: packaged on Windows, the Linux binaries carry no execute bit; Forge restores it',
    needs: ['stub', 'linux'],
    async run(ctx) {
      const { dirs, evidence, wb, host } = ctx;
      const ext = fs.readdirSync(dirs.extensions).find((d) => d.startsWith('msaid.forge-'));
      const binary = cliBinary(dirs);
      const rg = path.join(dirs.extensions, ext, 'resources', 'ripgrep', 'x64-linux', 'rg');
      const both = path.join(dirs.extensions, ext, 'resources', 'native-binaries');
      evidence(`installed: ${fs.readdirSync(both).map((t) => `${t}/${fs.readdirSync(path.join(both, t)).join(',')}`).join(' ')}; the Linux one is used (${path.relative(both, binary)})`);
      // What a VSIX packaged on Windows installs as: no execute bit anywhere.
      for (const file of [binary, rg]) fs.chmodSync(file, 0o644);
      const mode = (file) => (fs.statSync(file).mode & 0o777).toString(8);
      evidence(`stripped: claude ${mode(binary)}, rg ${mode(rg)}`);
      // A fresh extension host, which has not checked either file yet.
      await host.reload();
      await wb.ready();
      const chat = await openChat(ctx);
      await newSession(chat);
      await turn(chat, `no execute bit ${Date.now()}`);
      assert((fs.statSync(binary).mode & 0o111) === 0o111, `claude is ${mode(binary)} after a turn`);
      evidence(`a turn was answered, and claude is ${mode(binary)} again`);
      // `@` file search runs the bundled ripgrep.
      await chat.compose('@readm');
      const found = await chat.waitFor(`[...document.querySelectorAll('.dropdown-menu-item')].some(e => /readme\\.txt/.test(e.textContent)) && 'readme.txt'`, { label: 'readme.txt in the @ list', timeoutMs: 20_000 });
      await wb.key('Escape');
      await chat.click('.fg-composer__messageInput');
      await wb.key('a', 2);
      await wb.key('Backspace');
      assert((fs.statSync(rg).mode & 0o111) === 0o111, `rg is ${mode(rg)} after a search`);
      evidence(`@ search found ${found} with the bundled ripgrep, now ${mode(rg)}`);
    },
  },
  {
    id: 24,
    title: 'The model picker lists what answers: the refresh checks every endpoint, drops the one that did not answer and shows the ping; that one in use is greyed with the reason',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence } = ctx;
      // `forge.endpoints` is an application setting: User/settings.json, in
      // desktop VS Code and code-server alike.
      const userFile = path.join(dirs.userData, 'User', 'settings.json');
      const endpointsFile = userFile;
      const originals = new Map([[userFile, fs.existsSync(userFile) ? fs.readFileSync(userFile, 'utf8') : undefined]]);
      const endpoints = readJson(userFile)['forge.endpoints'];
      // A second endpoint whose model the gateway does not serve: the stub
      // answers 404 for any id it does not list. The e2e settings keep the
      // periodic check off (syncIntervalMinutes 0), so only the refresh checks.
      const DEAD = 'e2e-dead';
      const patch = (file, values) => writeUserSettings(ctx.wb, JSON.stringify({ ...readJson(file), ...values }, null, 2), file);
      const chat = await openChat(ctx);
      await stubReset(ctx);
      await patch(endpointsFile, { 'forge.endpoints': { ...endpoints, [DEAD]: { wire: 'openai', baseUrl: ctx.gateway, model: 'retired-model', auth: { kind: 'none' } } } });
      await sleep(3000);
      const rows = () => chat.evaluate(`return [...document.querySelectorAll('.fg-modelmenu__modelItem')].map(r => ({
        name: r.querySelector('.fg-modelmenu__modelLabel').childNodes[0].textContent.trim(),
        ping: r.querySelector('.forge-model-chip--ping')?.textContent.trim() ?? null,
        tone: [...(r.querySelector('.forge-model-chip--ping')?.classList ?? [])].find(c => /--ping-/.test(c))?.replace('forge-model-chip--ping-', '') ?? null,
        description: r.querySelector('.fg-modelmenu__modelDescription')?.textContent.trim() ?? '',
        greyed: r.getAttribute('aria-disabled') === 'true' }))`);
      // An endpoint edit makes the host recycle idle channels and push new
      // state, which re-renders the footer; a click during that is lost. So
      // the open is retried until the menu stays up.
      const openMenu = async () => {
        await waitUntil(async () => {
          if (!(await chat.evaluate(`return !!document.querySelector('.fg-modelmenu__listbox')`))) {
            await chat.click('.fg-footer__modelPill');
            await sleep(1200);
          }
          return chat.evaluate(`return !!document.querySelector('.fg-modelmenu__listbox')`);
        }, { label: 'the model menu to open', timeoutMs: 30_000 });
      };
      try {
        await openMenu();
        const before = await waitUntil(async () => {
          const r = await rows();
          if (r.length !== 2) throw new Error(`rows: ${JSON.stringify(r)}`);
          return r;
        }, { label: 'both endpoints in the picker', timeoutMs: 20_000 });
        evidence(`before any check both are offered: ${before.map((r) => `${r.name} (${r.description.split(' · ').pop()})`).join(', ')}`);

        // The user's story: an endpoint was picked while it worked (here,
        // before any check), and has since stopped answering.
        await chat.click('.fg-modelmenu__modelItem', { text: 'retired-model' });
        await chat.waitFor(`document.querySelector('.fg-footer__modelPillLabel')?.textContent.trim() === 'retired-model'`, { label: 'the pill to name retired-model', timeoutMs: 20_000 });
        evidence('picked retired-model: the pill names it');

        await openMenu();
        // A local probe answers in ~20ms, over before the spinner can be read:
        // the stub holds its replies for 1.5s so the checking state is seen.
        await stubControl(ctx, { delayMs: 1500 });
        await chat.click('.forge-modelmenu__refresh');
        const busy = await chat.evaluate(`return document.querySelector('.forge-modelmenu__refresh')?.getAttribute('aria-busy')`);
        await chat.waitFor(`document.querySelector('.forge-modelmenu__refresh')?.getAttribute('aria-busy') === 'false' && [...document.querySelectorAll('.fg-modelmenu__modelItem')].some(r => r.getAttribute('aria-disabled') === 'true')`, { label: 'the check to finish with the dead endpoint greyed', timeoutMs: 60_000 });
        await stubControl(ctx, { delayMs: 0 });
        const checked = await rows();
        const probes = (await stubLog(ctx)).filter((e) => e.max_tokens === 4);
        const dead = probes.find((e) => e.model === 'retired-model');
        assert(dead?.status === 404 && probes.some((e) => e.model === ctx.model && !e.status), `probes: ${JSON.stringify(probes.map((e) => [e.model, e.status ?? 200]))}`);
        assert(busy === 'true', `aria-busy while checking: ${busy}`);
        evidence(`refresh (aria-busy ${busy} while checking): the gateway got one 4-token probe per endpoint (${probes.map((e) => `${e.model} ${e.status ?? 200}`).join(', ')}); the menu stayed open`);
        const live = checked.filter((r) => !r.greyed);
        const greyed = checked.filter((r) => r.greyed);
        assert(live.length === 1 && live[0].name === ctx.model && /^\d+ms$|^\d+\.\ds$/.test(live[0].ping ?? ''), `answering rows: ${JSON.stringify(live)}`);
        assert(greyed.length === 1 && greyed[0].name === 'retired-model' && /did not answer: /.test(greyed[0].description), `greyed rows: ${JSON.stringify(greyed)}`);
        const pill = await chat.evaluate(`return document.querySelector('.fg-footer__modelPillLabel')?.textContent.trim()`);
        assert(pill === 'retired-model', `pill: ${pill}`);
        evidence(`the picker: ${live[0].name} with ping ${live[0].ping} (${live[0].tone}); retired-model, in use, greyed: "${greyed[0].description}"; the pill still names it`);

        // Picking the one that answers: the dead endpoint leaves the list.
        await chat.click('.fg-modelmenu__modelItem', { text: ctx.model });
        await chat.waitFor(`document.querySelector('.fg-footer__modelPillLabel')?.textContent.trim() === ${JSON.stringify(ctx.model)}`, { label: `the pill to name ${ctx.model}`, timeoutMs: 20_000 });
        await openMenu();
        const after = await waitUntil(async () => {
          const r = await rows();
          if (r.length !== 1) throw new Error(`rows: ${JSON.stringify(r)}`);
          return r;
        }, { label: 'only the answering endpoint listed', timeoutMs: 20_000 });
        assert(after[0].name === ctx.model && !after[0].greyed, `after switching: ${JSON.stringify(after)}`);
        evidence(`switched to ${ctx.model}: the picker lists only it (${after[0].ping}); retired-model is no longer shown anywhere in the list`);
        await ctx.wb.key('Escape');
      } finally {
        await stubControl(ctx, { delayMs: 0 }).catch(() => {});
        for (const [f, text] of originals) await writeUserSettings(ctx.wb, text ?? '{}', f);
        await ctx.wb.key('Escape').catch(() => {});
      }
      // The settings are back: the picker must list the e2e endpoint again,
      // for the scenarios after this one. Its rows, not the pill: the pill can
      // name the CLI's last-served model with no row behind it.
      await openMenu();
      const restored = await waitUntil(async () => {
        const r = await rows();
        if (r.length !== 1 || r[0].name !== ctx.model) throw new Error(`rows: ${JSON.stringify(r)}`);
        return r;
      }, { label: 'the e2e endpoint back in the picker', timeoutMs: 20_000 });
      await ctx.wb.key('Escape');
      evidence(`settings restored: the picker lists ${restored[0].name} again`);
    },
  },
  {
    id: 25,
    title: 'Following edits: the edited file opens beside the chat, scrolled to the change and highlighted, and the chat keeps focus',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      // Nothing open, so whatever opens is the follower's doing. (Before the
      // chat: a chat left in a tab by an earlier scenario closes too.)
      await wb.runCommand('View: Close All Editor Groups');
      await sleep(800);
      const chat = await openChat(ctx);
      await newSession(chat);
      await setMode(chat, 'Edit automatically');

      // The lines on screen, one per `.view-line` (Monaco draws spaces as
      // U+00A0); a tab's aria-label starts with its name.
      const visibleLines = `[...document.querySelectorAll('.editor-instance .monaco-editor .view-line')].map(e => e.textContent.replace(/\u00a0/g, ' ').trimEnd())`;
      const tabOf = (name) => `[...document.querySelectorAll('.tabs-container .tab')].find(t => t.getAttribute('aria-label')?.startsWith(${JSON.stringify(name)}))`;
      // VS Code names a decoration type's CSS class ced-<key>-<n>.
      const highlighted = `document.querySelectorAll('.editor-instance [class*="ced-"]').length`;
      const editorFocused = `!!document.activeElement?.closest('.monaco-editor')`;

      // 1. An edit far down a file: it opens at the change, highlighted.
      const stamp = Date.now();
      const name = `follow-${stamp}.py`;
      const file = path.join(dirs.workspace, name);
      const lines = Array.from({ length: 80 }, (_, i) => `value_${i} = ${i}`);
      lines[64] = 'TIMEOUT_MS = 1000';
      fs.writeFileSync(file, lines.join('\n') + '\n');
      await chat.send(`edit ${file} :: TIMEOUT_MS = 1000 => TIMEOUT_MS = 2500`);
      // The highlight lasts a moment: watch for it from the send, not after the reply.
      const sawHighlight = wb.waitFor(`${highlighted}`, { label: 'a highlight on the changed line', timeoutMs: 60_000 }).catch(() => 0);
      await waitForReply(chat, 'Done: Edit');
      assert(fs.readFileSync(file, 'utf8').includes('TIMEOUT_MS = 2500'), `${name} was not edited on disk`);
      evidence(`the CLI edited ${name}: line 65 is now "TIMEOUT_MS = 2500"`);
      await wb.waitFor(`${tabOf(name)}?.classList.contains('active')`, { label: `${name} open in an editor`, timeoutMs: 10_000 });
      const shown = await wb.waitFor(`(${visibleLines}).includes('TIMEOUT_MS = 2500') && (${visibleLines})`, { label: 'the changed line in view', timeoutMs: 10_000 });
      assert(!shown.includes('value_0 = 0'), 'the editor shows the top of the file, not the change');
      evidence(`${name} opened on its own, scrolled to line 65 (line 1 is off screen), showing the new value`);
      const marks = await sawHighlight;
      assert(marks > 0, 'no highlight on the changed line');
      evidence(`the changed line is highlighted (${marks} decoration element(s))`);
      assert(!(await wb.evaluate(`return ${editorFocused}`)), 'the editor took focus from the chat');
      evidence('focus stayed out of the editor: the chat keeps the keyboard');
      // Highlight 4 s, then the gutter bar 3 s more (HIGHLIGHT_MS + TRAIL_MS).
      await wb.waitFor(`${highlighted} === 0`, { label: 'the highlight to fade', timeoutMs: 12_000 });
      evidence('the highlight faded after a moment; the file stays open');

      // 2. A new file written whole: it opens at its top.
      const written = path.join(dirs.workspace, `follow-new-${stamp}.txt`);
      await chat.send(`write ${written} :: written-by-e2e-${stamp}`);
      await waitForReply(chat, 'Done: Write');
      await wb.waitFor(`${tabOf(path.basename(written))}?.classList.contains('active') && (${visibleLines}).includes('written-by-e2e-${stamp}')`, { label: 'the written file open', timeoutMs: 10_000 });
      evidence(`${path.basename(written)} (a Write) opened at its top, showing its content`);

      // 3. With the chat in an editor tab, the file opens beside it, not over it.
      await wb.runCommand('View: Close All Editor Groups');
      await sleep(800);
      const before = (await wb.forgeFrames()).length;
      await wb.runCommand('Forge: Open in New Tab');
      await waitUntil(async () => (await wb.forgeFrames()).length > before, { label: 'the Forge tab' });
      const tab = await wb.forge({ test: `document.querySelector('.fg-composer__messageInput') && document.hasFocus()`, timeoutMs: 30_000, label: 'the Forge tab composer' });
      await dismissNotices(tab);
      await setMode(tab, 'Edit automatically');
      const beside = path.join(dirs.workspace, `follow-beside-${stamp}.py`);
      fs.writeFileSync(beside, 'LIMIT = 1\n');
      await tab.send(`edit ${beside} :: LIMIT = 1 => LIMIT = 2`);
      await waitForReply(tab, 'Done: Edit');
      await wb.waitFor(`${tabOf(path.basename(beside))}?.classList.contains('active')`, { label: 'the edited file open', timeoutMs: 10_000 });
      const groups = await wb.evaluate(`return document.querySelectorAll('.editor-group-container').length`);
      const chatVisible = await tab.evaluate(`return innerWidth > 0 && innerHeight > 0`);
      assert(groups >= 2 && chatVisible, `groups: ${groups}, chat visible: ${chatVisible}`);
      evidence(`with the chat in a tab, ${path.basename(beside)} opened in a second editor group (${groups} groups) and the chat stayed on screen`);
      assert(!(await wb.evaluate(`return ${editorFocused}`)), 'the editor took focus from the chat tab');
      evidence('focus stayed in the chat tab');
      await wb.runCommand('View: Close All Editor Groups');
    },
  },
  {
    id: 26,
    title: 'Edit automatically: deleting always asks; with forge.autoApproveSafeCommands a reading chain runs unasked and risky commands still ask; Manual still asks',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, host } = ctx;
      // A machine setting: desktop VS Code reads it from User/settings.json,
      // code-server from Machine/settings.json. Only this test host's file.
      const file = path.join(dirs.userData, host.kind === 'code-server' ? 'Machine' : 'User', 'settings.json');
      const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
      const setOption = (on) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const settings = readJson(file);
        if (on) settings['forge.autoApproveSafeCommands'] = true;
        else delete settings['forge.autoApproveSafeCommands'];
        fs.writeFileSync(file, JSON.stringify(settings, null, 2));
      };
      const forgeLog = () => {
        const logs = [];
        const walk = (dir, depth) => {
          if (depth > 5 || !fs.existsSync(dir)) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, depth + 1);
            else if (entry.name === 'Forge.log') logs.push(full);
          }
        };
        walk(path.join(dirs.userData, 'logs'), 0);
        const newest = logs.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).at(-1);
        return newest ? fs.readFileSync(newest, 'utf8') : '';
      };
      const approvals = () => forgeLog().split('\n').filter((l) => l.includes('[AutoApprove] Bash ran without asking')).length;
      const PROMPT = `document.querySelector('.fg-permission__permissionRequestContainer')`;
      const buttons = (chat) => chat.evaluate(`return [...document.querySelectorAll('.fg-permission__button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())`);
      /** Answer the prompt: `yes` is option 1, otherwise the "No" option. */
      const answer = async (chat, yes) => {
        await sleep(700); // the official ignores input for 500 ms
        const labels = await buttons(chat);
        const index = yes ? 0 : labels.findIndex((l) => /^\d?\s*No\b/.test(l));
        assert(index >= 0, `no "No" option in ${JSON.stringify(labels)}`);
        await chat.click('.fg-permission__button .fg-permission__shortcutNum', { index });
        return labels;
      };
      /** Send a command; returns whether the CLI asked (and answers it as told). */
      const replies = `[...document.querySelectorAll('.fg-chat__messagesContainer .fg-chat__timelineMessage')].filter(e => e.textContent.includes('Done: Bash')).length`;
      const run = async (chat, command, { yes = true } = {}) => {
        // Counted before the send: the last reply on screen can be the previous turn's.
        const before = await chat.evaluate(`return ${replies}`);
        await chat.send(`run :: ${command}`);
        await chat.waitFor(`${PROMPT} || ${replies} > ${before}`, { label: 'a prompt or the reply', timeoutMs: 60_000 });
        const asked = await chat.evaluate(`return !!${PROMPT}`);
        if (asked) await answer(chat, yes);
        // "No" ends the turn (the CLI interrupts it): there is no reply to wait for.
        if (!asked || yes) await chat.waitFor(`${replies} > ${before}`, { label: 'the reply', timeoutMs: 60_000 });
        await waitForIdle(chat);
        return asked;
      };

      const stamp = Date.now();
      // Two folders: the CLI's shell stays where the last command left it and
      // drops a `cd` into that folder as redundant, and a chain with no `cd`
      // left in it is one the CLI allows by itself. It is the `cd` into
      // another folder that makes it ask, as in the report.
      const [subA, subB] = ['a', 'b'].map((n) => path.join(dirs.workspace, `auto-${stamp}`, n));
      for (const sub of [subA, subB]) {
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(sub, 'notes.txt'), 'alpha\nbeta\n');
      }
      const notes = path.join(subB, 'notes.txt');
      // The shape of the chain from the report: cd, git log, echo markers, grep, a pipe.
      const reading = (tag, sub) => `cd ${sub} && git log --oneline -3 && echo "===${tag}===" && grep -n alpha notes.txt | head -5`;

      const chat = await openChat(ctx);
      try {
        setOption(false);
        await newSession(chat);
        await setMode(chat, 'Edit automatically');

        // 1. Off (the default): the CLI asks, as Claude Code does.
        const offAsked = await run(chat, reading('off', subA));
        assert(offAsked, 'with the setting off, the CLI did not ask for the reading chain');
        evidence('setting off (default), Edit automatically: the reading chain asked for permission, as Claude Code does');

        // 1b. Deleting asks whatever the setting says. Left to itself, the
        // CLI runs `rm` on a project file unasked in this mode.
        const offNotes = path.join(subA, 'notes.txt');
        const offRmAsked = await run(chat, `rm ${offNotes}`, { yes: false });
        assert(offRmAsked, 'setting off: rm ran without asking');
        assert(fs.existsSync(offNotes), 'setting off: the file was deleted although the prompt was answered No');
        assert(/\[EditMode\] Bash asks: .*rm/.test(forgeLog()), 'no [EditMode] line in the Forge log');
        evidence('setting off, Edit automatically: "rm notes.txt" asked (Forge.log: "[EditMode] Bash asks: …"); answered No, the file is still there');

        // 2. On: the same kind of chain runs unasked, and Forge logs why.
        setOption(true);
        await sleep(1500);
        const before = approvals();
        const onAsked = await run(chat, reading('on', subB));
        assert(!onAsked, 'with the setting on, the reading chain still asked');
        await waitUntil(() => approvals() > before, { label: '[AutoApprove] in the Forge log', timeoutMs: 10_000 });
        evidence(`setting on, Edit automatically: "cd … && git log … && echo … && grep … | head" ran with no prompt; Forge.log: "[AutoApprove] Bash ran without asking"`);
        // A command the CLI does not count as read-only on its own.
        const probe = approvals();
        const pyAsked = await run(chat, `python3 -c "print('e2e-py-${stamp}')"`);
        assert(!pyAsked, 'python3 -c asked');
        await waitUntil(() => approvals() > probe, { label: 'a second [AutoApprove] line', timeoutMs: 10_000 });
        evidence('setting on: python3 -c "print(…)" ran with no prompt ([AutoApprove] logged)');

        // 3. Editing a project file is a green pass.
        const editAsked = await run(chat, `echo gamma-${stamp} >> ${notes}`);
        assert(!editAsked && fs.readFileSync(notes, 'utf8').includes(`gamma-${stamp}`), `the edit asked (${editAsked}) or did not land`);
        evidence(`setting on: "echo … >> notes.txt" (an edit) ran with no prompt, and the file changed on disk`);

        // 4. Deleting is not: it asks, and "No" leaves the file.
        const rmAsked = await run(chat, `rm ${notes}`, { yes: false });
        assert(rmAsked, 'rm ran without asking');
        assert(fs.existsSync(notes), 'the file was deleted although the prompt was answered No');
        evidence('setting on: "rm notes.txt" asked; answered No, the file is still there');

        // 5. A risky step inside a harmless chain still asks.
        const chainAsked = await run(chat, `cd ${subA} && git log -1 && git push`, { yes: false });
        assert(chainAsked, 'a chain ending in git push ran without asking');
        evidence('setting on: "cd … && git log -1 && git push" asked (history leaves the machine)');

        // 6. Manual still asks for everything.
        await setMode(chat, 'Manual');
        const manualAsked = await run(chat, reading('manual', subA));
        assert(manualAsked, 'Manual did not ask for the reading chain');
        evidence('setting on, Manual: the reading chain asked, as before');
      } finally {
        if (original === undefined) fs.rmSync(file, { force: true });
        else fs.writeFileSync(file, original);
        await setMode(chat, 'Manual').catch(() => {});
      }
    },
  },
  {
    id: 27,
    title: 'Forge opens like Claude Code: the history on the left, the chat as an editor tab in a column of its own at half the editor area',
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      // A plain layout, as a user opening Forge has: one editor group, a file in it.
      await wb.runCommand('View: Close All Editor Groups');
      if (await wb.evaluate(`return !!document.querySelector('.editor-group-container.locked')`)) {
        await wb.runCommand('View: Unlock Editor Group');
      }
      await wb.runCommand('Go to File...');
      await wb.type('readme.txt');
      await sleep(700);
      await wb.key('Enter');
      await wb.waitFor(`document.activeElement?.closest('.editor-instance .monaco-editor')`, { label: 'the editor focused' });

      // The default location. The kit pins the side bar for the other
      // scenarios; this one sets the default back where a user would.
      const settingsFile = path.join(dirs.workspace, '.vscode', 'settings.json');
      const settingsBefore = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : undefined;
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, `${JSON.stringify({ ...(settingsBefore ? JSON.parse(settingsBefore) : {}), 'forge.preferredLocation': 'panel' }, null, 2)}\n`);
      await sleep(1500);
      try {
        // Open Forge from the activity bar, as a user does: the history, on the left.
        const icons = await wb.evaluate(`return [...document.querySelectorAll('.activitybar .action-item a.action-label')].filter(a => (a.getAttribute('aria-label') ?? '').startsWith('Forge')).map(a => { const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })`);
        assert(icons.length > 0, 'no Forge icon in the activity bar');
        let history;
        for (const icon of icons) {
          await wb.click(icon.x, icon.y);
          try {
            history = await wb.forge({ test: `window.FORGE_BOOTSTRAP?.host === 'sidebar' && document.querySelector('.fg-sessionmanager__newSessionButton')`, timeoutMs: 8_000, label: 'the history in the side bar' });
            break;
          } catch { /* that icon was not the history */ }
        }
        assert(history, 'the activity bar opened no history');
        const sideBar = await wb.evaluate(`return Math.round(document.querySelector('.part.sidebar')?.getBoundingClientRect().width ?? 0)`);
        evidence(`the Forge activity bar icon opened the history in the side bar (${sideBar}px wide)`);

        // New session: the chat opens as an editor tab, beside the file.
        await history.click('.fg-sessionmanager__newSessionButton');
        const layout = await wb.waitFor(`(() => {
          const editor = document.querySelector('.part.editor')?.getBoundingClientRect();
          const groups = [...document.querySelectorAll('.editor-group-container')].map(g => ({
            width: Math.round(g.getBoundingClientRect().width),
            locked: g.classList.contains('locked'),
            tabs: [...g.querySelectorAll('.tab')].map(t => (t.getAttribute('aria-label') ?? '').split(',')[0]),
          }));
          const chat = groups.find(g => g.tabs.length > 0 && g.tabs.every(t => t.startsWith('Forge')));
          return editor && chat && { editor: Math.round(editor.width), groups, chat };
        })()`, { label: 'the chat in an editor tab', timeoutMs: 30_000 });
        const share = layout.chat.width / layout.editor;
        assert(layout.groups.length === 2, `editor groups: ${JSON.stringify(layout.groups)}`);
        assert(layout.groups.some(g => g.tabs.includes('readme.txt')), 'the file left its group');
        assert(share > 0.4 && share < 0.6, `the chat takes ${Math.round(share * 100)}% of the editor area`);
        assert(layout.chat.locked, 'the chat column is not locked');
        evidence(`New session: the chat opened as an editor tab in a column of its own, ${layout.chat.width}px of the editor's ${layout.editor}px (${Math.round(share * 100)}%), locked; readme.txt kept its column`);

        const stillThere = await wb.evaluate(`return Math.round(document.querySelector('.part.sidebar')?.getBoundingClientRect().width ?? 0)`);
        assert(stillThere > 0, 'the history closed');
        const chat = await wb.forge({ test: `window.FORGE_BOOTSTRAP?.host === 'editor' && document.querySelector('.fg-composer__messageInput')`, timeoutMs: 30_000, label: 'the chat tab composer' });
        const size = await chat.evaluate(`return { w: innerWidth, h: innerHeight }`);
        assert(size.w > sideBar, `the chat (${size.w}px) is no wider than the side bar (${sideBar}px)`);
        evidence(`the history stayed open on the left (${stillThere}px); the chat renders at ${size.w}x${size.h}px`);

        // A conversation from the history reuses that tab: no second webview.
        const hasRow = await history.evaluate(`return !!document.querySelector('.fg-sessions__sessionItem .fg-sessions__sessionName')`);
        if (hasRow) {
          const name = await history.evaluate(`return document.querySelector('.fg-sessions__sessionItem .fg-sessions__sessionName').textContent.trim()`);
          const started = Date.now();
          await history.click('.fg-sessions__sessionItem .fg-sessions__sessionName');
          await chat.waitFor(`[...document.querySelectorAll('.fg-chat__message')].length > 0`, { label: 'the conversation in the chat tab', timeoutMs: 10_000 });
          const took = Date.now() - started;
          // Counted in the chat's own (locked) column: a chat tab takes its
          // conversation's title, so it is no longer labelled "Forge".
          const chatColumn = await wb.evaluate(`return [...document.querySelectorAll('.editor-group-container.locked')].map(g => [...g.querySelectorAll('.tab')].map(t => (t.getAttribute('aria-label') ?? '').split(',')[0]))`);
          assert(chatColumn.length === 1 && chatColumn[0].length === 1, `the chat column holds ${JSON.stringify(chatColumn)} after opening a conversation`);
          evidence(`"${name.slice(0, 40)}" from the history opened in the same tab (the chat column still holds one tab, now titled "${chatColumn[0][0].slice(0, 40)}"), ${took} ms including the driver's click`);
        }
      } finally {
        if (settingsBefore === undefined) fs.rmSync(settingsFile, { force: true });
        else fs.writeFileSync(settingsFile, settingsBefore);
        await wb.runCommand('View: Close All Editor Groups').catch(() => {});
        if (await wb.evaluate(`return !!document.querySelector('.editor-group-container.locked')`)) {
          await wb.runCommand('View: Unlock Editor Group').catch(() => {});
        }
      }
    },
  },
  {
    id: 28,
    title: 'Create Agent asks which kind: a Claude Code agent and a Hermes agent are written, both are listed, and the conversation runs as the Hermes one, in its scope',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const stamp = Date.now().toString(36);
      const claudeName = `e2e-helper-${stamp}`;
      const hermesName = `e2e-reviewer-${stamp}`;
      const settingsFile = path.join(dirs.workspace, '.vscode', 'settings.json');
      const settingsBefore = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : undefined;

      const quick = `document.querySelector('.quick-input-widget')`;
      const quickRows = () => wb.evaluate(`return [...${quick}.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.getAttribute('aria-label') ?? '')`);
      const waitPicker = (label) => wb.waitFor(`(() => { const w = ${quick}; return w && w.style.display !== 'none' && w.querySelectorAll('.quick-input-list .monaco-list-row').length > 0 })()`, { label });
      const waitTitle = (title) => wb.waitFor(`${quick}?.style.display !== 'none' && ${quick}?.querySelector('.quick-input-title')?.textContent.includes(${JSON.stringify(title)})`, { label: `the "${title}" prompt` });
      // Move the quick pick's focus to the row saying `text`, then take it.
      const pick = async (text) => {
        for (let i = 0; i < 12; i++) {
          const focused = await wb.evaluate(`return ${quick}?.querySelector('.monaco-list-row.focused')?.getAttribute('aria-label') ?? ''`);
          if (focused.includes(text)) {
            await wb.key('Enter');
            await sleep(500);
            return;
          }
          await wb.key('ArrowDown');
        }
        throw new Error(`no quick pick row "${text}"`);
      };
      const answer = async (title, text) => {
        await waitTitle(title);
        await wb.type(text);
        await wb.key('Enter');
        await sleep(400);
      };

      try {
        // One way in: "Create Agent" is in the palette, the old straight-to-subagent command is not.
        const palette = await paletteRows(wb, 'Forge: Create');
        assert(palette.some((r) => r.startsWith('Forge: Create Agent')), `palette: ${JSON.stringify(palette)}`);
        assert(!palette.some((r) => r.startsWith('Forge: Create Subagent')), 'Forge: Create Subagent is still in the palette');
        evidence('palette: "Forge: Create Agent" is there, "Forge: Create Subagent" is not');

        // The choice.
        await wb.runCommand('Forge: Create Agent');
        await waitPicker('the kind picker');
        const kinds = await quickRows();
        assert(kinds.length === 2 && kinds[0].includes('Claude Code agent') && kinds[1].includes('Hermes agent'), `kinds offered: ${JSON.stringify(kinds)}`);
        evidence(`"Forge: Create Agent" asks which kind: ${kinds.map((k) => `"${k.split(',')[0].trim()}"`).join(' | ')}`);
        fs.mkdirSync(path.join(dirs.root, 'report'), { recursive: true });
        await wb.screenshot(path.join(dirs.root, 'report', 'create-agent-kinds.png'));

        // A Claude Code agent: name, when to use it, what it may use, where.
        await pick('Claude Code agent');
        await answer('Create Claude Code agent (1/4)', claudeName);
        await answer('Create Claude Code agent (2/4)', 'Reviews a diff for bugs before it is committed.');
        await waitTitle('Create Claude Code agent (3/4)');
        await pick('Read-only');
        await waitTitle('Create Claude Code agent (4/4)');
        await pick('This project');
        const claudeFile = path.join(dirs.workspace, '.claude', 'agents', `${claudeName}.md`);
        await waitUntil(() => fs.existsSync(claudeFile), { label: 'the Claude Code agent file' });
        assert(/^tools: Read, Grep, Glob$/m.test(fs.readFileSync(claudeFile, 'utf8')), 'the Claude Code agent lacks its read-only tools line');
        evidence(`Claude Code agent: .claude/agents/${claudeName}.md written, "tools: Read, Grep, Glob"`);
        await wb.clearNotifications();

        // A Hermes agent: name, what it is for, what it may use -- then "Use it now".
        await wb.runCommand('Forge: Create Agent');
        await waitPicker('the kind picker');
        await pick('Hermes agent');
        await answer('Create Hermes agent (1/3)', hermesName);
        await answer('Create Hermes agent (2/3)', 'Reviews changes and never edits files.');
        await waitTitle('Create Hermes agent (3/3)');
        await pick('Read-only');
        const hermesFile = path.join(dirs.workspace, '.forge', 'agents', `${hermesName}.md`);
        await waitUntil(() => fs.existsSync(hermesFile), { label: 'the Hermes agent file' });
        assert(/^tools: \[Read, Grep, Glob\]$/m.test(fs.readFileSync(hermesFile, 'utf8')), 'the Hermes agent lacks its read-only tools line');
        evidence(`Hermes agent: .forge/agents/${hermesName}.md written, "tools: [Read, Grep, Glob]"`);
        await waitUntil(async () => (await wb.notifications()).some((n) => n.buttons.includes('Use it now')), { label: 'the "Use it now" notification' });
        await clickWorkbench(wb, '.notification-list-item-buttons-container .monaco-button', 'Use it now');
        await waitUntil(() => fs.existsSync(settingsFile) && readJson(settingsFile)['forge.activeAgent'] === hermesName, { label: 'forge.activeAgent in the workspace settings' });
        evidence(`"Use it now": .vscode/settings.json forge.activeAgent = "${hermesName}"`);
        await wb.clearNotifications();

        // Settings › Agents lists both, each marked with its kind, the one in use marked.
        await wb.runCommand('Forge: Open Settings');
        const settings = await wb.forge({ test: `document.querySelector('.cursor-settings-sidebar-cell')`, label: 'the Settings page' });
        await settings.click('.cursor-settings-sidebar-cell', { text: 'Agents' });
        const rows = await settings.waitFor(
          `(() => { const r = [...document.querySelectorAll('.forge-items__row')].map(e => e.innerText.replace(/\\s+/g, ' ').trim()); return r.length >= 2 && r })()`,
          { label: 'the Agents list' },
        );
        const claudeRow = rows.find((r) => r.includes(claudeName));
        const hermesRow = rows.find((r) => r.includes(hermesName));
        assert(claudeRow?.includes('Claude Code'), `the Claude Code agent's row: ${claudeRow}`);
        assert(hermesRow?.includes('Hermes') && hermesRow.includes('In use'), `the Hermes agent's row: ${hermesRow}`);
        evidence(`Settings › Agents: "${claudeRow.slice(0, 70)}" | "${hermesRow.slice(0, 80)}"`);
        await wb.screenshot(path.join(dirs.root, 'report', 'settings-agents.png'));
        await wb.runCommand('View: Close Editor');

        // The next conversation runs as the Hermes agent, in its scope.
        const chat = await openChat(ctx);
        await newSession(chat);
        const prompt = `hermes scope probe ${stamp}`;
        await turn(chat, prompt);
        const log = await (await fetch(`${ctx.stubUrl}/__log`)).json();
        const entry = log.findLast((e) => e.lastUser.includes(prompt));
        assert(entry?.agents.includes(hermesName), `the system prompt ran as ${JSON.stringify(entry?.agents)}`);
        assert(entry.toolNames.includes('Read') && entry.toolNames.includes('Grep'), `offered: ${entry.toolNames.join(', ')}`);
        for (const tool of ['Bash', 'Edit', 'Write']) assert(!entry.toolNames.includes(tool), `${tool} was offered to a read-only agent`);
        evidence(`the next conversation ran as ${hermesName} ("## Agent: ${hermesName}" in the system prompt), offered ${entry.toolNames.length} tools: ${entry.toolNames.join(', ')} -- no Bash, Edit or Write`);
      } finally {
        // Back to no agent, so what runs next is unscoped.
        if (settingsBefore === undefined) fs.rmSync(settingsFile, { force: true });
        else fs.writeFileSync(settingsFile, settingsBefore);
        await wb.clearNotifications().catch(() => {});
      }
    },
  },
  {
    id: 29,
    title: 'Following edits, filmed: the right line marked, deletions marked, every file kept, and never over the editor the user types in',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const out = path.join(dirs.root, 'report', 'follow');
      fs.mkdirSync(out, { recursive: true });
      const stamp = Date.now().toString(36);
      const file = (name) => path.join(dirs.workspace, `${name}-${stamp}.py`);

      // What is on screen, measured from the workbench: the active tab, the
      // tabs, the line numbers in view, the lines highlighted (a decoration's
      // overlay row shares its `top` with its line number's margin row), and
      // where the keyboard is.
      const PROBE = `(() => {
        // The active group, unless it is empty: a followed file opens without
        // taking focus, so it can land in a group that is not the active one.
        const withEditor = (g) => g?.querySelector('.editor-instance .monaco-editor') ? g : undefined;
        const group = withEditor(document.querySelector('.editor-group-container.active')) ?? [...document.querySelectorAll('.editor-group-container')].find(withEditor);
        const ed = group?.querySelector('.editor-instance .monaco-editor');
        const nums = ed ? [...ed.querySelectorAll('.margin-view-overlays .line-numbers')].map(e => Number(e.textContent)).filter(n => n > 0) : [];
        const topToLine = new Map(ed ? [...ed.querySelectorAll('.margin-view-overlays > div')].map(d => [d.style.top, Number(d.querySelector('.line-numbers')?.textContent)]) : []);
        const marks = ed ? [...ed.querySelectorAll('.view-overlays [class*="ced-"]')] : [];
        const highlighted = [...new Set(marks.map(m => topToLine.get(m.parentElement?.style.top)).filter(Boolean))];
        const tabs = [...document.querySelectorAll('.tabs-container .tab')].map(t => ({
          name: (t.getAttribute('aria-label') ?? '').split(',')[0],
          active: t.classList.contains('active') && !!t.closest('.editor-group-container') && t.closest('.editor-group-container') === group,
          preview: t.classList.contains('preview') || !!t.querySelector('.label-name.italic, .italic'),
          dirty: t.classList.contains('dirty'),
        }));
        const a = document.activeElement;
        const focus = a?.closest('.monaco-editor') ? 'editor:' + ((a.closest('.editor-group-container')?.querySelector('.tab.active')?.getAttribute('aria-label') ?? '').split(',')[0]) : a?.tagName === 'IFRAME' ? 'webview' : (a?.className?.toString().slice(0, 30) || a?.tagName || '');
        return { tab: tabs.find(t => t.active)?.name ?? null, first: nums.length ? Math.min(...nums) : null, last: nums.length ? Math.max(...nums) : null, highlighted, tabs, focus };
      })()`;

      /** Screenshots and probes, back to back, for `ms` from now. */
      const film = async (name, ms, during) => {
        const frames = [];
        const started = Date.now();
        const job = during ? during() : Promise.resolve();
        let n = 0;
        while (Date.now() - started < ms) {
          const t = Date.now() - started;
          const info = await wb.evaluate(`return ${PROBE}`).catch(() => null);
          const shot = path.join(out, `${name}-${String(n).padStart(2, '0')}.png`);
          await wb.screenshot(shot);
          frames.push({ t, shot: path.basename(shot), ...info });
          n++;
          await sleep(90);
        }
        await job;
        fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(frames, null, 2));
        return frames;
      };
      const summary = (frames) => frames.map((f) => `${f.t}ms ${f.tab ?? '-'} [${f.first}-${f.last}] hl=${f.highlighted?.join('+') || '-'} focus=${f.focus}`).join(' | ');
      /** A frame of `name` marking `line`, with it in view. */
      const marked = (frames, name, line) => frames.find((f) => f.tab?.startsWith(name) && f.highlighted?.includes(line) && f.first <= line && line <= f.last);

      await wb.runCommand('View: Close All Editor Groups');
      await sleep(800);
      const chat = await openChat(ctx);
      await newSession(chat);
      await setMode(chat, 'Edit automatically');

      // 1. One edit far down a closed file.
      const far = file('far');
      const farLines = Array.from({ length: 120 }, (_, i) => `value_${i + 1} = ${i + 1}`);
      farLines[89] = 'TIMEOUT_MS = 1000';
      fs.writeFileSync(far, farLines.join('\n') + '\n');
      const f1 = await film('1-far-edit', 6000, async () => {
        await chat.send(`edit ${far} :: TIMEOUT_MS = 1000 => TIMEOUT_MS = 2500`);
        await waitForReply(chat, 'Done: Edit');
      });
      evidence(`1. far edit (line 90 of 120): ${summary(f1.filter((f, i) => i % 3 === 0 || f.highlighted?.length))}`);
      assert(marked(f1, 'far-', 90), 'line 90 was never shown marked');
      assert(f1.every((f) => f.focus === 'webview'), `the chat lost focus: ${[...new Set(f1.map((f) => f.focus))].join(', ')}`);

      // 2. The new text already appears earlier in the file.
      const dup = file('dup');
      const dupLines = Array.from({ length: 100 }, (_, i) => `line_${i + 1} = ${i + 1}`);
      dupLines[4] = 'retries = 3';
      dupLines[79] = 'retries = 1';
      fs.writeFileSync(dup, dupLines.join('\n') + '\n');
      await wb.runCommand('View: Close All Editor Groups');
      await sleep(500);
      await newSession(chat);
      await setMode(chat, 'Edit automatically');
      const f2 = await film('2-duplicate-text', 5000, async () => {
        await chat.send(`edit ${dup} :: retries = 1 => retries = 3`);
        await waitForReply(chat, 'Done: Edit');
      });
      const changedOnDisk = fs.readFileSync(dup, 'utf8').split('\n').findIndex((l, i) => i === 79 && l === 'retries = 3') === 79;
      evidence(`2. edit on line 80 whose new text also sits on line 5 (edited on disk: ${changedOnDisk}): ${summary(f2.filter((f) => f.highlighted?.length).slice(0, 3))}`);
      assert(marked(f2, 'dup-', 80), 'line 80 was never shown marked');
      assert(!f2.some((f) => f.highlighted?.includes(5)), 'line 5, which the edit did not touch, was marked');

      // 3. A deletion far down a file.
      const del = file('del');
      const delLines = Array.from({ length: 100 }, (_, i) => `item_${i + 1} = ${i + 1}`);
      delLines[84] = 'DEBUG = True';
      fs.writeFileSync(del, delLines.join('\n') + '\n');
      await wb.runCommand('View: Close All Editor Groups');
      await sleep(500);
      await newSession(chat);
      await setMode(chat, 'Edit automatically');
      const f3 = await film('3-deletion', 5000, async () => {
        await chat.send(`edit ${del} :: DEBUG = True => (nothing)`);
        await waitForReply(chat, 'Done: Edit');
      });
      evidence(`3. deletion on line 85 (deleted on disk: ${!fs.readFileSync(del, 'utf8').includes('DEBUG = True')}): ${summary(f3.filter((f, i, all) => i === 0 || f.tab !== all[i - 1].tab || (f.highlighted?.length ?? 0) !== (all[i - 1].highlighted?.length ?? 0)))}`);
      // The rule marks the line the removed text sat above: 85, now item_86.
      assert(marked(f3, 'del-', 85), 'the deletion point (line 85) was never shown marked');

      // 4. Three files edited in one turn, 700 ms apart (a model's pace).
      const [a, b, c] = ['multi-a', 'multi-b', 'multi-c'].map(file);
      for (const [p, v] of [[a, 'A'], [b, 'B'], [c, 'C']]) fs.writeFileSync(p, Array.from({ length: 40 }, (_, i) => (i === 29 ? `${v}_LIMIT = 1` : `${v.toLowerCase()}_${i + 1} = ${i + 1}`)).join('\n') + '\n');
      await wb.runCommand('View: Close All Editor Groups');
      await sleep(500);
      await newSession(chat);
      await setMode(chat, 'Edit automatically');
      const f4 = await film('4-three-files', 16000, async () => {
        await chat.send(`edits 700 :: ${a} :: A_LIMIT = 1 => A_LIMIT = 2 || ${b} :: B_LIMIT = 1 => B_LIMIT = 2 || ${c} :: C_LIMIT = 1 => C_LIMIT = 2`);
        await waitForReply(chat, 'Done: 3 edits');
      });
      const endTabs = f4.at(-1)?.tabs?.map((t) => `${t.name}${t.preview ? ' (preview)' : ''}`) ?? [];
      evidence(`4. three files in one turn (edited on disk: ${[a, b, c].every((p) => fs.readFileSync(p, 'utf8').includes('_LIMIT = 2'))}): ${summary(f4.filter((f, i, all) => i === 0 || f.tab !== all[i - 1].tab || (f.highlighted?.length ?? 0) !== (all[i - 1].highlighted?.length ?? 0)))}; tabs at the end: ${endTabs.join(', ')}`);
      for (const [p, name] of [[a, 'multi-a'], [b, 'multi-b'], [c, 'multi-c']]) {
        assert(marked(f4, name, 30), `${path.basename(p)}: line 30 was never shown marked`);
        assert(f4.at(-1)?.tabs?.some((t) => t.name === path.basename(p) && !t.preview), `${path.basename(p)} is not still open as a tab at the end`);
      }

      // 5. The user is typing in another file while the CLI edits one.
      const mine = path.join(dirs.workspace, `mine-${stamp}.txt`);
      fs.writeFileSync(mine, 'MY NOTES\n');
      const theirs = file('theirs');
      fs.writeFileSync(theirs, Array.from({ length: 30 }, (_, i) => (i === 19 ? 'RATE = 1' : `r_${i + 1} = ${i + 1}`)).join('\n') + '\n');
      await wb.runCommand('View: Close All Editor Groups');
      await sleep(500);
      await newSession(chat);
      await setMode(chat, 'Edit automatically');
      await wb.runCommand('Go to File...');
      await wb.type(mine);
      await sleep(1500);
      await wb.key('Enter');
      // Monaco draws spaces as U+00A0.
      await wb.waitFor(`document.querySelector('.editor-instance .monaco-editor .view-lines')?.textContent.replace(/\u00a0/g, ' ').includes('MY NOTES')`, { label: 'my notes open', timeoutMs: 30_000 });
      await chat.send(`edits 1200 :: ${theirs} :: RATE = 1 => RATE = 2`);
      const box = await wb.evaluate(`const r = document.querySelector('.editor-instance .monaco-editor .view-lines').getBoundingClientRect(); return { x: r.left + 120, y: r.top + 8 }`);
      await wb.click(box.x, box.y);
      await wb.key('End');
      const typed = ' typed by the user while Forge edits';
      const f5 = await film('5-user-typing', 7000, async () => {
        for (const ch of typed) {
          await wb.type(ch);
          await sleep(120);
        }
      });
      await waitForReply(chat, 'Done: 1 edits');
      evidence(`5. typing in ${path.basename(mine)} while the CLI edits ${path.basename(theirs)}: ${summary(f5.filter((f, i, all) => i === 0 || f.tab !== all[i - 1].tab || f.focus !== all[i - 1].focus))}`);
      // Every buffer to disk, so what reached each file can be counted.
      await wb.runCommand('File: Save All');
      await sleep(800);
      const mineText = fs.readFileSync(mine, 'utf8');
      const landed = mineText.startsWith('MY NOTES') ? mineText.slice('MY NOTES'.length).replace(/\n$/, '') : '';
      const theirsText = fs.readFileSync(theirs, 'utf8');
      evidence(`5. keystrokes: ${landed.length} of ${typed.length} reached ${path.basename(mine)} (${JSON.stringify(landed)}); ${path.basename(theirs)} ${theirsText.includes('typed') ? 'CONTAINS some of the typing' : 'has only the CLI\'s edit'} (RATE = 2: ${theirsText.includes('RATE = 2')})`);
      assert(landed === typed, `only ${landed.length} of ${typed.length} keystrokes reached ${path.basename(mine)}`);
      assert(f5.every((f) => f.focus === `editor:${path.basename(mine)}`), `focus left the user's editor: ${[...new Set(f5.map((f) => f.focus))].join(', ')}`);
      assert(f5.some((f) => f.tabs?.some((t) => t.name === path.basename(theirs))), `${path.basename(theirs)} never opened`);
      const groupsAfter = await wb.evaluate(`return document.querySelectorAll('.editor-group-container').length`);
      assert(groupsAfter >= 2, `${path.basename(theirs)} did not open beside the user's editor (groups: ${groupsAfter})`);
      evidence(`5. ${path.basename(theirs)} opened in its own group (${groupsAfter} groups); the user's editor kept focus in every frame`);

      // 6. A new file written from nothing.
      const created = file('created');
      await wb.runCommand('View: Close All Editor Groups');
      await sleep(500);
      await newSession(chat);
      await setMode(chat, 'Edit automatically');
      const f6 = await film('6-new-file', 5000, async () => {
        await chat.send(`write ${created} :: print("forged")`);
        await waitForReply(chat, 'Done: Write');
      });
      evidence(`6. new file (written: ${fs.existsSync(created)}): ${summary(f6.filter((f, i, all) => i === 0 || f.tab !== all[i - 1].tab || (f.highlighted?.length ?? 0) !== (all[i - 1].highlighted?.length ?? 0)))}`);
      assert(marked(f6, 'created-', 1), 'the new file was never shown marked');
      // Another theme: run again with `--theme "Default Dark Modern"`.
      // Switching mid-session is scenario 30.
      await wb.runCommand('View: Close All Editor Groups');
    },
  },
  {
    id: 30,
    title: 'Colour theme switched mid-session: the chat stays on its endpoint, restyles, and answers',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const forgeLog = () => {
        const logs = [];
        const walk = (dir, depth) => {
          if (depth > 5 || !fs.existsSync(dir)) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, depth + 1);
            else if (entry.name === 'Forge.log') logs.push(full);
          }
        };
        walk(path.join(dirs.userData, 'logs'), 0);
        const newest = logs.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).at(-1);
        return newest ? fs.readFileSync(newest, 'utf8') : '';
      };
      const out = path.join(dirs.root, 'report', 'theme');
      fs.mkdirSync(out, { recursive: true });
      const workbenchDark = () => wb.evaluate(`return document.querySelector('.monaco-workbench').classList.contains('vs-dark')`);

      await wb.runCommand('View: Close All Editor Groups');
      const chat = await openChat(ctx);
      await newSession(chat);
      await turn(chat, 'before the theme switch');

      for (const step of [1, 2]) {
        const wasDark = await workbenchDark();
        const theme = wasDark ? 'Light Modern' : 'Dark Modern';
        const logBefore = forgeLog().length;
        await wb.runCommand('Preferences: Color Theme');
        await sleep(600);
        await wb.type(theme);
        await sleep(800);
        await wb.key('Enter');
        await wb.waitFor(`document.querySelector('.monaco-workbench').classList.contains('vs-dark') === ${!wasDark}`, { label: `the workbench in ${theme}`, timeoutMs: 10_000 });
        await sleep(1500);

        // The chat restyles with the workbench, without a reload.
        // The body itself is transparent; the colour VS Code hands the page is
        // the side bar's, where the chat lives.
        const look = await chat.evaluate(`const hex = getComputedStyle(document.documentElement).getPropertyValue('--vscode-sideBar-background').trim().replace('#', '');
          const bg = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
          return { dark: document.body.classList.contains('vscode-dark'), luma: (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255, hex }`);
        assert(look.dark === !wasDark && (look.luma < 0.5) === !wasDark, `the chat did not follow the theme: ${JSON.stringify(look)}`);

        // Still the chat, on the endpoint: a new conversation answers.
        await newSession(chat);
        const welcome = await chat.evaluate(`return !!document.querySelector('.fg-welcome__container')`);
        const composer = await chat.evaluate(`return !!document.querySelector('.fg-composer__messageInput')`);
        await wb.screenshot(path.join(out, `${step}-${theme.replace(/ /g, '-').toLowerCase()}.png`));
        assert(!welcome && composer, `after switching to ${theme} the chat shows ${welcome ? 'its setup page' : 'no composer'}`);
        await turn(chat, `after the switch to ${theme}`);

        const log = forgeLog().slice(logBefore);
        const stopped = (log.match(/\[endpoints\] relay stopped/g) ?? []).length;
        const listening = (log.match(/\[endpoints\] Relay listening/g) ?? []).length;
        const counts = log.split('\n').filter((l) => l.includes('[endpoints] profiles:')).map((l) => l.replace(/^.*\[endpoints\] /, ''));
        assert(stopped <= listening, `the relay was stopped ${stopped} time(s) and restarted ${listening}: ${counts.join(' / ') || 'no profile count change'}`);
        evidence(`${step}. switched to ${theme}: the chat restyled (${look.dark ? 'dark' : 'light'}, body luma ${look.luma.toFixed(2)}), kept its composer, and answered a new conversation; relay stopped ${stopped}, started ${listening}; profile counts logged: ${counts.join(' / ') || 'none'}`);
      }
    },
  },
  {
    id: 31,
    title: 'Showcase: a demo conversation filmed for sharing -- a failing test found, fixed and re-run (real tools, scripted wording)',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const demo = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'demos', 'fix-failing-test.json'), 'utf8'));
      const out = path.join(dirs.root, 'report', 'showcase');
      fs.mkdirSync(out, { recursive: true });
      // Crisp images for sharing: the same layout at twice the pixels.
      const shoot = async (name) => {
        await wb.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 2, mobile: false }, wb.page);
        await sleep(500);
        await wb.screenshot(path.join(out, `${name}.png`));
        await wb.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, wb.page);
      };

      // The project: a slug helper with a real bug, and its tests.
      fs.writeFileSync(path.join(dirs.workspace, 'slugify.py'), [
        'import re',
        '',
        '',
        'def slugify(text: str) -> str:',
        '    """Turn a title into a URL slug: lowercase words joined by single hyphens."""',
        '    text = text.strip().lower()',
        '    text = re.sub(r"[^a-z0-9]", "-", text)',
        '    return text.strip("-")',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(dirs.workspace, 'test_slugify.py'), [
        'import unittest',
        '',
        'from slugify import slugify',
        '',
        '',
        'class SlugifyTest(unittest.TestCase):',
        '    def test_lowercases_words(self):',
        '        self.assertEqual(slugify("Forge"), "forge")',
        '',
        '    def test_joins_words_with_hyphens(self):',
        '        self.assertEqual(slugify("Hello World"), "hello-world")',
        '',
        '    def test_collapses_punctuation_and_spaces(self):',
        '        self.assertEqual(slugify("Hello,  World!"), "hello-world")',
        '',
        '',
        'if __name__ == "__main__":',
        '    unittest.main()',
        '',
      ].join('\n'));

      // The stage: the chat wide on the left, the editor beside it, nothing else.
      await wb.runCommand('View: Close All Editor Groups');
      if (await wb.evaluate(`return !!document.querySelector('.editor-group-container.locked')`)) await wb.runCommand('View: Unlock Editor Group');
      if (await wb.evaluate(`return (document.querySelector('.part.auxiliarybar')?.offsetWidth ?? 0) > 0`)) {
        await wb.runCommand('View: Toggle Secondary Side Bar Visibility');
      }
      const chat = await openChat(ctx);
      const bar = await wb.evaluate(`const r = document.querySelector('.part.sidebar')?.getBoundingClientRect(); return r ? { right: r.right, mid: r.top + r.height / 2 } : null`);
      if (bar) await wb.drag({ x: bar.right, y: bar.mid }, { x: 600, y: bar.mid });
      await newSession(chat);
      await setMode(chat, 'Edit automatically');
      await wb.clearNotifications().catch(() => {});

      await chat.send(demo.prompt);
      let asked = 0;
      const deadline = Date.now() + 180_000;
      for (;;) {
        if (await chat.evaluate(`return [...document.querySelectorAll('.fg-chat__timelineMessage')].some(e => e.textContent.includes('All 3 tests pass'))`)) break;
        if (Date.now() > deadline) throw new Error('the demo did not finish');
        if (await chat.evaluate(`return !!document.querySelector('.fg-permission__button .fg-permission__shortcutNum')`)) {
          if (!asked) {
            await wb.clearNotifications().catch(() => {});
            await shoot('2-asks-before-running');
          }
          asked++;
          await chat.click('.fg-permission__button .fg-permission__shortcutNum', { index: 0 });
          await sleep(800);
          continue;
        }
        if (await wb.evaluate(`return !!document.querySelector('.editor-instance [class*="ced-"]')`) && !fs.existsSync(path.join(out, '3-edit-beside-the-chat.png'))) {
          await shoot('3-edit-beside-the-chat');
        }
        await sleep(400);
      }
      await waitForIdle(chat);
      await sleep(1500);
      await wb.clearNotifications().catch(() => {});
      await shoot('1-conversation');

      const fixed = fs.readFileSync(path.join(dirs.workspace, 'slugify.py'), 'utf8').includes('[^a-z0-9]+');
      const transcript = await chat.evaluate(`return document.querySelector('.fg-chat__messagesContainer')?.innerText ?? ''`);
      assert(fixed, 'slugify.py was not fixed on disk');
      evidence(`demo: ${asked} command(s) approved; slugify.py fixed on disk; transcript shows ${/FAILED \(failures=1\)/.test(transcript) ? 'the real failing run' : 'no failing run'} and ${/Ran 3 tests[\s\S]*OK/.test(transcript) ? 'the real passing run' : 'no passing run'}; screenshots in report/showcase/`);
    },
  },
  {
    id: 32,
    title: 'Showcase: the welcome screens filmed for sharing -- the empty chat with its composer, and the first-run welcome',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const out = path.join(dirs.root, 'report', 'showcase');
      fs.mkdirSync(out, { recursive: true });
      const shoot = async (name) => {
        await wb.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 2, mobile: false }, wb.page);
        await sleep(500);
        await wb.screenshot(path.join(out, `${name}.png`));
        await wb.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, wb.page);
      };

      // The stage, as for the conversation: the chat wide, nothing else open.
      await wb.runCommand('View: Close All Editor Groups');
      if (await wb.evaluate(`return !!document.querySelector('.editor-group-container.locked')`)) await wb.runCommand('View: Unlock Editor Group');
      if (await wb.evaluate(`return (document.querySelector('.part.auxiliarybar')?.offsetWidth ?? 0) > 0`)) {
        await wb.runCommand('View: Toggle Secondary Side Bar Visibility');
      }
      const chat = await openChat(ctx);
      const bar = await wb.evaluate(`const r = document.querySelector('.part.sidebar')?.getBoundingClientRect(); return r ? { right: r.right, mid: r.top + r.height / 2 } : null`);
      if (bar && Math.abs(bar.right - 600) > 8) await wb.drag({ x: bar.right, y: bar.mid }, { x: 600, y: bar.mid });

      // 1. A new conversation: the logo, the hammer, a tip, and the composer.
      await newSession(chat);
      await chat.waitFor(`document.querySelector('.fg-composer__messageInput') && !document.querySelector('.fg-welcome__container')`, { label: 'the empty chat' });
      await wb.clearNotifications().catch(() => {});
      await sleep(1200);
      await shoot('4-empty-chat');

      // 2. The first-run welcome: what someone sees before any endpoint is set
      // up. The endpoint goes for the shot, through VS Code's settings editor,
      // and comes back after.
      const userFile = path.join(dirs.userData, 'User', 'settings.json');
      const original = fs.readFileSync(userFile, 'utf8');
      const { ['forge.endpoints']: _endpoints, ['forge.endpointProfile']: _profile, ...rest } = readJson(userFile);
      try {
        await writeUserSettings(wb, JSON.stringify(rest, null, 2), userFile);
        await chat.waitFor(`!!document.querySelector('.fg-welcome__container')`, { label: 'the first-run welcome', timeoutMs: 30_000 });
        await wb.clearNotifications().catch(() => {});
        await sleep(1500);
        await shoot('5-first-run-welcome');
        const buttons = await chat.evaluate(`return [...document.querySelectorAll('.forge-welcome__primary, .forge-welcome__secondary')].map(b => b.textContent.trim())`);
        evidence(`first-run welcome: ${buttons.join(' / ')}`);
      } finally {
        await writeUserSettings(wb, original, userFile);
      }
      await chat.waitFor(`!document.querySelector('.fg-welcome__container')`, { label: 'the chat back after the endpoint returned', timeoutMs: 30_000 });
      evidence('screenshots in report/showcase/: 4-empty-chat, 5-first-run-welcome; the endpoint restored');
    },
  },
  {
    id: 33,
    title: 'Showcase: a richer demo filmed for sharing -- tax charged twice on discounts, planned, reproduced, fixed and covered by a regression test (real tools, scripted wording)',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const demo = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'demos', 'tax-twice.json'), 'utf8'));
      const out = path.join(dirs.root, 'report', 'showcase');
      fs.mkdirSync(out, { recursive: true });
      const shoot = async (name, height = 1000) => {
        await wb.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height, deviceScaleFactor: 2, mobile: false }, wb.page);
        await sleep(height === 1000 ? 500 : 2000);
        await wb.screenshot(path.join(out, `${name}.png`));
        await wb.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, wb.page);
      };
      for (const [name, text] of Object.entries(demo.files)) fs.writeFileSync(path.join(dirs.workspace, name), text);

      await wb.runCommand('View: Close All Editor Groups');
      if (await wb.evaluate(`return !!document.querySelector('.editor-group-container.locked')`)) await wb.runCommand('View: Unlock Editor Group');
      if (await wb.evaluate(`return (document.querySelector('.part.auxiliarybar')?.offsetWidth ?? 0) > 0`)) {
        await wb.runCommand('View: Toggle Secondary Side Bar Visibility');
      }
      const chat = await openChat(ctx);
      const bar = await wb.evaluate(`const r = document.querySelector('.part.sidebar')?.getBoundingClientRect(); return r ? { right: r.right, mid: r.top + r.height / 2 } : null`);
      if (bar && Math.abs(bar.right - 640) > 8) await wb.drag({ x: bar.right, y: bar.mid }, { x: 640, y: bar.mid });
      await newSession(chat);
      await setMode(chat, 'Edit automatically');
      await wb.clearNotifications().catch(() => {});

      await chat.send(demo.prompt);
      const shot = (name) => fs.existsSync(path.join(out, `${name}.png`));
      let asked = 0;
      const deadline = Date.now() + 240_000;
      for (;;) {
        if (await chat.evaluate(`return [...document.querySelectorAll('.fg-chat__timelineMessage')].some(e => e.textContent.includes(${JSON.stringify(demo.done)}))`)) break;
        if (Date.now() > deadline) throw new Error('the demo did not finish');
        if (await chat.evaluate(`return !!document.querySelector('.fg-permission__button .fg-permission__shortcutNum')`)) {
          asked++;
          await chat.click('.fg-permission__button .fg-permission__shortcutNum', { index: 0 }).catch(() => {});
          await sleep(900);
          continue;
        }
        if (!shot('6-plan') && (await chat.evaluate(`return /Reproduce the double tax/.test(document.querySelector('.fg-chat__messagesContainer')?.innerText ?? '')`))) {
          await wb.clearNotifications().catch(() => {});
          await shoot('6-plan');
        }
        if (!shot('7-fix-beside-the-chat') && (await wb.evaluate(`return [...document.querySelectorAll('.tabs-container .tab.active')].some(t => /^cart\.py/.test(t.getAttribute('aria-label') ?? '')) && !!document.querySelector('.editor-instance [class*="ced-"]')`))) {
          await wb.clearNotifications().catch(() => {});
          await shoot('7-fix-beside-the-chat');
        }
        await sleep(300);
      }
      await waitForIdle(chat);
      await sleep(1500);
      // The fixed file in view, not the test file the last edit opened.
      await wb.runCommand('Go to File...');
      await wb.type('cart.py');
      await sleep(1200);
      await wb.key('Enter');
      await sleep(1200);
      await wb.clearNotifications().catch(() => {});
      await shoot('8-done');
      // The whole conversation in one tall frame.
      await shoot('9-whole-conversation', 2300);

      const cart = fs.readFileSync(path.join(dirs.workspace, 'cart.py'), 'utf8');
      const transcript = await chat.evaluate(`return document.querySelector('.fg-chat__messagesContainer')?.innerText ?? ''`);
      assert(!/amount = with_tax\(amount\)/.test(cart), 'cart.py still taxes discounted lines twice');
      assert(transcript.includes('57.6') && transcript.includes('48.0'), 'the transcript lacks the real before/after output');
      assert(/Ran 4 tests[\s\S]*OK/.test(transcript), 'the transcript lacks the passing run of 4 tests');
      evidence(`demo: ${asked} approval(s); cart.py fixed on disk; the real output 57.6 then 48.0, and "Ran 4 tests … OK", in the transcript; screenshots in report/showcase/`);
    },
  },
  {
    id: 34,
    title: 'Showcase: the built-in Guide (Settings > Guide) filmed for sharing -- the overview, then each topic opened in turn',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence, wb } = ctx;
      const out = path.join(dirs.root, 'report', 'showcase');
      fs.mkdirSync(out, { recursive: true });
      const shoot = async (name, height = 1000) => {
        await wb.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height, deviceScaleFactor: 2, mobile: false }, wb.page);
        await sleep(height === 1000 ? 600 : 1500);
        await wb.screenshot(path.join(out, `${name}.png`));
        await wb.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, wb.page);
      };

      await wb.runCommand('View: Close All Editor Groups');
      for (const part of ['.part.auxiliarybar', '.part.sidebar']) {
        if (await wb.evaluate(`return (document.querySelector('${part}')?.offsetWidth ?? 0) > 0`)) {
          await wb.runCommand(part === '.part.sidebar' ? 'View: Toggle Primary Side Bar Visibility' : 'View: Toggle Secondary Side Bar Visibility');
        }
      }
      await wb.runCommand('Forge: Open Settings');
      const settings = await wb.forge({ test: `document.querySelector('.cursor-settings-sidebar-footer .cursor-settings-sidebar-cell')`, label: 'the Settings page' });
      await settings.click('.cursor-settings-sidebar-footer .cursor-settings-sidebar-cell', { text: 'Guide' });
      await settings.waitFor(`document.querySelectorAll('.fg-guide__item').length > 0`, { label: 'the Guide' });
      const ids = await settings.evaluate(`return [...document.querySelectorAll('.fg-guide__item')].map(e => e.id.replace('fg-guide-', ''))`);
      await wb.clearNotifications().catch(() => {});
      await shoot('10-guide-overview');

      const rendered = [];
      for (const id of ids) {
        await settings.click(`#fg-guide-q-${id}`);
        await settings.waitFor(`document.getElementById('fg-guide-a-${id}')?.offsetHeight > 0`, { label: `the ${id} answer` });
        const blocks = await settings.evaluate(`const q = document.getElementById('fg-guide-q-${id}'); q.scrollIntoView({ block: 'start' }); return document.getElementById('fg-guide-a-${id}').children.length`);
        await wb.clearNotifications().catch(() => {});
        await shoot(`11-guide-${id}`, 1600);
        await settings.click(`#fg-guide-q-${id}`);
        rendered.push(`${id} (${blocks} blocks)`);
        assert(blocks > 0, `the ${id} answer rendered nothing`);
      }
      assert(ids.length >= 5, `expected at least 5 Guide topics, found ${ids.length}`);
      evidence(`Guide: ${ids.length} topics filmed -- ${rendered.join(', ')}; screenshots in report/showcase/`);
      await wb.runCommand('View: Close Editor');
    },
  },
  {
    id: 35,
    title: '48a: a Write cut off by the output token limit is never run, and the model is told why',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      await newSession(chat);
      await setMode(chat, 'Edit automatically');
      const target = path.join(dirs.workspace, `cutoff-${Date.now()}.ts`);
      const original = 'export const keep = 1;\nexport const also = 2;\n';
      fs.writeFileSync(target, original);
      await chat.send(`cutwrite ${target}`);
      await waitForReply(chat, 'Done: Write');
      assert(fs.readFileSync(target, 'utf8') === original, `${path.basename(target)} changed on disk`);
      evidence(`${path.basename(target)} is byte-for-byte unchanged after the cut-off Write`);
      const last = (await stubLog(ctx)).at(-1);
      assert(/nothing was written to/.test(last.lastTool ?? ''), `the next request's tool result has no cut-off hint: "${(last.lastTool ?? '').slice(0, 200)}"`);
      evidence(`the next request's tool result carries: "${/Hint: nothing was written[^.]*\./.exec(last.lastTool)?.[0]}"`);
      await setMode(chat, 'Manual');
    },
  },
  {
    id: 36,
    title: '48b: Alpha mode in a running conversation: persisted, the rules on the next message, no relaunch, retracted when off',
    needs: ['stub'],
    async run(ctx) {
      const { dirs, evidence } = ctx;
      const chat = await openChat(ctx);
      await newSession(chat);
      const first = `before alpha ${Date.now()}`;
      await turn(chat, first);
      const launches = () => (forgeLogText(dirs).match(/Launching a Claude session/g) ?? []).length;
      const launchedBefore = launches();

      await setAlpha(ctx, chat, true);
      const forgeJson = readJson(path.join(dirs.home, '.forge.json'));
      assert(forgeJson.alphaMode === true, `~/.forge.json alphaMode is ${forgeJson.alphaMode}`);
      evidence('~/.forge.json: alphaMode true');
      const cli = path.join(dirs.home, '.claude', 'forge.json');
      assert(!fs.existsSync(cli) || !/alphaMode/.test(fs.readFileSync(cli, 'utf8')), 'alphaMode leaked into ~/.claude/forge.json');

      const on = `with alpha ${Date.now()}`;
      await turn(chat, on);
      // Measured on CLI 2.1.274 (cliGuardsE2E): UserPromptSubmit context comes
      // as "UserPromptSubmit hook additional context: …" in a context block,
      // which the relay sends as a system message.
      const withSystem = async () => (await fetch(`${ctx.stubUrl}/__log?system=1`)).json();
      const sent = (await withSystem()).findLast((e) => e.lastUser.includes(on));
      assert(sent?.system.includes('UserPromptSubmit hook additional context: # Alpha mode: working rules'), 'the next request carries no Alpha rules');
      evidence('the next request carries _alpha.md as UserPromptSubmit context');
      assert(launches() === launchedBefore, `the conversation was relaunched (${launchedBefore} -> ${launches()} launches)`);
      evidence(`no relaunch: ${launches()} launch line(s) in Forge.log before and after`);

      await setAlpha(ctx, chat, false);
      const off = `alpha off ${Date.now()}`;
      await turn(chat, off);
      const retracted = (await withSystem()).findLast((e) => e.lastUser.includes(off));
      assert(retracted?.system.includes('UserPromptSubmit hook additional context: Alpha mode is off: the Alpha working rules no longer apply.'), 'no retraction line after switching off');
      evidence('switched off: the next request carries the one-line retraction');
    },
  },
  {
    id: 37,
    title: '48b: a new conversation launched with Alpha mode on has the rules in its system prompt',
    needs: ['stub'],
    async run(ctx) {
      const { evidence } = ctx;
      const chat = await openChat(ctx);
      await setAlpha(ctx, chat, true);
      await newSession(chat);
      const prompt = `alpha launch ${Date.now()}`;
      await turn(chat, prompt);
      const log = await (await fetch(`${ctx.stubUrl}/__log?system=1`)).json();
      const entry = log.findLast((e) => e.lastUser.includes(prompt));
      assert(entry?.system.includes('# Alpha mode: working rules') && !entry.system.includes('UserPromptSubmit hook additional context: # Alpha'), 'the gateway\'s system prompt has no standing Alpha rules');
      evidence('the stub gateway received _alpha.md in the system prompt');
      await setAlpha(ctx, chat, false);
    },
  },
  {
    id: 38,
    title: '48b: the 60-step cap is enforced, launched with Alpha on (maxTurns) and switched on mid-conversation (host counter)',
    needs: ['stub'],
    async run(ctx) {
      const { evidence } = ctx;
      const chat = await openChat(ctx);
      const requestsFor = async (since) => (await stubLog(ctx)).slice(since).filter((e) => e.reply?.startsWith('tool:Bash')).length;
      const notice = `[...document.querySelectorAll('.fg-chat__messagesContainer *')].some(e => e.textContent.includes("Forge stopped this turn at Alpha mode's step limit"))`;
      await setMode(chat, 'Edit automatically');

      // 1. Launched with Alpha on: the SDK's maxTurns.
      await setAlpha(ctx, chat, true);
      await newSession(chat);
      let since = (await stubLog(ctx)).length;
      await chat.send('steps :: forever');
      await chat.waitFor(notice, { label: 'the Alpha step-limit notice (maxTurns)', timeoutMs: 300_000 });
      await waitForIdle(chat, { timeoutMs: 60_000 });
      const atLaunch = await requestsFor(since);
      assert(atLaunch <= 60, `${atLaunch} model requests for one message (cap 60)`);
      evidence(`launched with Alpha on: ${atLaunch} model requests, then "Forge stopped this turn at Alpha mode's step limit"`);

      // 2. A conversation launched with Alpha off, switched on before the message: the host counter.
      await setAlpha(ctx, chat, false);
      await newSession(chat);
      await turn(chat, `warm up ${Date.now()}`);
      await setAlpha(ctx, chat, true);
      since = (await stubLog(ctx)).length;
      await chat.send('steps :: forever');
      await chat.waitFor(notice, { label: 'the Alpha step-limit notice (host counter)', timeoutMs: 300_000 });
      await waitForIdle(chat, { timeoutMs: 60_000 });
      const midway = await requestsFor(since);
      // The host interrupts on the 61st model turn's message, which has already been requested.
      assert(midway <= 61, `${midway} model requests for one message (host cap 60, interrupt on the 61st)`);
      evidence(`switched on mid-conversation: ${midway} model requests, then the same notice`);
      await setAlpha(ctx, chat, false);
      await setMode(chat, 'Manual');
    },
  },
  {
    // Last: pressing Ctrl+Esc inside a webview makes code-server's next page
    // reload hang (VS Code's own Markdown preview does it too), so this runs
    // after every scenario that reloads.
    id: 13,
    title: 'Keybindings: Ctrl+Esc focus and blur, Alt+K mention, Ctrl+Shift+Esc new tab, Shift+Tab mode cycle',
    async run(ctx) {
      const { evidence, wb } = ctx;
      // Earlier scenarios leave editor groups split and the secondary side bar
      // open; in the full run that squeezed the Forge side bar to ~170px and
      // clipped the mode button. Start from the plain layout a user has.
      await wb.runCommand('View: Close All Editor Groups');
      // The group that remains can still be locked: Forge locks the column it
      // opens a chat tab in, as the official does (25 does this last), and
      // closing the tab leaves the lock. Files would then open in a new group
      // and Ctrl+Esc, which focuses the first group, would land on the empty one.
      if (await wb.evaluate(`return !!document.querySelector('.editor-group-container.locked')`)) {
        await wb.runCommand('View: Unlock Editor Group');
      }
      if (await wb.evaluate(`return (document.querySelector('.part.auxiliarybar')?.offsetWidth ?? 0) > 0`)) {
        await wb.runCommand('View: Toggle Secondary Side Bar Visibility');
      }
      const chat = await openChat(ctx);
      // The side bar keeps the width an earlier scenario left it at (~170px
      // in the full run), which clips the footer's mode button. Drag its sash
      // to a normal width, as a user would.
      const bar = await wb.evaluate(`const r = document.querySelector('.part.sidebar')?.getBoundingClientRect(); return r ? { right: r.right, mid: r.top + r.height / 2 } : null`);
      if (bar && bar.right < 360) {
        await wb.drag({ x: bar.right, y: bar.mid }, { x: 420, y: bar.mid });
        const width = await wb.evaluate(`return Math.round(document.querySelector('.part.sidebar')?.getBoundingClientRect().width ?? 0)`);
        evidence(`the side bar was ${Math.round(bar.right)}px from the left; dragged to ${width}px wide`);
      }
      const composerFocused = () => chat.evaluate(`return document.hasFocus() && document.activeElement?.matches('.fg-composer__messageInput')`);
      const editorFocused = () => wb.evaluate(`return !!document.activeElement?.closest('.editor-instance .monaco-editor')`);
      await wb.runCommand('Go to File...');
      await wb.type('readme.txt');
      await sleep(700);
      await wb.key('Enter');
      await wb.waitFor(`document.activeElement?.closest('.editor-instance .monaco-editor')`, { label: 'the editor focused' });

      await wb.key('Escape', 2);
      await waitUntil(composerFocused, { label: 'Ctrl+Esc to focus the composer', timeoutMs: 5_000 });
      evidence('Ctrl+Esc in the editor: the Forge composer has focus');
      await wb.key('Escape', 2);
      await waitUntil(editorFocused, { label: 'Ctrl+Esc to return to the editor', timeoutMs: 5_000 });
      evidence('Ctrl+Esc in Forge: focus is back in the editor');

      await wb.runCommand('Go to Line/Column...');
      await wb.type('2');
      await wb.key('Enter');
      await wb.key('Home');
      await wb.key('End', 8);
      await wb.key('k', 1);
      const mention = await chat.waitFor(`/@\\S*readme\\.txt/.exec(document.querySelector('.fg-composer__messageInput')?.textContent ?? '')?.[0]`, { label: 'Alt+K to insert an @-mention', timeoutMs: 5_000 });
      evidence(`Alt+K with line 2 selected: the composer got "${mention}"`);
      await chat.click('.fg-composer__messageInput');
      await wb.key('a', 2);
      await wb.key('Backspace');

      const before = await currentMode(chat);
      await chat.click('.fg-composer__messageInput');
      await wb.key('Tab', 8);
      const after = await chat.waitFor(`(() => { const m = document.querySelector('.fg-menu__container button[title*="Shift+Tab"]')?.innerText.trim(); return m !== ${JSON.stringify(before)} && m })()`, { label: 'Shift+Tab to change the mode', timeoutMs: 5_000 });
      evidence(`Shift+Tab in the composer: "${before}" -> "${after}"`);
      await setMode(chat, 'Manual');

      const frames = (await wb.forgeFrames()).length;
      const forgeTabs = () => wb.evaluate(`return [...document.querySelectorAll('.tabs-container .tab')].filter(t => /Forge/.test(t.getAttribute('aria-label') ?? t.textContent)).length`);
      const tabsBefore = await forgeTabs();
      await wb.key('Escape', 2 | 8);
      await waitUntil(async () => (await wb.forgeFrames()).length > frames && (await forgeTabs()) > tabsBefore, { label: 'Ctrl+Shift+Esc to open a Forge tab', timeoutMs: 20_000 });
      evidence('Ctrl+Shift+Esc: a Forge chat opened in an editor tab');
      await wb.runCommand('View: Close Editor');
    },
  },
];

async function currentMode(chat) {
  return chat.evaluate(`return document.querySelector('.fg-menu__container button[title*="Shift+Tab"]')?.innerText.trim()`);
}

/** Choose a mode in the mode menu by its label (Manual, Edit automatically, Plan). */
export async function setMode(chat, label) {
  if ((await currentMode(chat)) === label) return;
  await dismissNotices(chat);
  await chat.click('.fg-menu__container button[title*="Shift+Tab"]');
  await chat.waitFor(`document.querySelector('.fg-menu__menuItemV2')`, { label: 'the mode menu' });
  await chat.click('.fg-menu__menuItemV2', { text: label });
  await chat.waitFor(`document.querySelector('.fg-menu__container button[title*="Shift+Tab"]')?.innerText.trim() === ${JSON.stringify(label)}`, { label: `mode ${label}` });
}

/** Turn Thinking on or off in the "/" menu. */
async function setThinking(ctx, chat, on) {
  await slashMenu(ctx, chat);
  const isOn = await chat.evaluate(`return !![...document.querySelectorAll('.fg-commandmenu__commandItem')].find(e => /^Thinking/.test(e.innerText))?.querySelector('.fg-toggle__trackOn')`);
  if (isOn !== on) {
    await chat.click('.fg-commandmenu__commandItem', { text: 'Thinking' });
    await chat.waitFor(`!![...document.querySelectorAll('.fg-commandmenu__commandItem')].find(e => /^Thinking/.test(e.innerText))?.querySelector('.fg-toggle__trackOn') === ${on}`, { label: `Thinking ${on ? 'on' : 'off'}` });
  }
  await closeSlashMenu(ctx, chat);
}

/**
 * Click the effort slider at a fraction of its track (0 = the left end,
 * 0.5 = the middle notch); returns the level label shown after.
 */
async function setEffortAt(ctx, chat, fraction) {
  const effortLabel = `/\\((\\w+)\\)/.exec([...document.querySelectorAll('.fg-commandmenu__commandItem')].find(e => /^Effort/.test(e.innerText))?.innerText ?? '')?.[1]`;
  await closeSlashMenu(ctx, chat);
  await slashMenu(ctx, chat);
  await chat.waitFor(effortLabel, { label: 'the Effort row' });
  const box = await chat.waitFor(`(() => { const r = document.querySelector('.fg-effortslider__toggle')?.getBoundingClientRect(); return r && r.width > 0 && { l: r.left, t: r.top, w: r.width, h: r.height }; })()`, { label: 'the effort slider' });
  await sleep(300);
  const o = await chat.offset();
  const x = fraction <= 0 ? box.l + 3 : box.l + box.w * fraction;
  await ctx.wb.click(o.x + x, o.y + box.t + box.h / 2);
  await sleep(600);
  const label = await chat.waitFor(effortLabel, { label: 'the effort level' });
  await closeSlashMenu(ctx, chat);
  return label;
}

/** Open the actions of the `which`-th user message (0 first, -1 last) and choose `option`. */
async function messageAction(chat, which, option) {
  const at = await chat.evaluate(`
    const b = [...document.querySelectorAll('.fg-messageactions__actionButton')].at(${which});
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    return true;`);
  if (!at) throw new Error('no message actions button');
  const handles = await chat.evaluate(`return document.querySelectorAll('.fg-messageactions__actionButton').length`);
  const index = which < 0 ? handles + which : which;
  await chat.hover('.fg-messageactions__actionButton', { index });
  await chat.click('.fg-messageactions__actionButton', { index });
  await chat.waitFor(`document.querySelector('.fg-messageactions__popupOption')`, { label: 'the message actions' });
  await chat.click('.fg-messageactions__popupOption', { text: option });
}

/** Hover a history row by its name and click one of its action buttons. */
async function rowAction(ctx, chat, name, title) {
  await chat.hover('.fg-sessions__sessionItem', { text: name });
  const at = await chat.evaluate(`
    const row = [...document.querySelectorAll('.fg-sessions__sessionItem')].find(r => r.textContent.includes(${JSON.stringify(name)}));
    const b = row && [...row.querySelectorAll('.fg-sessions__actionButton')].find(b => (b.getAttribute('title') ?? '').startsWith(${JSON.stringify(title)}));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
  if (!at) throw new Error(`no "${title}" on the row "${name}"`);
  const o = await chat.offset();
  await ctx.wb.click(o.x + at.x, o.y + at.y);
}

/** Choose an output style from the "/" menu's picker. */
async function pickOutputStyle(ctx, chat, style) {
  await slashMenu(ctx, chat);
  await chat.click('.fg-commandmenu__commandItem', { text: 'Output styles' });
  await chat.waitFor(`document.querySelector('#output-style-list .fg-outputstyle__styleItem')`, { label: 'the output style picker' });
  await chat.click('#output-style-list .fg-outputstyle__styleLabel', { text: style });
  await sleep(500);
}

/** Running copies of this install's CLI binary: [{ pid, args, baseUrl }] (Linux: /proc). */
export function cliProcesses(dirs) {
  if (process.platform !== 'linux') return [];
  const found = [];
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      if (!args[0]?.startsWith(dirs.extensions) || !args[0].endsWith('/claude')) continue;
      const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      const baseUrl = env.find((e) => e.startsWith('ANTHROPIC_BASE_URL='))?.slice('ANTHROPIC_BASE_URL='.length);
      found.push({ pid: Number(pid), args: args.join(' '), baseUrl });
    } catch {
      /* gone */
    }
  }
  return found;
}

/**
 * This install's bundled CLI binary: the one VSIX carries one per platform in
 * resources/native-binaries/<platform>-<arch>/ (a dev package, the single
 * resources/native-binary/ one).
 */
export function cliBinary(dirs) {
  const ext = fs.readdirSync(dirs.extensions).find((d) => d.startsWith('msaid.forge-'));
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const universal = path.join(dirs.extensions, ext, 'resources', 'native-binaries', `${process.platform}-${process.arch}`, name);
  if (fs.existsSync(universal)) return universal;
  return path.join(dirs.extensions, ext, 'resources', 'native-binary', name);
}

/** `[error]` lines in the newest Forge output channel log of this profile. */
/** The newest Forge.log's whole text. */
export function forgeLogText(dirs) {
  const logs = [];
  const walk = (dir, depth) => {
    if (depth > 5 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === 'Forge.log') logs.push(full);
    }
  };
  walk(path.join(dirs.userData, 'logs'), 0);
  const newest = logs.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).at(-1);
  return newest ? fs.readFileSync(newest, 'utf8') : '';
}

/** 48b: flip the "/" menu's Alpha mode row to `on`. */
async function setAlpha(ctx, chat, on) {
  await slashMenu(ctx, chat);
  const state = `!![...document.querySelectorAll('.fg-commandmenu__commandItem')].find(e => /^Alpha mode/.test(e.innerText))?.querySelector('.fg-toggle__trackOn')`;
  if ((await chat.evaluate(`return ${state}`)) !== on) {
    await chat.click('.fg-commandmenu__commandItem', { text: 'Alpha mode' });
    await chat.waitFor(`${state} === ${on}`, { label: `Alpha mode ${on ? 'on' : 'off'}` });
  }
  await closeSlashMenu(ctx, chat);
}

export function forgeLogErrors(dirs) {
  const logs = [];
  const walk = (dir, depth) => {
    if (depth > 5 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === 'Forge.log') logs.push(full);
    }
  };
  walk(path.join(dirs.userData, 'logs'), 0);
  const newest = logs.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).at(-1);
  return newest ? fs.readFileSync(newest, 'utf8').split('\n').filter((l) => l.includes('[error]')) : [];
}

/**
 * Per saved conversation, every title it can be listed under: its custom
 * titles, the first line the user typed, and each `last-prompt`.
 */
export function sessionTitleSets(dirs) {
  return sessionFiles(dirs).map((file) => {
    const titles = new Set();
    let first;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type === 'custom-title' && entry.customTitle) titles.add(entry.customTitle);
      if (entry.type === 'last-prompt' && entry.lastPrompt) titles.add(entry.lastPrompt.split('\n')[0]);
      if (!first && entry.type === 'user' && !entry.isMeta) {
        const content = entry.message?.content;
        const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '';
        const typed = text.replace(/<([a-z_-]+)>[\s\S]*?<\/\1>/g, '').trim();
        if (typed) first = typed.split('\n')[0];
      }
    }
    if (first) titles.add(first);
    return titles;
  });
}
