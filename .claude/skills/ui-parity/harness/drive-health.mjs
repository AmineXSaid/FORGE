/**
 * Drive the endpoint-health surfaces in the harness and print what they did.
 *
 * Every assertion here is a click or a read of the real built webview against
 * the stub host -- B8.3. Nothing is asserted from a screenshot.
 *
 *   node .claude/skills/ui-parity/harness/drive-health.mjs --port 8752
 */
import { launch, ORACLE } from '../scripts/cdp-driver.mjs';

const port = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '8752';
const base = `http://127.0.0.1:${port}/index.html`;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * The welcome page's two actions, in DOM order: the filled pill, then the
 * square (divergence #55 in `docs/forge-design.md`). Both are Forge's own
 * classes; the page keeps only the official `.fg-welcome__container`.
 */
const ACTION_SELECTOR = '.forge-welcome__primary, .forge-welcome__secondary';
const WELCOME_BUTTONS =
  "return [...document.querySelectorAll('" + ACTION_SELECTOR + "')].map(b => b.textContent.trim())";

/** One chip per endpoint: its name, what it says, and its dot's tone. */
const CHIPS = `
  return [...document.querySelectorAll('.forge-welcome__chip')].map(li => ({
    text: li.textContent.trim().replace(/\\s+/g, ' '),
    tone: li.querySelector('.forge-welcome__dot').dataset.tone,
  }))
`;

/** The large count, its unit and the line under it. */
const COUNT = `
  return (() => {
    const c = document.querySelector('.forge-welcome__count');
    return c && {
      text: c.textContent.trim().replace(/\\s+/g, ' '),
      tone: c.dataset.tone,
      label: document.querySelector('.forge-welcome__countLabel').textContent.trim(),
    };
  })()
`;

const HEADER = `return document.querySelectorAll('.fg-shell__header').length`;

async function centreOf(selector, text) {
  return page.eval(`
    return (() => {
      const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)}));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()
  `);
}

async function boot(page, query) {
  // A skip persists in localStorage, which is the point of it -- so every case
  // starts from a cleared one, or the first skipped run hides the gate from
  // every run after it.
  await page.navigate(`${base}${query}`, 800);
  await page.eval(`localStorage.clear(); return true`);
  await page.navigate(`${base}${query}`);
  await new Promise((r) => setTimeout(r, 2500));
  const sheets = await page.eval(
    `return [...document.styleSheets].map(s => { try { return s.cssRules.length } catch { return 'ERR' } })`,
  );
  if (!Array.isArray(sheets) || sheets.every((n) => n === 0)) {
    throw new Error(`stylesheets not parsed: ${JSON.stringify(sheets)}`);
  }
}

const page = await launch({ width: 420, height: 820 });
try {
  // -- 1. First run: no profiles at all ---------------------------------------
  await boot(page, '?endpoints=0');
  const a = await page.eval(WELCOME_BUTTONS);
  record('1 first run: "Set up an endpoint" and "Use the terminal"',
    JSON.stringify(a) === JSON.stringify(['Set up an endpoint', 'Use the terminal']), JSON.stringify(a));
  record('1 first run: no header, as the official login page', (await page.eval(HEADER)) === 0);
  const headline = await page.eval(`return document.querySelector('.forge-welcome__headline').textContent.trim().replace(/\\s+/g, ' ')`);
  record('1 first run: the headline', headline === 'Claude Code, reforged,on the model you choose', JSON.stringify(headline));
  const noSummary = await page.eval(`return document.querySelectorAll('.forge-welcome__summary, .forge-welcome__chip').length`);
  record('1 first run: no summary, only the statement', noSummary === 0, `summary nodes=${noSummary}`);

  // "Use the terminal" opens a terminal, with nothing the webview may not pass.
  const term = await centreOf('.forge-welcome__secondary', 'Use the terminal');
  await page.click(term.x, term.y);
  await new Promise((r) => setTimeout(r, 400));
  const opens = await page.eval(`return window.__forgeTerminalOpens ?? []`);
  record('1 "Use the terminal" sends open_claude_in_terminal, no prompt, no args',
    opens.length === 1 && opens[0].prompt === undefined && opens[0].args === undefined, JSON.stringify(opens));

  // -- 2. Setting up: the add flow is open ------------------------------------
  await boot(page, '?endpoints=0');
  await page.eval(`window.__forgeAddDelayMs = 60000; return true`);
  const setUp = await centreOf('.forge-welcome__primary', 'Set up an endpoint');
  await page.click(setUp.x, setUp.y);
  await new Promise((r) => setTimeout(r, 300));
  const adding = await page.eval(`
    return (() => {
      const b = document.querySelector('.forge-welcome__primary');
      return { label: b.textContent.trim(), disabled: b.disabled, busy: b.getAttribute('aria-busy'),
               spinner: !!b.querySelector('.forge-welcome__spinner'),
               hint: document.querySelector('.forge-welcome__caption--hint')?.textContent.trim() ?? null,
               overflow: document.scrollingElement.scrollWidth > innerWidth };
    })()
  `);
  record('2 setting up: the pill says so, spins, and cannot be pressed twice',
    adding.label === 'Setting up…' && adding.disabled && adding.busy === 'true' && adding.spinner, JSON.stringify(adding));
  record('2 setting up: the caption points at the prompts', adding.hint === 'Answer the prompts at the top of the window.', String(adding.hint));
  record('2 setting up: nothing overflows a 420px sidebar', adding.overflow === false);

  // -- 3. Profiles, never checked ---------------------------------------------
  await boot(page, '?endpoints=2&health=never&models=none');
  const b = await page.eval(WELCOME_BUTTONS);
  record('3 unchecked: "Check models" and "Use the terminal"',
    JSON.stringify(b) === JSON.stringify(['Check models', 'Use the terminal']), JSON.stringify(b));
  const bCount = await page.eval(COUNT);
  record('3 unchecked: counts endpoints, since no model count exists yet',
    bCount?.text === '2 endpoints' && bCount.label === 'not checked yet' && bCount.tone === 'plain', JSON.stringify(bCount));
  const bChips = await page.eval(CHIPS);
  record('3 unchecked: one chip per endpoint, "not checked"',
    bChips.length === 2 && bChips.every((c) => c.text.endsWith('· not checked') && c.tone === 'plain'), JSON.stringify(bChips));
  const hollow = await page.eval(`return [...document.querySelectorAll('.forge-welcome__segment')].map(s => s.dataset.kind)`);
  record('3 unchecked: the bar is hollow', JSON.stringify(hollow) === '["hollow","hollow"]', JSON.stringify(hollow));
  record('3 unchecked: no header', (await page.eval(HEADER)) === 0);

  // -- 4. Checking: press "Check models" --------------------------------------
  const check = await centreOf('.forge-welcome__primary', 'Check models');
  await page.click(check.x, check.y);
  await new Promise((r) => setTimeout(r, 120));
  const during = await page.eval(`
    return (() => {
      const b = document.querySelector('.forge-welcome__primary');
      return { label: b.textContent.trim(), disabled: b.disabled,
               ticks: document.querySelectorAll('.forge-welcome__segment[data-kind="live"] .forge-welcome__tick').length,
               chips: [...document.querySelectorAll('.forge-welcome__chip')].map(c => c.textContent.trim().replace(/\\s+/g, ' ')) };
    })()
  `);
  const duringCount = await page.eval(COUNT);
  record('4 checking: the pill says "Checking…" and waits',
    during.label === 'Checking…' && during.disabled, JSON.stringify(during));
  record('4 checking: live progress, one tick per model',
    duringCount?.label === 'models checked' && duringCount.tone === 'live' && during.ticks === 16 &&
      during.chips.every((c) => /· checking 0 of 8$/.test(c)),
    JSON.stringify({ duringCount, during }));

  // -- 5. Measured, nothing answered ------------------------------------------
  await boot(page, '?endpoints=2&health=none');
  const c = await page.eval(WELCOME_BUTTONS);
  record('5 none answered: "Check again" and "Skip to chat"',
    JSON.stringify(c) === JSON.stringify(['Check again', 'Skip to chat']), JSON.stringify(c));
  const cCount = await page.eval(COUNT);
  record('5 none answered: the count is the verdict',
    cCount?.text === '0 of 10' && cCount.label === 'models answered' && cCount.tone === 'dead', JSON.stringify(cCount));
  const cChips = await page.eval(CHIPS);
  record('5 none answered: each chip counts what answered out of what was asked',
    cChips.length === 2 && cChips.every((x) => /· 0 of 5$/.test(x.text) && x.tone === 'dead'), JSON.stringify(cChips));
  const loud = await page.eval(`
    return (() => {
      const count = document.querySelector('.forge-welcome__count');
      const dot = document.querySelector('.forge-welcome__dot[data-tone="dead"]');
      return { count: getComputedStyle(count).color, figures: getComputedStyle(count).fontVariantNumeric,
               dot: getComputedStyle(dot).backgroundColor };
    })()
  `);
  record('5 none answered: the zero reads loud, in tabular figures', loud.figures.includes('tabular-nums'), JSON.stringify(loud));

  // No spaced em dash anywhere the reader can see it.
  const dashes = await page.eval(
    `return (document.querySelector('.fg-welcome__container').innerText.match(/ [—] /g) || []).length`,
  );
  record('5 no spaced em dash in the copy', dashes === 0, `found=${dashes}`);

  const skipMark = await page.eval(`
    return (() => {
      const b = document.querySelector('.forge-welcome__secondary');
      const nodes = [...b.childNodes];
      const svg = b.querySelector('svg');
      const svgAt = nodes.findIndex(n => n === svg || (n.contains && n.contains(svg)));
      const textAt = nodes.findIndex(n => n.nodeType === 3 && n.textContent.trim());
      return { svg: b.querySelectorAll('svg').length, trailing: svgAt > textAt && textAt !== -1 };
    })()
  `);
  record('5 "Skip to chat" carries one drawn arrow, trailing', skipMark.svg === 1 && skipMark.trailing, JSON.stringify(skipMark));

  // A healthy endpoint puts the gate away entirely.
  await boot(page, '?endpoints=2&health=mixed');
  const none = await page.eval(`return document.querySelectorAll('.fg-welcome__container').length`);
  record('healthy endpoints show no welcome at all', none === 0, `containers=${none}`);
  record('healthy endpoints: the header is back', (await page.eval(HEADER)) === 1);

  // -- Click "Check again" ----------------------------------------------------
  await boot(page, '?endpoints=2&health=none');
  const box = await centreOf('.forge-welcome__primary', 'Check again');
  await page.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 1200));
  const syncs = await page.eval(`return JSON.stringify(window.__forgeEndpointHealthSyncs)`);
  record('"Check again" sends sync_endpoint_health', String(syncs).includes('"cancel":false'), String(syncs));
  // The gate lifts itself: one model answering is the whole condition, and the
  // pushed verdict is what tells the page so -- no reload, no second handshake.
  const afterSync = await page.eval(`return document.querySelectorAll('.fg-welcome__container').length`);
  const healthyNow = await page.eval(`return window.__forgeEndpointHealth[0].models.filter(m => m.servable).length`);
  record('a sweep that finds a live model lifts the gate, from the push alone',
    afterSync === 0 && healthyNow === 1, `containers=${afterSync} healthy=${healthyNow}`);

  // -- Click "Skip to chat" ---------------------------------------------------
  await boot(page, '?endpoints=2&health=none');
  const skipBox = await centreOf('.forge-welcome__secondary', 'Skip to chat');
  await page.click(skipBox.x, skipBox.y);
  await new Promise((r) => setTimeout(r, 600));
  const gone = await page.eval(`return document.querySelectorAll('.fg-welcome__container').length`);
  const composer = await page.eval(`return document.querySelectorAll('.fg-chat__inputContainer').length`);
  record('"Skip to chat" puts the gate away and shows the composer', gone === 0 && composer > 0,
    `containers=${gone} composers=${composer}`);
  const persisted = await page.eval(`return localStorage.getItem('forge.endpointWelcomeSkipped')`);
  record('the skip is remembered', persisted === '1', String(persisted));

  // -- The failure path: an out-of-date host ----------------------------------
  await boot(page, '?endpoints=2&health=none');
  await page.eval(`window.__forgeRejectRequests.add('sync_endpoint_health'); return true`);
  const box2 = await centreOf('.forge-welcome__primary', 'Check again');
  await page.click(box2.x, box2.y);
  await new Promise((r) => setTimeout(r, 800));
  const notes = await page.eval(`return JSON.stringify(window.__forgeNotifications)`);
  record('a rejected sweep reports the failure rather than looking dead',
    String(notes).includes('could not check the endpoints'), String(notes).slice(0, 220));

  // -- The Settings table -----------------------------------------------------
  // `?page=settings&tab=endpoints` is step 31's own bootstrap: the tab a panel
  // opens on, exactly as `webViewService` puts it there.
  await page.raw('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
  await boot(page, '?page=settings&tab=endpoints&endpoints=2&health=none');
  const table = await page.eval(`
    return (() => {
      const rows = [...document.querySelectorAll('.forge-health__table tbody tr.forge-health__row')];
      return rows.filter(r => !r.classList.contains('forge-health__row--detail')).map(r =>
        [...r.querySelectorAll('td')].map(td => td.textContent.trim()));
    })()
  `);
  record('the Settings table lists one row per endpoint',
    Array.isArray(table) && table.length >= 2 && table[0][1] === 'unreachable', JSON.stringify(table));

  const headers = await page.eval(
    `return [...document.querySelectorAll('.forge-health__table thead th')].map(th => th.textContent.trim())`,
  );
  record('its columns are the ones specified',
    JSON.stringify(headers) === JSON.stringify(['Endpoint', 'Status', 'Healthy', 'Median ping', 'Last checked', '']),
    JSON.stringify(headers));

  // Expand a row: this is where "60 returned 404" becomes visible.
  const caret = await page.eval(`
    return (() => {
      const b = document.querySelector('.forge-health__disclosure');
      // Below the fold on a 1000px page: laid out, but a click there misses.
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()
  `);
  await page.click(caret.x, caret.y);
  await new Promise((r) => setTimeout(r, 400));
  const detail = await page.eval(`
    return (() => {
      const rows = [...document.querySelectorAll('.forge-health__models tbody tr')];
      return {
        count: rows.length,
        details: rows.map(r => r.querySelector('.forge-health__detail').textContent.trim()).filter(Boolean),
        alarm: document.querySelector('.forge-health__alarm-why')?.textContent.trim() ?? null,
      };
    })()
  `);
  record('expanding a row shows each model’s reason',
    detail.count === 5 && detail.details.includes('listed, but accepted the request and never answered'),
    JSON.stringify(detail).slice(0, 260));
  record('the zero-healthy state names the commonest failure',
    typeof detail.alarm === 'string' && detail.alarm.includes('HTTP 404'), String(detail.alarm));

  // Per-row Sync, through `runHostAction`.
  const rowSync = await page.eval(`
    return (() => {
      const b = [...document.querySelectorAll('.forge-health__col-action button')][0];
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()
  `);
  await page.click(rowSync.x, rowSync.y);
  await new Promise((r) => setTimeout(r, 1200));
  const rowSyncs = await page.eval(`return JSON.stringify(window.__forgeEndpointHealthSyncs)`);
  record('the row Sync button names its own profile',
    String(rowSyncs).includes('"profileName":"nvidia-nim"'), String(rowSyncs));
  const afterRow = await page.eval(
    `return document.querySelector('.forge-health__table tbody tr td:nth-child(2)').textContent.trim()`,
  );
  record('a swept endpoint turns alive in the table', afterRow === 'alive', String(afterRow));

  // -- probe-oracle on the welcome page ---------------------------------------
  await page.raw('Emulation.setDeviceMetricsOverride', { width: 420, height: 820, deviceScaleFactor: 1, mobile: false });
  await boot(page, '?endpoints=2&health=none');
  const oracle = await page.eval(ORACLE('.fg-welcome__container'));
  console.log('\nprobe-oracle (.fg-welcome__container):');
  console.log(typeof oracle === 'string' ? oracle : JSON.stringify(oracle, null, 2));
} finally {
  await page.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
