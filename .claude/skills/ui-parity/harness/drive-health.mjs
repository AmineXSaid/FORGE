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
 * The welcome page's actions, in DOM order.
 *
 * Two selectors, because the three actions deliberately do not share a class:
 * the primary keeps the official `.fg-welcome__fullWidthButton`, and the two
 * Forge-only ones sit on `.forge-welcome__action` so no ported rule is
 * overridden (`docs/forge-design.md`, divergence #8). Querying the official
 * class alone reports every state as offering one button.
 */
const ACTION_SELECTOR = '.fg-welcome__fullWidthButton, .forge-welcome__action';
const WELCOME_BUTTONS =
  "return [...document.querySelectorAll('" + ACTION_SELECTOR + "')].map(b => b.textContent.trim())";

const HEALTH_ROWS = `
  return [...document.querySelectorAll('.forge-welcome__report tbody tr')].map(tr => ({
    name: tr.querySelector('.forge-welcome__reportName').textContent.trim(),
    count: tr.querySelector('.forge-welcome__reportNum').textContent.trim(),
    state: tr.querySelector('.forge-welcome__reportNum').dataset.state,
  }))
`;

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

const page = await launch({ width: 900, height: 1000 });
try {
  // -- State A: no profiles at all --------------------------------------------
  await boot(page, '?endpoints=0');
  const a = await page.eval(WELCOME_BUTTONS);
  record('A: no profiles offers only "Set up an endpoint"', JSON.stringify(a) === JSON.stringify(['Set up an endpoint']), JSON.stringify(a));

  // -- State B: profiles, nothing offered, never checked ----------------------
  await boot(page, '?endpoints=2&health=never&models=none');
  const b = await page.eval(WELCOME_BUTTONS);
  record('B: unchecked offers "Set up an endpoint" + "Check health"',
    JSON.stringify(b) === JSON.stringify(['Set up an endpoint', 'Check health']), JSON.stringify(b));
  const bRows = await page.eval(HEALTH_ROWS);
  record('B: the endpoint table says "not checked"',
    Array.isArray(bRows) && bRows.length === 2 && bRows.every((r) => r.count === 'not checked' && r.state === 'unknown'),
    JSON.stringify(bRows));
  const bHead = await page.eval(
    `return [...document.querySelectorAll('.forge-welcome__report thead th')].map(th => th.textContent.trim())`,
  );
  record('B: it is a real table, with a heading naming the unit',
    JSON.stringify(bHead) === JSON.stringify(['Endpoint', 'Answering']), JSON.stringify(bHead));

  // -- State C: measured, nothing answered ------------------------------------
  await boot(page, '?endpoints=2&health=none');
  const c = await page.eval(WELCOME_BUTTONS);
  record('C: zero healthy adds "Skip to chat"',
    JSON.stringify(c) === JSON.stringify(['Set up an endpoint', 'Check health', 'Skip to chat']), JSON.stringify(c));
  const cRows = await page.eval(HEALTH_ROWS);
  record('C: the table counts what answered out of what was asked',
    Array.isArray(cRows) && cRows.every((r) => /^0 of \d+$/.test(r.count) && r.state === 'dead'),
    JSON.stringify(cRows));
  const loud = await page.eval(`
    return (() => {
      const cell = document.querySelector('.forge-welcome__reportNum[data-state="dead"]');
      const dot = document.querySelector('.forge-welcome__dot[data-state="dead"]');
      return { count: getComputedStyle(cell).color, align: getComputedStyle(cell).textAlign,
               figures: getComputedStyle(cell).fontVariantNumeric,
               dot: getComputedStyle(dot).backgroundColor };
    })()
  `);
  record('C: the zero reads as a verdict, in tabular figures, with a status dot',
    loud.count === loud.dot && loud.align === 'right' && loud.figures.includes('tabular-nums'),
    JSON.stringify(loud));
  const heads = await page.eval(`
    return (() => {
      const th = [...document.querySelectorAll('.forge-welcome__report thead th')];
      return { labels: th.map(t => t.textContent.trim()), numAlign: getComputedStyle(th[1]).textAlign };
    })()
  `);
  record('C: the column heading sits over its own column',
    heads.numAlign === 'right' && heads.labels[1] === 'Answering', JSON.stringify(heads));

  // No spaced em dash anywhere the reader can see it.
  const dashes = await page.eval(
    `return (document.querySelector('.fg-welcome__baseState').innerText.match(/ [\u2014] /g) || []).length`,
  );
  record('C: no spaced em dash in the copy', dashes === 0, `found=${dashes}`);

  // The two Forge-only actions carry drawn marks, not typed glyphs.
  const marks = await page.eval(`
    return [...document.querySelectorAll('.forge-welcome__action')].map(b => {
      const svg = b.querySelector('svg');
      // Among *all* child nodes, so a text label counts. firstElementChild
      // skips text, and answered "leading" for a trailing icon.
      const nodes = [...b.childNodes];
      const svgAt = nodes.findIndex(n => n === svg || (n.contains && n.contains(svg)));
      const textAt = nodes.findIndex(n => n.nodeType === 3 && n.textContent.trim());
      return {
        label: b.textContent.trim(),
        svg: b.querySelectorAll('svg').length,
        leading: svgAt !== -1 && textAt !== -1 && svgAt < textAt,
      };
    })
  `);
  record('C: each action carries one drawn icon, check leading and skip trailing',
    marks.length === 2 && marks.every((m) => m.svg === 1) && marks[0].leading === true && marks[1].leading === false,
    JSON.stringify(marks));

  // A healthy endpoint puts the gate away entirely.
  await boot(page, '?endpoints=2&health=mixed');
  const none = await page.eval(`return document.querySelectorAll('.fg-welcome__container').length`);
  record('healthy endpoints show no welcome at all', none === 0, `containers=${none}`);

  // -- Click "Check health" ---------------------------------------------------
  await boot(page, '?endpoints=2&health=none');
  const box = await page.eval(`
    return (() => {
      const b = [...document.querySelectorAll('.fg-welcome__fullWidthButton, .forge-welcome__action')].find(x => x.textContent.trim() === 'Check health');
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()
  `);
  await page.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 1200));
  const syncs = await page.eval(`return JSON.stringify(window.__forgeEndpointHealthSyncs)`);
  record('"Check health" sends sync_endpoint_health', String(syncs).includes('"cancel":false'), String(syncs));
  // The gate lifts itself: one model answering is the whole condition, and the
  // pushed verdict is what tells the page so -- no reload, no second handshake.
  const afterSync = await page.eval(`return document.querySelectorAll('.fg-welcome__container').length`);
  const healthyNow = await page.eval(`return window.__forgeEndpointHealth[0].models.filter(m => m.servable).length`);
  record('a sweep that finds a live model lifts the gate, from the push alone',
    afterSync === 0 && healthyNow === 1, `containers=${afterSync} healthy=${healthyNow}`);

  // -- Click "Skip to chat" ---------------------------------------------------
  await boot(page, '?endpoints=2&health=none');
  const skipBox = await page.eval(`
    return (() => {
      const b = [...document.querySelectorAll('.fg-welcome__fullWidthButton, .forge-welcome__action')].find(x => x.textContent.trim() === 'Skip to chat');
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()
  `);
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
  const box2 = await page.eval(`
    return (() => {
      const b = [...document.querySelectorAll('.fg-welcome__fullWidthButton, .forge-welcome__action')].find(x => x.textContent.trim() === 'Check health');
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()
  `);
  await page.click(box2.x, box2.y);
  await new Promise((r) => setTimeout(r, 800));
  const notes = await page.eval(`return JSON.stringify(window.__forgeNotifications)`);
  record('a rejected sweep reports the failure rather than looking dead',
    String(notes).includes('could not check the endpoints'), String(notes).slice(0, 220));

  // -- The Settings table -----------------------------------------------------
  // `?page=settings&tab=endpoints` is step 31's own bootstrap: the tab a panel
  // opens on, exactly as `webViewService` puts it there.
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
