/**
 * `claude doctor` health probe.
 *
 * Forge drives the real CLI, and CLI flags drift between versions -- a flag that
 * works today can vanish or change shape in the next release, and the failure
 * shows up as an opaque spawn error mid-conversation. Running the CLI's own
 * doctor at activation surfaces the version and any environment problems up
 * front, in the output channel, where they are actually diagnosable.
 *
 * This is advisory only: it never blocks activation and never throws.
 */
import { execFile } from 'node:child_process';

export interface DoctorResult {
  ok: boolean;
  version?: string;
  output: string;
  error?: string;
}

const TIMEOUT_MS = 15_000;

function run(cliPath: string, args: string[]): Promise<{ code: number; out: string }> {
  // The SDK resolves either a native `claude` binary or the bundled cli.js.
  // A .js entry has to go through node; a native binary must not.
  const isScript = /\.[cm]?js$/i.test(cliPath);
  const file = isScript ? process.execPath : cliPath;
  const argv = isScript ? [cliPath, ...args] : args;

  return new Promise((resolve) => {
    execFile(
      file,
      argv,
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout ?? ''}${stderr ?? ''}`.trim();
        const code = err && typeof (err as NodeJS.ErrnoException).code === 'number'
          ? Number((err as NodeJS.ErrnoException).code)
          : err
            ? 1
            : 0;
        resolve({ code, out });
      },
    );
  });
}

/**
 * Probe the CLI that Forge will spawn.
 *
 * @param cliPath path to the `claude` executable or cli.js the SDK will run
 */
export async function runDoctor(cliPath: string): Promise<DoctorResult> {
  try {
    const version = await run(cliPath, ['--version']);
    const doctor = await run(cliPath, ['doctor']);

    const versionLine = version.out.split('\n').find((l) => l.trim()) ?? undefined;
    const output = [
      versionLine ? `version: ${versionLine.trim()}` : 'version: (no output)',
      doctor.out || '(doctor produced no output)',
    ].join('\n');

    return {
      ok: version.code === 0,
      version: versionLine?.trim(),
      output,
    };
  } catch (e) {
    return {
      ok: false,
      output: '',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
