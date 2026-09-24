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
    await chat.click('.fg-notice__container .fg-notice__header .fg-iconbutton__iconButton');
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

/** Start a new conversation from the chat header. */
export async function newSession(chat) {
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
      const cliBefore = cliProcesses(dirs);
      await slashMenu(ctx, chat);
      await chat.click('.fg-commandmenu__commandItem', { text: 'Open Forge in Terminal' });
      await wb.waitFor(`[...document.querySelectorAll('.tabs-container .tab, .terminal-tabs-entry, .single-terminal-tab')].some(t => /Forge/.test(t.textContent) || /Forge/.test(t.getAttribute('aria-label') ?? ''))`, { label: 'a terminal named Forge', timeoutMs: 20_000 });
      evidence('a terminal named "Forge" opened');
      const started = await waitUntil(() => cliProcesses(dirs).find((p) => !cliBefore.some((b) => b.pid === p.pid) && !p.args.includes('stream-json')), { label: 'an interactive CLI process', timeoutMs: 30_000 });
      evidence(`the terminal runs the bundled CLI (pid ${started.pid}${started.baseUrl ? `, ANTHROPIC_BASE_URL ${started.baseUrl}` : ''})`);
      assert(!started.baseUrl || /127\.0\.0\.1|localhost/.test(started.baseUrl), `the terminal CLI goes to ${started.baseUrl}`);
      await wb.runCommand('Terminal: Kill All Terminals');

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
        // Windows x64: "The Claude Code binary is missing from this Forge
        // install"; elsewhere the platform notice says there is no binary.
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
        if (process.platform !== 'win32' && process.getuid?.() === 0) {
          // Claude Code refuses bypass as root; a Linux stand-in container is
          // root. What can be proven here is that Forge says why.
          const banner = await chat.waitFor(`document.querySelector('.fg-chat__errorBanner')?.innerText`, { label: 'the error banner', timeoutMs: 60_000 });
          assert(/root\/sudo privileges/.test(banner), `banner: ${banner.slice(0, 200)}`);
          evidence(`running as root, the CLI refused bypass and the chat said why: "${banner.split('\n')[0].slice(0, 160)}"`);
          evidence('the unprompted run is not observable as root: on the Windows checklist');
          return 'partial';
        }
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
    // Last: pressing Ctrl+Esc inside a webview makes code-server's next page
    // reload hang (VS Code's own Markdown preview does it too), so this runs
    // after every scenario that reloads.
    id: 13,
    title: 'Keybindings: Ctrl+Esc focus and blur, Alt+K mention, Ctrl+Shift+Esc new tab, Shift+Tab mode cycle',
    async run(ctx) {
      const { evidence, wb } = ctx;
      const chat = await openChat(ctx);
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

/** This install's bundled CLI binary. */
export function cliBinary(dirs) {
  const ext = fs.readdirSync(dirs.extensions).find((d) => d.startsWith('msaid.forge-'));
  const base = path.join(dirs.extensions, ext, 'resources', 'native-binary');
  return path.join(base, fs.readdirSync(base).find((f) => f === 'claude' || f === 'claude.exe'));
}

/** `[error]` lines in the newest Forge output channel log of this profile. */
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
