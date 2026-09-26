#!/usr/bin/env node
/**
 * Forge end to end: package, install into an isolated VS Code, drive it over
 * CDP, run the scenarios, write a report, close.
 *
 *   node .claude/skills/ui-parity/e2e/launch.mjs [options]
 *
 * Host (pick one):
 *   --code <Code.exe|code>      VS Code desktop (Windows: the real target)
 *   --code-server <bin>         code-server in headless Chromium (Linux stand-in)
 *
 * Package:
 *   --vsix <file>               install this VSIX (default: package one with
 *                               `pnpm run package`: forge.vsix, Windows and Linux)
 *
 * Gateway (pick one):
 *   --stub                      start stub-gateway.mjs and route to it
 *   --gateway <url> --model <id> [--auth-env <VAR>]
 *                               a real OpenAI-compatible gateway; the key, if
 *                               any, is read by Forge from the environment
 *                               variable named here (`${env:VAR}`), never
 *                               written to disk or to a log
 *   --capabilities <json>       the profile's `capabilities` (default with
 *                               --stub: effort low..xhigh, reasoning_content)
 *
 * Run:
 *   --root <dir>                isolated home/profile/extensions/workspace
 *                               (default: a fresh temp folder)
 *   --only <ids>                comma-separated scenario ids (default: all)
 *   --out <dir>                 report + evidence (default: <root>/report)
 *   --keep                      leave the host running after the run
 *   --scenario-timeout <s>      give up on a scenario after this long (240)
 *   --cdp <port>                DevTools port (default 9460)
 *   --attach [desktop]          run against the host a `--keep` run left open
 *                               (same --root and --cdp; add --stub if it used one)
 *
 * Isolation: the host gets its own user-data and extensions folders, and a
 * HOME/USERPROFILE of its own, so `~/.claude` is a fresh folder the run can
 * inspect. Its environment is rebuilt from nothing but PATH, locale and
 * system variables, so no credential of the machine running this script
 * reaches the CLI. The window is titled `forge-e2e-<run id>`; on Windows it is
 * closed by that exact title and nothing else.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp.mjs';
import { workbench } from './workbench.mjs';
import { SCENARIOS } from './scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const RUN_ID = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const TITLE = `forge-e2e-${RUN_ID}`;
const IS_WIN = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Isolation

export function isolatedRoot(root) {
  const dirs = {
    root,
    home: path.join(root, 'home'),
    userData: path.join(root, 'user-data'),
    extensions: path.join(root, 'extensions'),
    workspace: path.join(root, 'workspace'),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  return dirs;
}

/** The host's environment: system basics only, with the isolated home. */
export function cleanEnvironment(home, base = process.env) {
  const keep = IS_WIN
    ? ['SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS']
    : ['LANG', 'LC_ALL', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'DISPLAY'];
  const env = {};
  for (const key of keep) if (base[key] !== undefined) env[key] = base[key];
  env.PATH = base.PATH ?? base.Path ?? '';
  env.HOME = home;
  if (IS_WIN) {
    env.USERPROFILE = home;
    env.APPDATA = path.join(home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
    fs.mkdirSync(env.APPDATA, { recursive: true });
    fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
  }
  return env;
}

/** What the stub gateway honours: effort up to xhigh, reasoning as `reasoning_content`. */
export const STUB_CAPABILITIES = { tools: true, effort: true, effortLevels: ['low', 'medium', 'high', 'xhigh'], reasoningField: 'reasoning_content' };

export function userSettings({ gateway, model, authEnv, capabilities }) {
  return {
    'window.title': TITLE,
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'chat.disableAIFeatures': true,
    // The workspace opens untrusted (the Restricted Mode scenario runs first,
    // then trusts it through the real UI). Dialogs are drawn in the DOM so
    // CDP can drive them; the desktop default is a native dialog.
    'security.workspace.trust.startupPrompt': 'never',
    'window.dialogStyle': 'custom',
    'forge.endpoints': {
      e2e: {
        wire: 'openai',
        baseUrl: gateway,
        model,
        auth: authEnv ? { kind: 'bearer', value: `\${env:${authEnv}}` } : { kind: 'none' },
        ...(capabilities && { capabilities }),
      },
    },
    'forge.endpointProfile': 'e2e',
    'forge.endpointHealth.syncIntervalMinutes': 0,
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function seedWorkspace(dir) {
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'Forge e2e workspace.\nline two\nline three\n');
  if (!fs.existsSync(path.join(dir, '.git'))) {
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=e2e@forge.invalid', '-c', 'user.name=forge-e2e', 'add', '.'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=e2e@forge.invalid', '-c', 'user.name=forge-e2e', 'commit', '-q', '-m', 'seed'], { cwd: dir });
  }
}

// ---------------------------------------------------------------------------
// Hosts

function findChrome() {
  if (process.env.FORGE_CHROME) return process.env.FORGE_CHROME;
  const candidates = [];
  if (IS_WIN) {
    for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
      if (base) candidates.push(path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    try {
      for (const d of fs.readdirSync('/opt/pw-browsers')) if (d.startsWith('chromium')) candidates.push(`/opt/pw-browsers/${d}/chrome-linux/chrome`);
    } catch {
      /* none */
    }
    candidates.push('/usr/bin/chromium', '/usr/bin/google-chrome');
  }
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('no Chrome/Chromium found; set FORGE_CHROME');
  return found;
}

async function waitHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error(`nothing answered at ${url}`);
}

export async function startCodeServer({ bin, dirs, env, vsix, cdpPort, log }) {
  const common = ['--user-data-dir', dirs.userData, '--extensions-dir', dirs.extensions];
  const install = spawnSync(bin, [...common, '--install-extension', vsix, '--force'], { env, encoding: 'utf8' });
  log(`install: ${(install.stdout + install.stderr).trim().split('\n').at(-1)}`);
  if (install.status !== 0) throw new Error(`code-server --install-extension failed: ${install.stderr}`);
  const port = Number(opt('--port', '8095'));
  const server = spawn(bin, [...common, '--auth', 'none', '--bind-addr', `127.0.0.1:${port}`, '--disable-telemetry', '--disable-update-check', dirs.workspace], {
    env,
    detached: flag('--keep'),
    stdio: ['ignore', fs.openSync(path.join(dirs.root, 'code-server.log'), 'w'), fs.openSync(path.join(dirs.root, 'code-server.log'), 'a')],
  });
  await waitHttp(`http://127.0.0.1:${port}/healthz`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-e2e-chrome-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      '--no-first-run',
      '--disable-background-networking',
      '--disable-component-update',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      '--window-size=1400,1000',
      'about:blank',
    ],
    { stdio: 'ignore', detached: flag('--keep') },
  );
  const cdp = await connect(cdpPort);
  const page = await cdp.page();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, page);
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/?folder=${encodeURIComponent(dirs.workspace)}` }, page);
  return {
    kind: 'code-server',
    cdp,
    page,
    async reload() {
      await cdp.send('Page.reload', { ignoreCache: false }, page);
      // The size override does not always survive a reload, and a workbench
      // laid out for another height cuts the chat's composer off.
      await sleep(1000);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, page);
    },
    async close() {
      cdp.close();
      chrome.kill();
      server.kill();
      await sleep(500);
    },
  };
}

/** Quote for cmd.exe, which a .cmd needs (spawn with shell does not quote). */
const cmdQuote = (arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);

/**
 * VS Code desktop. `--code` is `Code.exe` (or `code` on Linux/macOS). The
 * extension is installed through the CLI wrapper beside it (`bin\code.cmd` on
 * Windows), because `Code.exe --install-extension` opens a window instead.
 */
export async function startDesktop({ bin, dirs, env, vsix, cdpPort, log }) {
  const common = ['--user-data-dir', dirs.userData, '--extensions-dir', dirs.extensions];
  const wrapper = IS_WIN && /\.exe$/i.test(bin) ? path.join(path.dirname(bin), 'bin', 'code.cmd') : bin;
  const viaCmd = IS_WIN && /\.(cmd|bat)$/i.test(wrapper);
  const installArgs = [...common, '--install-extension', vsix, '--force'];
  const install = viaCmd
    ? spawnSync([wrapper, ...installArgs].map(cmdQuote).join(' '), { env, encoding: 'utf8', shell: true })
    : spawnSync(wrapper, installArgs, { env, encoding: 'utf8' });
  log(`install: ${`${install.stdout ?? ''}${install.stderr ?? ''}`.trim().split('\n').at(-1)}`);
  if (install.status !== 0) throw new Error(`--install-extension failed: ${install.stderr}`);
  const child = spawn(bin, [...common, `--remote-debugging-port=${cdpPort}`, '--new-window', dirs.workspace], { env, stdio: 'ignore', detached: true });
  child.unref();
  const cdp = await connect(cdpPort, { timeoutMs: 90_000 });
  const page = await cdp.page((t) => t.url.startsWith('vscode-file://') && t.url.includes('workbench'));
  return {
    kind: 'desktop',
    cdp,
    page,
    async reload() {
      await workbench(cdp, page).runCommand('Developer: Reload Window');
      await sleep(3000);
    },
    async close() {
      try {
        await workbench(cdp, page).runCommand('File: Exit');
      } catch {
        /* already closing */
      }
      cdp.close();
      await sleep(3000);
      if (IS_WIN) {
        // Only the window this run opened: `window.title` makes its title
        // exactly TITLE, unique to the run, so no other VS Code window matches.
        spawnSync('taskkill', ['/FI', `WINDOWTITLE eq ${TITLE}`, '/T', '/F'], { stdio: 'ignore' });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Run

let ctxVsix = '(attached)';

async function main() {
  const root = path.resolve(opt('--root', fs.mkdtempSync(path.join(os.tmpdir(), 'forge-e2e-'))));
  const dirs = isolatedRoot(root);
  const out = path.resolve(opt('--out', path.join(root, 'report')));
  fs.mkdirSync(out, { recursive: true });
  const log = (line) => {
    console.log(line);
    fs.appendFileSync(path.join(out, 'run.log'), `${line}\n`);
  };
  fs.writeFileSync(path.join(out, 'run.log'), '');

  const cdpPort = Number(opt('--cdp', '9460'));
  let stub;
  let gateway = opt('--gateway');
  let model = opt('--model');
  const authEnv = opt('--auth-env');
  let host;

  if (flag('--attach')) {
    // Re-run scenarios against a host an earlier `--keep` run left open.
    const cdp = await connect(cdpPort);
    const page = await cdp.page((t) => t.url.startsWith('http://127.0.0.1:') || t.url.includes('workbench'));
    const settings = JSON.parse(fs.readFileSync(path.join(dirs.userData, 'User', 'settings.json'), 'utf8'));
    gateway = settings['forge.endpoints'].e2e.baseUrl;
    model = settings['forge.endpoints'].e2e.model;
    if (flag('--stub')) stub = { kill() {} };
    host = {
      kind: opt('--attach', 'code-server') === 'desktop' ? 'desktop' : 'code-server',
      cdp,
      page,
      async reload() {
        await cdp.send('Page.reload', {}, page);
        await sleep(1000);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, page);
      },
      close: async () => cdp.close(),
    };
  } else {
    let vsix = opt('--vsix');
    if (!vsix) {
      log('packaging: pnpm run package');
      const built = spawnSync('pnpm', ['run', 'package'], { cwd: REPO, stdio: 'inherit', shell: IS_WIN });
      if (built.status !== 0) throw new Error('pnpm run package failed');
      vsix = path.join(REPO, 'forge.vsix');
    }
    vsix = path.resolve(vsix);
    ctxVsix = vsix;

    if (flag('--stub')) {
      const stubPort = Number(opt('--stub-port', '11434'));
      stub = spawn(process.execPath, [path.join(HERE, 'stub-gateway.mjs'), '--port', String(stubPort)], { stdio: 'ignore', detached: flag('--keep') });
      await waitHttp(`http://127.0.0.1:${stubPort}/v1/models`);
      gateway = `http://127.0.0.1:${stubPort}/v1`;
      model = model ?? 'qwen3-coder';
    }
    if (!gateway || !model) throw new Error('pass --stub, or --gateway <url> --model <id>');

    seedWorkspace(dirs.workspace);
    const capabilities = opt('--capabilities') ? JSON.parse(opt('--capabilities')) : stub ? STUB_CAPABILITIES : undefined;
    writeJson(path.join(dirs.userData, 'User', 'settings.json'), userSettings({ gateway, model, authEnv, capabilities }));
    const env = cleanEnvironment(dirs.home);
    if (authEnv) {
      if (!process.env[authEnv]) throw new Error(`--auth-env ${authEnv}: that variable is not set`);
      env[authEnv] = process.env[authEnv];
    }

    const codeServer = opt('--code-server');
    const code = opt('--code');
    if (!codeServer && !code) throw new Error('pass --code <Code.exe> or --code-server <bin>');
    host = codeServer
      ? await startCodeServer({ bin: codeServer, dirs, env, vsix, cdpPort, log })
      : await startDesktop({ bin: code, dirs, env, vsix, cdpPort, log });
  }
  const wb = workbench(host.cdp, host.page);

  const ctx = {
    dirs,
    out,
    wb,
    host,
    log,
    stubUrl: stub ? gateway.replace(/\/v1$/, '') : undefined,
    gateway,
    model,
    title: TITLE,
    sleep,
  };

  const only = opt('--only')?.split(',');
  const results = [];
  try {
    await wb.ready();
    for (const scenario of SCENARIOS) {
      if (only && !only.includes(String(scenario.id))) continue;
      if (scenario.needs?.includes('stub') && !stub) {
        results.push({ id: scenario.id, title: scenario.title, verdict: 'skipped', evidence: ['needs --stub (it scripts the model)'] });
        continue;
      }
      if (scenario.needs?.includes('linux') && process.platform !== 'linux') {
        results.push({ id: scenario.id, title: scenario.title, verdict: 'skipped', evidence: ['Linux only'] });
        continue;
      }
      if (scenario.needs?.includes('windows') && host.kind !== 'desktop') {
        results.push({ id: scenario.id, title: scenario.title, verdict: 'unverified', evidence: ['Windows VS Code only'] });
        continue;
      }
      log(`\n# ${scenario.id}. ${scenario.title}`);
      if (!(await wb.responsive())) {
        results.push({ id: scenario.id, title: scenario.title, verdict: 'fail', evidence: ['the workbench page stopped responding before this scenario'] });
        log('  FAILED: the workbench page stopped responding');
        continue;
      }
      const evidence = [];
      const started = Date.now();
      let verdict = 'pass';
      try {
        const limitMs = (scenario.timeoutSec ?? Number(opt('--scenario-timeout', '240'))) * 1000;
        let timer;
        const extra = await Promise.race([
          scenario.run({ ...ctx, evidence: (line) => { evidence.push(line); log(`  - ${line}`); } }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no result after ${limitMs / 1000}s`)), limitMs); }),
        ]).finally(() => clearTimeout(timer));
        if (extra === 'partial') verdict = 'partial';
      } catch (error) {
        verdict = 'fail';
        evidence.push(`FAILED: ${error.message}`);
        log(`  FAILED: ${error.stack}`);
        try {
          evidence.push(`screenshot: ${await wb.screenshot(path.join(out, `fail-${scenario.id}.png`))}`);
        } catch {
          /* no page */
        }
      }
      results.push({ id: scenario.id, title: scenario.title, verdict, ms: Date.now() - started, evidence });
    }
  } finally {
    const report = renderReport({ results, host: host.kind, gateway: stub ? 'stub-gateway' : gateway, model, vsix: ctxVsix, root });
    fs.writeFileSync(path.join(out, 'report.md'), report);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`\nreport: ${path.join(out, 'report.md')}`);
    if (flag('--keep') || flag('--attach')) {
      // Leave the host, browser and gateway running for inspection; this
      // process only lets go of them.
      console.log(`kept: CDP on ${cdpPort}${stub ? `, stub at ${gateway}` : ''}`);
      host.cdp.close();
    } else {
      await host.close();
      stub?.kill();
    }
  }
  const failed = results.filter((r) => r.verdict === 'fail').length;
  process.exit(failed ? 1 : 0);
}

function renderReport({ results, host, gateway, model, vsix, root }) {
  const count = (v) => results.filter((r) => r.verdict === v).length;
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `# Forge end to end: ${new Date().toISOString()}`,
    '',
    `- Host: ${host} (${process.platform}-${process.arch})`,
    `- Gateway: ${gateway}, model \`${model}\``,
    `- VSIX: \`${path.basename(vsix)}\``,
    `- Isolated root: \`${root}\``,
    '',
    `**pass ${count('pass')} · partial ${count('partial')} · fail ${count('fail')} · unverified ${count('unverified')} · skipped ${count('skipped')}**`,
    '',
    '| # | Scenario | Verdict | Evidence |',
    '| --- | --- | --- | --- |',
    ...[...results].sort((a, b) => a.id - b.id).map((r) => `| ${r.id} | ${esc(r.title)} | ${r.verdict} | ${esc(r.evidence.join('; '))} |`),
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
