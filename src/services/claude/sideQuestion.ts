/**
 * `/btw` side questions: the parts with no host state, so they can be tested.
 *
 * The official host (extension.js `askSideQuestion($,Q,X,J)`) calls the SDK's
 * `query.askSideQuestion(question, {signal, history})`. That method is in the
 * runtime of @anthropic-ai/claude-agent-sdk 0.3.274 (sdk.mjs: a `side_question`
 * control request) but not in its public .d.ts, so it is typed here exactly as
 * the runtime implements it:
 *
 *   askSideQuestion(e,t){ …this.request({subtype:"side_question",question:e,
 *     ...t?.history?.length&&{history:[...t.history]}},t)).response;
 *     return r.response===null?null:{response,synthetic,refusalFallback?} }
 *
 * The CLI answers from the live session's own context and adds nothing to the
 * transcript -- which is what makes it a side question.
 */
import type { SideQuestionHistoryItem, SideQuestionResponse } from '../../shared/messages';

/** The official `FK1`: the panel keeps (and sends back) at most 20 exchanges. */
export const MAX_SIDE_HISTORY = 20;
/** Not the official's (it sends whatever was typed): a bound on untrusted input. */
export const MAX_SIDE_QUESTION_CHARS = 8000;
const MAX_SIDE_TEXT_CHARS = 64_000;
/** The official `kD.SIDE_QUESTION_TIMEOUT_MS`. */
export const SIDE_QUESTION_TIMEOUT_MS = 300_000;

/** The history item as the SDK takes it (the official renames fallbackNotice). */
export interface SdkSideHistoryItem {
    question: string;
    response: string;
    fallback_notice?: string;
}

export interface SdkSideAnswer {
    response: string;
    synthetic: boolean;
    refusalFallback?: { originalModel?: string; fallbackModel?: string; content: string };
}

/** `Query.askSideQuestion`, as the 0.3.274 runtime implements it. */
export type AskSideQuestion = (
    question: string,
    options: { signal?: AbortSignal; history?: SdkSideHistoryItem[] },
) => Promise<SdkSideAnswer | null>;

/** The method on a query, when this SDK has it. */
export function sideQuestionMethod(query: unknown): AskSideQuestion | undefined {
    const method = (query as { askSideQuestion?: unknown } | null)?.askSideQuestion;
    return typeof method === 'function' ? (method as AskSideQuestion).bind(query) : undefined;
}

const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/**
 * Validate the webview's request (B3: the webview is untrusted). Shaped as the
 * official handler's answer so a bad request reads like any other failure.
 */
export function parseSideQuestion(
    request: unknown,
): { question: string; history: SideQuestionHistoryItem[] } | { error: string } {
    const r = request as { question?: unknown; history?: unknown } | null;
    const question = typeof r?.question === 'string' ? r.question.trim() : '';
    if (!question) return { error: 'A side question needs some text.' };
    if (question.length > MAX_SIDE_QUESTION_CHARS) {
        return { error: `A side question is limited to ${MAX_SIDE_QUESTION_CHARS} characters.` };
    }
    if (r?.history === undefined) return { question, history: [] };
    if (!Array.isArray(r.history) || r.history.length > MAX_SIDE_HISTORY) {
        return { error: `Side question history must be a list of at most ${MAX_SIDE_HISTORY} exchanges.` };
    }
    const history: SideQuestionHistoryItem[] = [];
    for (const item of r.history as unknown[]) {
        const h = item as { question?: unknown; response?: unknown; fallbackNotice?: unknown } | null;
        if (!isText(h?.question, MAX_SIDE_QUESTION_CHARS) || !isText(h?.response, MAX_SIDE_TEXT_CHARS)) {
            return { error: 'Side question history holds an exchange that is not a question and its answer.' };
        }
        if (h.fallbackNotice !== undefined && !isText(h.fallbackNotice, MAX_SIDE_TEXT_CHARS)) {
            return { error: 'Side question history holds an exchange that is not a question and its answer.' };
        }
        history.push({ question: h.question, response: h.response, ...(h.fallbackNotice ? { fallbackNotice: h.fallbackNotice } : {}) });
    }
    return { question, history };
}

/** The official's history mapping: `fallbackNotice` goes as `fallback_notice`. */
export function toSdkHistory(history: readonly SideQuestionHistoryItem[]): SdkSideHistoryItem[] {
    return history.map((h) => ({
        question: h.question,
        response: h.response,
        ...(h.fallbackNotice && { fallback_notice: h.fallbackNotice }),
    }));
}

/** The official's response shape from the SDK's answer. */
export function toSideQuestionResponse(answer: SdkSideAnswer | null): SideQuestionResponse {
    return {
        type: 'side_question_response',
        response: answer === null ? null : answer.response,
        synthetic: answer?.synthetic ?? false,
        ...(answer?.refusalFallback && { fallbackNotice: answer.refusalFallback.content }),
    };
}
