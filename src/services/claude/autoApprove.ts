/**
 * Edit automatically, extended to shell commands Forge finds harmless.
 *
 * Asked for on 2026-09-25 ("I don't want it to ask me for each bash command"),
 * with a model that runs `grep`, `git log` and `cd … && …` chains all day. In
 * Edit automatically, Claude Code approves file edits but asks for every
 * command that no allow rule covers, so a read-only session became a string of
 * Yes clicks. Auto mode, the official answer, needs Anthropic's classifier and
 * is not available on a private endpoint.
 *
 * So, in Edit automatically only, a Bash command runs without asking when:
 * - Forge's command-risk classifier (`commandRisk`) finds nothing destructive
 *   in it (`RiskLevel.Safe`): no rm/dd/shred-style verb, no `find -delete`,
 *   no `git clean`, no download piped into a shell -- or the only thing it
 *   finds is an output redirect into a file inside the project (or a temp
 *   directory). "Edit automatically gives Forge a green pass to edit files,
 *   not to delete them" (2026-09-25): writing a project file is an edit, as
 *   the Write tool's is; and
 * - it contains none of the operations below, which the classifier does not
 *   grade: deleting through git (`git rm`), moving over a path (`mv`), and
 *   the ones that destroy history or leave the machine rather than files.
 *
 * Everything else still asks: `editModeAsks` (below) makes sure of it for
 * the deletions the CLI would otherwise run unasked in this mode. Manual
 * still asks for everything and Plan is left to the CLI. It is opt-in:
 * `forge.autoApproveSafeCommands` is off by default, so a fresh install asks
 * for every command, as Claude Code does.
 */
import { assess, basename, RiskLevel, splitSegments, type RiskAssessment, type Token } from './commandRisk';

/** Program names that raise privileges: never run unattended. */
const PRIVILEGED = new Set(['sudo', 'doas', 'su', 'pkexec']);

/** Package managers whose `publish` ships code to other people. */
const PUBLISHERS = new Set(['npm', 'pnpm', 'yarn', 'cargo', 'twine', 'gem', 'poetry']);

function words(segment: Token[]): string[] {
    // Leading `NAME=value` assignments are not the program.
    const texts = segment.filter((t) => !t.isOperator).map((t) => t.text);
    let i = 0;
    while (i < texts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(texts[i]!)) i++;
    return texts.slice(i);
}

/** The git operations that rewrite or discard history, or push it elsewhere. */
function isIrreversibleGit(args: string[]): boolean {
    const has = (w: string) => args.includes(w);
    return (
        has('push') ||
        has('rebase') ||
        has('restore') ||
        has('filter-branch') ||
        has('filter-repo') ||
        (has('reset') && has('--hard')) ||
        (has('checkout') && (has('--') || has('.') || has('-f') || has('--force'))) ||
        (has('branch') && (has('-D') || (has('--delete') && has('--force')))) ||
        (has('stash') && (has('drop') || has('clear'))) ||
        (has('tag') && has('-d')) ||
        (has('update-ref') && has('-d'))
    );
}

/** Why a command must still ask even though the classifier found it safe, or undefined. */
export function alwaysAsks(command: string): string | undefined {
    for (const segment of splitSegments(command)) {
        const w = words(segment);
        const program = w[0] ? basename({ text: w[0] } as Token) : undefined;
        if (!program) continue;
        if (PRIVILEGED.has(program)) return `${program} raises privileges`;
        if (program === 'git' && w.slice(1).includes('rm')) return 'git rm deletes files';
        if (program === 'mv') return 'mv removes its source and can overwrite its destination';
        if (program === 'git' && isIrreversibleGit(w.slice(1))) return 'the git operation rewrites, discards or pushes history';
        if (PUBLISHERS.has(program) && w.includes('publish')) return 'it publishes a package';
    }
    return undefined;
}

export interface AutoApproveInput {
    toolName: string;
    input: unknown;
    /** The mode the session is in now, not the one it launched in. */
    permissionMode: string | undefined;
    workingDirectory: string;
    homeDirectory: string;
    /** `forge.autoApproveSafeCommands`. */
    enabled: boolean;
}

/** Whether Forge answers this permission request itself, with allow. */
export function autoApprovesCommand(request: AutoApproveInput): boolean {
    if (!request.enabled || request.permissionMode !== 'acceptEdits') return false;
    if (request.toolName !== 'Bash') return false;
    const command = (request.input as { command?: unknown } | null)?.command;
    if (typeof command !== 'string' || !command.trim()) return false;
    return whyItAsks(command, request) === undefined;
}

/**
 * Why a command is not a plain read or a project-file edit, or undefined: the
 * classifier's first finding that is not a redirect into the project, else
 * the operation `alwaysAsks` names.
 */
function whyItAsks(command: string, context: { workingDirectory: string; homeDirectory: string }): string | undefined {
    const assessment = assess(command, context);
    if (assessment.level !== RiskLevel.Safe && !onlyWritesProjectFiles(assessment)) {
        const finding = assessment.findings.find((f) => !(f.kind === 'redirect' && f.level === RiskLevel.Low));
        return finding?.reason ?? 'it deletes or overwrites files';
    }
    return alwaysAsks(command);
}

/** What the CLI's PreToolUse hook input carries that the Edit-automatically gate reads. */
export interface EditModeHookInput {
    tool_name: string;
    tool_input: unknown;
    /** The mode the CLI is in for this call (`BaseHookInput.permission_mode`, sdk.d.ts L179). */
    permission_mode?: string;
    cwd: string;
}

/**
 * Edit automatically gives a green pass to edits, not to deletions.
 *
 * Measured against the real CLI (e2e scenario 26, 2026-09-25): in Edit
 * automatically, Claude Code runs `rm <project file>` without asking -- it
 * auto-accepts file commands inside the project, deletions included -- so no
 * permission request ever reached Forge, whatever Forge's own settings said.
 * The CLI's PreToolUse hook runs before that decision, and `ask` (sdk.d.ts
 * `HookPermissionDecision`) makes it prompt instead. So, in Edit automatically
 * only, a Bash command that deletes or moves a file, or that `alwaysAsks`
 * names, asks. Reads and edits are left to the CLI and to
 * `autoApprovesCommand`. It only adds prompts, so it needs no setting.
 *
 * Returns the reason to show, or undefined to leave the call alone.
 */
export function editModeAsks(input: EditModeHookInput, homeDirectory: string): string | undefined {
    if (input.permission_mode !== 'acceptEdits' || input.tool_name !== 'Bash') return undefined;
    const command = (input.tool_input as { command?: unknown } | null)?.command;
    if (typeof command !== 'string' || !command.trim()) return undefined;
    const reason = whyItAsks(command, { workingDirectory: input.cwd, homeDirectory });
    return reason && `Edit automatically does not run this unasked: ${reason}.`;
}

/**
 * The classifier's only findings are output redirects into files inside the
 * project (or a temp directory): the command edits files and deletes none.
 */
function onlyWritesProjectFiles(assessment: RiskAssessment): boolean {
    return (
        assessment.level === RiskLevel.Low &&
        assessment.findings.length > 0 &&
        assessment.findings.every((f) => f.kind === 'redirect' && f.level === RiskLevel.Low)
    );
}
