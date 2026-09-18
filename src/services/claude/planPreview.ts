/**
 * The plan preview: the official host's `yS` panel and its bookkeeping.
 *
 * When an ExitPlanMode permission prompt arrives, the official webview asks the
 * host to show the plan beside the chat (`open_markdown_preview`, comments on).
 * The user selects text in the preview and comments on it; each comment is
 * pushed to the webview (`plan_comment`), where the prompt turns into "Send
 * feedback and keep planning" and sends the comments as feedback. Accepting the
 * plan closes the preview (`close_plan_preview`).
 *
 * The panel speaks the official protocol with its page: in, `{type:"ready"}` and
 * `{type:"comment", id, selectedText, sectionHeading, comment}`; out,
 * `{type:"updateContent", html}`, `{type:"setCommentsEnabled", enabled}` and
 * `{type:"removeComment", commentId}`. The markdown is rendered here, as the
 * official does with `marked` (`Yh0`), and sanitised by the page.
 *
 * One difference, forced by Forge's brand gate: the official page is inline HTML
 * with VS Code's fonts and hard-coded shadows. Forge's page is its own webview
 * bundle (`page: "plan-preview"`), so it uses Forge's fonts and colour tokens.
 * Markup, copy and behaviour are the official's.
 *
 * Kept free of `vscode` so the specs can import it.
 */
import { marked } from 'marked';
import type { PlanComment } from '../../shared/messages';

export type { PlanComment };

/** The official `qv` ("Claude’s Plan"), in Forge's voice as its plan header already is. */
export const DEFAULT_PLAN_TITLE = 'Forge’s Plan';

/** The official panel view type. */
export const PLAN_PREVIEW_VIEW_TYPE = 'claudePlanPreview';

/** The official `Yh0`: markdown to HTML, or "" if the renderer returns something else. */
export function renderPlanHtml(markdown: string): string {
    const html = marked.parse(markdown, { async: false });
    return typeof html === 'string' ? html : '';
}

/**
 * The official check on a page message: a comment needs an id, the selected
 * text and the comment; the heading defaults to "". Forge also insists they are
 * strings, since the text ends up in the prompt's answer.
 */
export function commentFromPageMessage(message: unknown): PlanComment | undefined {
    if (typeof message !== 'object' || message === null) return undefined;
    const m = message as Record<string, unknown>;
    if (m.type !== 'comment') return undefined;
    if (typeof m.id !== 'string' || !m.id) return undefined;
    if (typeof m.selectedText !== 'string' || !m.selectedText) return undefined;
    if (typeof m.comment !== 'string' || !m.comment) return undefined;
    return {
        id: m.id,
        selectedText: m.selectedText,
        sectionHeading: typeof m.sectionHeading === 'string' ? m.sectionHeading : '',
        comment: m.comment,
    };
}

/** What the panel needs from a `vscode.WebviewPanel`. */
export interface PlanPreviewHostPanel {
    title: string;
    webview: {
        postMessage(message: unknown): Thenable<boolean> | Promise<boolean> | boolean;
        onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void };
    };
    onDidDispose(listener: () => void): { dispose(): void };
    dispose(): void;
}

/** The official `yS`. */
export class PlanPreviewPanel {
    private readonly disposeListeners: { dispose(): void }[] = [];

    private constructor(
        private readonly panel: PlanPreviewHostPanel,
        private onComment: ((comment: PlanComment) => void) | undefined,
        private markdownContent: string,
        private commentsEnabled: boolean
    ) {}

    /** `yS.create`: the page asks for the content once it can receive it (`ready`). */
    static create(
        panel: PlanPreviewHostPanel,
        markdown: string,
        commentsEnabled: boolean,
        onComment: (comment: PlanComment) => void
    ): PlanPreviewPanel {
        const preview = new PlanPreviewPanel(panel, onComment, markdown, commentsEnabled);
        panel.webview.onDidReceiveMessage((message) => {
            if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'ready') {
                preview.updateContent(preview.markdownContent);
                preview.setCommentsEnabled(preview.commentsEnabled && preview.onComment !== undefined);
                return;
            }
            const comment = commentFromPageMessage(message);
            if (comment) preview.onComment?.(comment);
        });
        return preview;
    }

    setTitle(title: string): void {
        this.panel.title = title;
    }

    updateContent(markdown: string): void {
        this.markdownContent = markdown;
        void this.panel.webview.postMessage({ type: 'updateContent', html: renderPlanHtml(markdown) });
    }

    setCommentsEnabled(enabled: boolean): void {
        this.commentsEnabled = enabled;
        void this.panel.webview.postMessage({ type: 'setCommentsEnabled', enabled });
    }

    removeComment(commentId: string): void {
        void this.panel.webview.postMessage({ type: 'removeComment', commentId });
    }

    onDidDispose(listener: () => void): { dispose(): void } {
        const subscription = this.panel.onDidDispose(listener);
        this.disposeListeners.push(subscription);
        return subscription;
    }

    /** On shutdown the panel stays open, but stops taking comments. */
    detach(): void {
        this.onComment = undefined;
        for (const subscription of this.disposeListeners) subscription.dispose();
        this.disposeListeners.length = 0;
        this.setCommentsEnabled(false);
    }

    dispose(): void {
        this.panel.dispose();
    }
}
