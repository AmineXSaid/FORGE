/**
 * Command risk: how dangerous a shell command looks, and therefore how much
 * scrutiny it earns.
 *
 * Ported from alphacode's `command_risk`, which was written after a real
 * incident where a user lost their home directory.
 *
 * The design separates two things that are easy to conflate, and the separation
 * is what makes the feature usable rather than annoying:
 *
 *   - **`assess`** says what a command *is*. It never decides anything.
 *   - **`gate`** decides what to do about that, given the session's permission
 *     mode and any explicit rule the user has already written.
 *
 * Keeping them apart means risk stays **advisory**: an explicit allow rule the
 * user wrote still wins, because they know something the classifier does not.
 * The one exception is `catastrophic`, which no justification unlocks -- not
 * because the classifier is certain it is right, but because the cost of being
 * wrong in that direction is unbounded and the cost of a false positive is one
 * rephrased command.
 */
import { basename, isFlag, isRecursiveFlag, splitSegments, type Token } from './tokenize';
import { classifyTarget, type RiskContext } from './paths';
import { scanForShellUrlIssues } from './shellUrlSafety';

export * from './tokenize';
export * from './paths';
export * from './shellUrlSafety';

/** How dangerous a command looks. Ordered, so findings can be maxed. */
export enum RiskLevel {
  /** No destructive potential detected. */
  Safe = 0,
  /** Destructive but bounded: inside the working directory, or a temp dir. */
  Low = 1,
  /** Irreversible and reaches outside the working directory. */
  Confirm = 2,
  /** Would destroy home, root or credentials. No justification unlocks it. */
  Catastrophic = 3,
}

export function runsImmediately(level: RiskLevel): boolean {
  return level === RiskLevel.Safe || level === RiskLevel.Low;
}

export function isAbsoluteDeny(level: RiskLevel): boolean {
  return level === RiskLevel.Catastrophic;
}

export interface RiskFinding {
  level: RiskLevel;
  /** Human-readable, shown verbatim in the permission dialog. */
  reason: string;
  /** The concrete path or argument that triggered this, when there is one. */
  target?: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  findings: RiskFinding[];
}

/** Programs whose whole purpose is destroying something. */
const DESTRUCTIVE_COMMANDS = new Set([
  'rm', 'rmdir', 'shred', 'unlink', 'truncate', 'dd', 'mkfs', 'fdisk',
  'parted', 'wipefs', 'srm',
]);

/**
 * Programs that run another program. The real command is one of their
 * arguments, so `sudo rm -rf ~` must be unwrapped before classification or the
 * destructive verb is never seen at all.
 */
const WRAPPER_COMMANDS = new Set([
  'sudo', 'doas', 'env', 'nice', 'ionice', 'time', 'timeout', 'nohup', 'xargs',
  'command', 'builtin', 'exec', 'setsid', 'stdbuf', 'chroot', 'su', 'watch', 'eval',
]);

/** Wrapper options that consume the following word as their value. */
const WRAPPER_FLAGS_WITH_VALUES = new Set([
  '-n', '-u', '-s', '-c', '-k', '--signal', '--adjustment', '--user',
]);

const SHELL_COMMANDS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

/** Programs that are destructive only with specific flags or subcommands. */
const CONDITIONALLY_DESTRUCTIVE: [string, string[]][] = [
  ['find', ['-delete', '-exec']],
  ['git', ['clean']],
  ['chmod', ['-R']],
  ['chown', ['-R']],
];

function levelOf(findings: RiskFinding[]): RiskLevel {
  return findings.reduce<RiskLevel>((max, f) => (f.level > max ? f.level : max), RiskLevel.Safe);
}

/**
 * Strip wrapper programs so the destructive verb underneath is the one
 * classified. Without this, any common prefix is a complete bypass.
 *
 * @returns the unwrapped tokens, and the wrapper name when one was stripped.
 */
function unwrap(tokens: Token[]): { tokens: Token[]; wrappedBy?: string } {
  let current = tokens;
  let wrappedBy: string | undefined;

  for (;;) {
    const first = current[0];
    if (!first || !WRAPPER_COMMANDS.has(basename(first))) break;
    wrappedBy = basename(first);

    const rest = current.slice(1);
    let idx = 0;
    while (idx < rest.length) {
      const token = rest[idx];
      if (token.isOperator || token.text.includes('=')) { idx += 1; continue; }
      if (isFlag(token)) {
        idx += 1;
        if (WRAPPER_FLAGS_WITH_VALUES.has(token.text) && idx < rest.length) idx += 1;
        continue;
      }
      // A bare number is an operand of the wrapper itself (`timeout 5`), not
      // the program to run.
      if (/^[\d.]+$/.test(token.text)) { idx += 1; continue; }
      break;
    }
    current = rest.slice(idx);
  }

  return { tokens: current, wrappedBy };
}

function assessSegment(tokens: Token[], ctx: RiskContext, findings: RiskFinding[]): void {
  const { tokens: unwrapped, wrappedBy } = unwrap(tokens);

  const program = unwrapped[0];
  if (!program) {
    // A wrapper with nothing recognisable after it hides its payload. That is
    // not evidence of safety, so it escalates.
    if (wrappedBy) {
      findings.push({
        level: RiskLevel.Confirm,
        reason: `\`${wrappedBy}\` runs another command that could not be identified before running it`,
      });
    }
    return;
  }

  const programName = basename(program);

  // A shell invoked with an inline script is opaque to this parser, so assess
  // the script text too. Otherwise `sh -c "rm -rf ~"` is a free pass.
  if (SHELL_COMMANDS.has(programName)) {
    for (const token of unwrapped.slice(1)) {
      if (isFlag(token)) continue;
      for (const segment of splitSegments(token.text)) {
        assessSegment(segment, ctx, findings);
      }
    }
    return;
  }

  const isDestructive = DESTRUCTIVE_COMMANDS.has(programName);
  const conditional = CONDITIONALLY_DESTRUCTIVE.find(([name]) => name === programName)?.[1];
  const triggered = isDestructive
    || (conditional ? unwrapped.some((t) => conditional.includes(t.text)) : false);

  // Output redirection truncates a file even with a harmless program.
  const redirectTargets = unwrapped.filter((t) => t.isTruncatingRedirectTarget);

  if (!triggered && !redirectTargets.length) return;

  const recursive = unwrapped.some(isRecursiveFlag);

  const operands = unwrapped
    .slice(1)
    .filter((t) => !t.isOperator && !isFlag(t) && !t.isTruncatingRedirectTarget);

  const describe = (verb: string, target: Token, cls: ReturnType<typeof classifyTarget>): void => {
    switch (cls) {
      case 'harmless':
        // A device sink. Nothing is destroyed, so nothing is reported.
        break;
      case 'catastrophic':
        findings.push({
          level: RiskLevel.Catastrophic,
          reason: `${verb} "${target.text}", which is a protected location (home, a credential store, or a system directory)`,
          target: target.text,
        });
        break;
      case 'outside':
        findings.push({
          level: RiskLevel.Confirm,
          reason: `${verb} "${target.text}", which is outside the working directory and not recoverable`,
          target: target.text,
        });
        break;
      case 'unknown':
        findings.push({
          level: RiskLevel.Confirm,
          reason: `${verb} "${target.text}", whose value is set at runtime and cannot be checked before it runs`,
          target: target.text,
        });
        break;
      case 'bounded':
        findings.push({
          level: RiskLevel.Low,
          reason: `${verb} "${target.text}" inside the working directory`,
          target: target.text,
        });
        break;
    }
  };

  if (triggered) {
    if (!operands.length) {
      // A destructive verb whose operands come from a pipe: the targets are
      // decided at runtime and cannot be seen here.
      if (unwrapped.some((t) => t.receivesPipe)) {
        findings.push({
          level: RiskLevel.Confirm,
          reason: `\`${programName}\` takes its targets from a pipe, so what it will delete is not known before it runs`,
        });
      }
    }
    for (const target of operands) {
      const cls = classifyTarget(target.text, ctx);
      const verb = recursive ? `\`${programName} -r\` would recursively remove` : `\`${programName}\` would remove`;
      describe(verb, target, cls);
    }
  }

  for (const target of redirectTargets) {
    describe('the output redirect would truncate', target, classifyTarget(target.text, ctx));
  }
}

/**
 * Assess a command. Says what it is; decides nothing.
 */
export function assess(command: string, ctx: RiskContext = {}): RiskAssessment {
  const findings: RiskFinding[] = [];

  for (const segment of splitSegments(command)) {
    assessSegment(segment, ctx, findings);
  }

  // Download-and-execute has no destructive verb, so the path walk never sees
  // it. Checked over the whole line rather than per segment, because the shape
  // spans a pipe by definition.
  for (const hit of scanForShellUrlIssues(command)) {
    findings.push({
      level: RiskLevel.Confirm,
      reason: `downloads ${hit.url ?? 'a remote file'} and pipes it straight into \`${hit.interpreter}\`, ` +
        'so the code runs before anyone can read it',
      target: hit.url,
    });
  }

  return { level: levelOf(findings), findings };
}

/**
 * The text shown with a risky command, phrased to force a comparison against
 * what the user actually asked for rather than a yes/no reflex.
 */
export function explain(assessment: RiskAssessment): string {
  if (!assessment.findings.length) return '';
  const lines = assessment.findings.map((f) => `• ${f.reason}`);
  const header = assessment.level === RiskLevel.Catastrophic
    ? 'This command would destroy something that cannot be recovered:'
    : assessment.level === RiskLevel.Confirm
      ? 'This command makes irreversible changes outside the working directory:'
      : 'This command deletes files inside the working directory:';
  return `${header}\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type GateDecision = 'allow' | 'ask' | 'deny';

export interface GateOutcome {
  decision: GateDecision;
  /** Why, in words, when it is not a plain allow. */
  reason?: string;
  /** What the permission dialog should pre-select. */
  suggestedDefault?: 'allow' | 'deny';
}

export interface GateInput {
  assessment: RiskAssessment;
  /**
   * True when the user already wrote a rule allowing this command.
   *
   * Risk is advisory and an explicit rule wins, because the user knows
   * something the classifier does not -- except for `catastrophic`, where the
   * cost of the classifier being overruled and right is unbounded.
   */
  explicitlyAllowed?: boolean;
  /**
   * True in `bypassPermissions`. The assessment is still computed and logged,
   * but it does not block: the user turned the prompts off deliberately.
   */
  bypassPermissions?: boolean;
}

/**
 * Turn an assessment into a decision.
 *
 * Kept separate from `assess` so the same assessment can be reported in a
 * dialog, logged in bypass mode, and overridden by a rule, without the
 * classifier knowing about any of that.
 */
export function gate(input: GateInput): GateOutcome {
  const { assessment, explicitlyAllowed, bypassPermissions } = input;

  // Nothing overrides catastrophic, including a rule and including bypass.
  // The cost of being wrong here is losing a home directory; the cost of a
  // false positive is rephrasing one command.
  if (isAbsoluteDeny(assessment.level)) {
    return {
      decision: 'deny',
      reason: explain(assessment),
      suggestedDefault: 'deny',
    };
  }

  if (explicitlyAllowed) {
    return { decision: 'allow' };
  }

  if (bypassPermissions) {
    // Computed and logged, not blocking.
    return {
      decision: 'allow',
      reason: assessment.level > RiskLevel.Safe ? explain(assessment) : undefined,
    };
  }

  // Nothing detected: allow with no ceremony at all, so the common case adds
  // no fields for a caller to reason about.
  if (assessment.level === RiskLevel.Safe) {
    return { decision: 'allow' };
  }

  if (runsImmediately(assessment.level)) {
    return {
      decision: 'ask',
      reason: explain(assessment),
      // Bounded and recoverable, so the safe answer is the permissive one.
      suggestedDefault: 'allow',
    };
  }

  return {
    decision: 'ask',
    reason: explain(assessment),
    // The dialog pre-selects the safe answer for anything irreversible.
    suggestedDefault: 'deny',
  };
}
