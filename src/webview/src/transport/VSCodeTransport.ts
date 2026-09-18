import { BaseTransport } from './BaseTransport';
import { EventEmitter } from '../utils/events';
import type { FromExtensionWrapper, WebViewToExtensionMessage } from '../../../shared/messages';

interface VsCodeApi {
    postMessage(message: any): void;
}

export class VSCodeTransport extends BaseTransport {
    private readonly api: VsCodeApi;
    private readonly closedPromise: Promise<void>;

    override get closed(): Promise<void> {
        return this.closedPromise;
    }

    private handleMessage = (event: MessageEvent<FromExtensionWrapper>) => {
        const data = event.data;
        if (!data || data.type !== 'from-extension') {
            return;
        }

        // 🔍 调试日志：打印从 Extension 接收到的原始消息
        console.log('📨 [From Extension]', data.message);

        this.fromHost.enqueue(data.message);
    };

    constructor(atMentionEvents: EventEmitter<string>, selectionChangedEvents: EventEmitter<any>) {
        super(atMentionEvents, selectionChangedEvents);

        this.api = (window as any).acquireVsCodeApi();

        window.addEventListener('message', this.handleMessage);

        this.closedPromise = new Promise(() => {
            /* resolved when extension disposes webview */
        });
    }

    protected send(message: WebViewToExtensionMessage): void {
        this.api.postMessage(message);
    }

    /**
     * Post a message outside the transport protocol, on this webview's own
     * channel. A page shown in its own panel (the plan preview) talks to that
     * panel this way; the VS Code API can only be acquired once per page, and
     * this transport already holds it.
     */
    postRaw(message: unknown): void {
        this.api.postMessage(message);
    }

    override close(): void {
        window.removeEventListener('message', this.handleMessage);
        super.close();
    }
}
