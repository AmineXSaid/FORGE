/**
 * Curl-pipe-to-shell detection.
 *
 * `curl https://example.com/install.sh | sh` hands a remote server the ability
 * to run arbitrary code on this machine, and it does it with no destructive
 * verb anywhere in the command line, so the path-based assessor never sees it.
 *
 * The check is about the *shape*, not the URL: a trusted domain today is a
 * compromised one tomorrow, and the shell has already executed by the time
 * anyone reads what was downloaded. What makes it worth flagging is that the
 * content is never seen by the user or the model before it runs.
 */
import { basename, isFlag, splitSegments, type Token } from './tokenize';

const DOWNLOADERS = new Set(['curl', 'wget', 'fetch', 'aria2c', 'http', 'httpie']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python3', 'perl', 'ruby', 'node']);

export interface ShellUrlFinding {
  /** The downloader segment, as written. */
  downloader: string;
  /** The interpreter it was piped into. */
  interpreter: string;
  /** The URL, when one could be identified. */
  url?: string;
}

function urlIn(tokens: Token[]): string | undefined {
  const hit = tokens.find((t) => /^(https?|ftp):\/\//i.test(t.text));
  return hit?.text;
}

/**
 * Find download-and-execute pipelines in a command line.
 *
 * Returns every occurrence rather than the first, because a command can carry
 * more than one and reporting one of three would understate it.
 */
export function scanForShellUrlIssues(command: string): ShellUrlFinding[] {
  const segments = splitSegments(command);
  const findings: ShellUrlFinding[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const program = segment[0];
    if (!program) continue;
    if (!DOWNLOADERS.has(basename(program))) continue;

    // The next segment only receives this one's output if it is actually piped.
    const next = segments[i + 1];
    if (!next?.length || !next[0].receivesPipe) continue;

    const interpreter = next[0];
    const interpreterName = basename(interpreter);
    if (!SHELLS.has(interpreterName)) continue;

    findings.push({
      downloader: segment.map((t) => t.text).join(' '),
      interpreter: next.filter((t) => !isFlag(t)).map((t) => t.text).join(' ') || interpreterName,
      url: urlIn(segment),
    });
  }

  return findings;
}

/** Convenience for callers that only need a yes or no. */
export const ShellUrlSafety = {
  hasPipeToShell: (command: string): boolean => scanForShellUrlIssues(command).length > 0,
};
