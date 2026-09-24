#!/usr/bin/env node
/**
 * Fetch the Claude Code binary of every release target the build machine's
 * pnpm did not install, so one VSIX can carry them all.
 *
 * The CLI is a per-platform optional dependency of the Agent SDK
 * (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`), and pnpm installs only
 * the build machine's. For each other release target this downloads that
 * package at the exact version the installed SDK names (`npm pack`), and puts
 * its binary in `.forge-cache/native-binaries/<target>/claude[.exe]`, where
 * `esbuild.ts --universal` looks after the SDK's own packages.
 *
 * Nothing is fetched for a target the SDK already resolves, or whose cached
 * binary is there at the expected size. Usage: node scripts/fetch-native-binaries.mjs
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

/** Must match `RELEASE_TARGETS` in src/services/claude/cliLaunch.ts (a spec checks it). */
export const RELEASE_TARGETS = ['win32-x64', 'linux-x64'];
export const CACHE = path.join(ROOT, '.forge-cache', 'native-binaries');
const PREFIX = '@anthropic-ai/claude-agent-sdk';
const binaryName = (target) => (target.startsWith('win32-') ? 'claude.exe' : 'claude');

function main() {
  const sdkPackageJson = fs.realpathSync(path.join(ROOT, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'));
  const sdk = JSON.parse(fs.readFileSync(sdkPackageJson, 'utf8'));
  const sdkRequire = createRequire(sdkPackageJson);
  let failed = false;

  for (const target of RELEASE_TARGETS) {
    const pkg = `${PREFIX}-${target}`;
    const name = binaryName(target);
    const version = sdk.optionalDependencies?.[pkg] ?? sdk.version;
    try {
      const installed = sdkRequire.resolve(`${pkg}/${name}`);
      console.log(`${target}: installed (${path.relative(ROOT, installed)})`);
      continue;
    } catch {
      // Not installed on this machine: fetch it.
    }
    const cached = path.join(CACHE, target, name);
    if (fs.existsSync(cached) && fs.statSync(cached).size > 10 * 1024 * 1024) {
      console.log(`${target}: cached (${path.relative(ROOT, cached)})`);
      continue;
    }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-native-'));
    try {
      console.log(`${target}: fetching ${pkg}@${version}`);
      const pack = spawnSync('npm', ['pack', `${pkg}@${version}`, '--pack-destination', work, '--silent'], {
        cwd: work,
        encoding: 'utf8',
        shell: IS_WIN,
      });
      if (pack.status !== 0) throw new Error(`npm pack failed: ${(pack.stderr || pack.stdout || '').trim().slice(0, 400)}`);
      const tarball = fs.readdirSync(work).find((file) => file.endsWith('.tgz'));
      if (!tarball) throw new Error('npm pack wrote no tarball');
      const untar = spawnSync('tar', ['-xzf', tarball], { cwd: work, encoding: 'utf8' });
      if (untar.status !== 0) throw new Error(`tar failed: ${(untar.stderr || '').trim().slice(0, 400)}`);
      const extracted = path.join(work, 'package', name);
      if (!fs.existsSync(extracted)) throw new Error(`the package has no ${name}`);
      fs.mkdirSync(path.dirname(cached), { recursive: true });
      fs.copyFileSync(extracted, cached);
      fs.chmodSync(cached, 0o755);
      console.log(`${target}: ${path.relative(ROOT, cached)} (${Math.round(fs.statSync(cached).size / 1048576)} MB)`);
    } catch (error) {
      console.error(`${target}: ${error.message}`);
      failed = true;
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
