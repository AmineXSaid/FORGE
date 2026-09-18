/**
 * The plan side of the permission prompt, ported from the official webview:
 * opening the plan preview when an ExitPlanMode prompt arrives (`MW0`), the
 * preview's title (`jW0`, `PW0`), and what each answer to a plan says
 * (`AS`, `_61`, `wM`, the plan-comment feedback).
 *
 * Names in brackets are the bundle's.
 */
import type { PlanComment } from '../../../shared/messages';

/** [`BF`] */
export const EXIT_PLAN_MODE = 'ExitPlanMode';
/** [`fJ`] */
export const ASK_USER_QUESTION = 'AskUserQuestion';

/** [`PW0`] "Claude’s Plan", in Forge's voice as its plan header already is. */
export const DEFAULT_PLAN_TITLE = 'Forge’s Plan';

/**
 * [`jW0`] The preview's title: the plan's opening `# Heading`, if the first
 * non-blank line is one (not `##`, not only hashes, at most 200 characters).
 */
export function planTitle(plan: string): string | undefined {
  for (const line of plan.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^#(?!#)\s+(.+?)(?:\s+#+)?\s*$/);
    if (!match) return undefined;
    const title = match[1]?.trim();
    if (!title || /^#+$/.test(title) || title.length > 200) return undefined;
    return title;
  }
  return undefined;
}

/** What `MW0` needs from a permission request and its session. */
export interface PlanPromptRequest {
  toolName: string;
  inputs: Record<string, unknown>;
  onResolved(callback: (result: { behavior: string }) => void): unknown;
}
export interface PlanPromptSession {
  openMarkdownPreview(content: string, title: string, enableComments: boolean): void;
  closePlanPreview(): void;
}

/**
 * [`MW0`, the ExitPlanMode branch] Show the plan beside the chat, with
 * comments on, and close it once the plan is accepted.
 */
export function openPlanPreviewFor(request: PlanPromptRequest, session: PlanPromptSession): void {
  if (request.toolName !== EXIT_PLAN_MODE) return;
  const plan = request.inputs?.plan;
  if (typeof plan === 'string' && plan) {
    session.openMarkdownPreview(plan, planTitle(plan) ?? DEFAULT_PLAN_TITLE, true);
  }
  request.onResolved((result) => {
    if (result.behavior === 'allow') session.closePlanPreview();
  });
}

// ------------------------------------------------------- what an answer says ---

/** [`AS`] A plain "No". */
export const REJECT_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

/** [`_61`] "No, keep planning" with nothing typed. */
export const KEEP_PLANNING_MESSAGE = 'User chose to stay in plan mode and continue planning';

/** [`wM`] The prefix for a typed reason (the official adds one more space before the text). */
export const REJECT_WITH_REASON_PREFIX =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection: ";

/** The plan comments as the official writes them into feedback: `[Re: "…"] comment`, one per line. */
export function commentsAsFeedback(comments: readonly PlanComment[]): string {
  return comments.map((c) => `[Re: "${c.selectedText}"] ${c.comment}`).join('\n');
}

/**
 * [`d` in `EU0`] The reject message, and whether it interrupts: a typed reason
 * wins; on a plan, the comments follow it (or "keep planning" if nothing was
 * typed). Only a bare "No" with no comments interrupts.
 */
export function rejectAnswer(
  typed: string,
  isPlanRequest: boolean,
  comments: readonly PlanComment[]
): { message: string; interrupt: boolean } {
  const text = typed.trim();
  const planComments = isPlanRequest ? comments : [];
  let message: string;
  if (planComments.length > 0) {
    const feedback = commentsAsFeedback(planComments);
    message = text
      ? `${REJECT_WITH_REASON_PREFIX} ${text}\n\nComments on the plan:\n${feedback}`
      : `${KEEP_PLANNING_MESSAGE}\n\nComments on the plan:\n${feedback}`;
  } else {
    message = text ? `${REJECT_WITH_REASON_PREFIX} ${text}` : isPlanRequest ? KEEP_PLANNING_MESSAGE : REJECT_MESSAGE;
  }
  return { message, interrupt: !text && planComments.length === 0 };
}

/**
 * [`C` / `i1` on a plan with comments] The accepted plan's inputs carry the
 * comments as feedback (`userFeedback`) and as data (`userComments`).
 */
export function inputsWithPlanComments(
  inputs: Record<string, unknown>,
  comments: readonly PlanComment[]
): Record<string, unknown> {
  if (comments.length === 0) return inputs;
  return { ...inputs, userFeedback: commentsAsFeedback(comments), userComments: [...comments] };
}

/** The labels of `EU0`, for a request: [`d0`, the option-2 text, `v0`]. */
export function promptLabels(
  toolName: string,
  hasPlanComments: boolean
): { approve: string; approveAlways: string | null; reject: string } {
  const isPlan = toolName === EXIT_PLAN_MODE;
  return {
    approve: isPlan ? 'Yes, and auto-accept' : 'Yes',
    approveAlways: isPlan ? 'Yes, and manually approve edits' : null,
    reject: isPlan ? (hasPlanComments ? 'Send feedback and keep planning' : 'No, keep planning') : 'No',
  };
}
