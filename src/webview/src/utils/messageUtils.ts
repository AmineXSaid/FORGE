/**
 * MessageUtils - 消息处理工具函数
 *
 * 对应原始代码的 rZe 和 LSe 函数
 */

import { Message, isBlankText } from '../models/Message';
import { ContentBlockWrapper } from '../models/ContentBlockWrapper';
import type { ToolResultBlock, ToolUseContentBlock, ContentBlockType } from '../models/ContentBlock';

/**
 * 反向查找 tool_use block
 *
 * 对应原始代码：
 * function rZe(n, e) {
 *   for (let t = n.length - 1; t >= 0; t--) {
 *     let i = n[t];
 *     if (i.type === "assistant") {
 *       for (let o of i.content) {
 *         if (o.content.type === "tool_use" && o.content.id === e) {
 *           return o;
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * @param messages 消息数组
 * @param toolUseId tool_use 的 id
 * @returns 找到的 ContentBlockWrapper（包含 tool_use）
 */
export function findToolUseBlock(
    messages: Message[],
    toolUseId: string
): ContentBlockWrapper | undefined {
    // 从后往前遍历消息数组
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];

        // 只在 assistant 消息中查找
        if (message.type === 'assistant') {
            const content = message.message.content;

            // content 应该是 ContentBlockWrapper[]
            if (Array.isArray(content)) {
                for (const wrapper of content) {
                    // 检查是否是 tool_use 且 id 匹配
                    if (
                        wrapper.content.type === 'tool_use' &&
                        (wrapper.content as ToolUseContentBlock).id === toolUseId
                    ) {
                        return wrapper;
                    }
                }
            }
        }
    }

    return undefined;
}

/**
 * 关联 tool_result 到对应的 tool_use
 *
 * 对应原始代码：
 * function LSe(n, e) {
 *   if (e.type === "user" && Array.isArray(e.message.content)) {
 *     for (let i of e.message.content) {
 *       if (i.type === "tool_result") {
 *         let o = rZe(n, i.tool_use_id);
 *         if (o) {
 *           o.setToolResult(i);
 *         }
 *       }
 *     }
 *   }
 *   let t = LJ(e);
 *   if (t) {
 *     n.push(t);
 *   }
 * }
 *
 * 注意：
 * - 这个函数在每次收到新消息时调用
 * - 它会检查新消息中的 tool_result blocks
 * - 并在历史消息中查找对应的 tool_use，通过 Signal 关联
 *
 * @param messages 当前消息数组（会被修改）
 * @param newMessage 新收到的消息
 */
export function attachToolResults(messages: Message[], newMessage: Message): void {
    // 只处理 user 消息中的 tool_result
    if (newMessage.type === 'user') {
        const content = newMessage.message.content;

        if (Array.isArray(content)) {
            for (const wrapper of content) {
                // 检查是否是 tool_result
                if (wrapper.content.type === 'tool_result') {
                    const toolResult = wrapper.content as ToolResultBlock;
                    const toolUseId = toolResult.tool_use_id;

                    // 在消息历史中反向查找对应的 tool_use
                    const toolUseWrapper = findToolUseBlock(messages, toolUseId);

                    if (toolUseWrapper) {
                        // 通过 Signal 关联 tool_result（触发响应式更新！）
                        toolUseWrapper.setToolResult(toolResult);
                    }
                }
            }
        }
    }
}

/**
 * 处理传入消息并添加到消息数组
 *
 * 对应原始代码的完整 LSe 逻辑
 *
 * @param messages 当前消息数组
 * @param rawEvent 原始消息事件
 * @param hasStreamingMessages 本会话是否收到过 stream_event（官方 `ZM` 的第三个参数）
 */
export function processAndAttachMessage(messages: Message[], rawEvent: any, hasStreamingMessages = false): void {
    // 1. 先关联 tool_result 和 toolUseResult（如果有）
    // 注意：这一步要在添加新消息之前，因为 tool_use 应该已经在消息数组中了
    if (rawEvent.type === 'user' && Array.isArray(rawEvent.message?.content)) {
        for (const block of rawEvent.message.content) {
            if (block.type === 'tool_result') {
                const toolUseWrapper = findToolUseBlock(messages, block.tool_use_id);
                if (toolUseWrapper) {
                    // 关联 tool_result（实时对话）
                    toolUseWrapper.setToolResult(block);

                    // 关联 toolUseResult（会话加载时的额外数据）
                    if (rawEvent.toolUseResult) {
                        toolUseWrapper.toolUseResult = rawEvent.toolUseResult;
                    }
                }
            }
        }
    }

    // 2. The official `ZM`: once the session streams, a final assistant message
    //    replaces the row the stream assembler built for it -- the row with the same
    //    uuid, or else the first unfinished row of the same API message whose first
    //    block has the same type.
    if (rawEvent.type === 'assistant' && hasStreamingMessages && rawEvent.uuid !== undefined) {
        const message = Message.fromRaw(rawEvent);
        if (!message) return;
        const content = message.message.content;
        if (!Array.isArray(content) || content.length === 0) return;
        const firstType = content[0].content.type;
        let index = lastIndexWhere(messages, (m) => m.uuid === rawEvent.uuid);
        if (index === -1 && !isBlankTextRow(content)) {
            index = messages.findIndex((m) => {
                const rowContent = m.message.content;
                return (
                    m.betaMessageId !== undefined &&
                    m.betaMessageId === rawEvent.message?.id &&
                    m.uuid === undefined &&
                    Array.isArray(rowContent) &&
                    rowContent[0]?.content.type === firstType &&
                    !isBlankTextRow(rowContent)
                );
            });
        }
        if (index !== -1) {
            messages[index] = message;
        } else {
            messages.push(message);
        }
        return;
    }

    // 3. 将原始事件转换为 Message 并添加到数组
    const message = Message.fromRaw(rawEvent);
    if (message) {
        messages.push(message);
    }
}

/**
 * The filter in the official `retireAbandonedStreamedRows`: remove the rows an
 * abandoned stream built. Rows a final message already replaced are no longer in
 * the list, so only unfinished ones go. Returns the same array when nothing changes.
 */
export function retireStreamedRows(messages: Message[], rows: Message[]): Message[] {
    if (rows.length === 0) return messages;
    const retired = new Set(rows);
    const kept = messages.filter((m) => !retired.has(m));
    return kept.length === messages.length ? messages : kept;
}

/** A row holding one blank text block (the official `ZM` helper around `GU`). */
function isBlankTextRow(content: ContentBlockWrapper[]): boolean {
    const block = content.length === 1 ? content[0].content : undefined;
    return block?.type === 'text' && isBlankText(block.text);
}

function lastIndexWhere<T>(items: T[], predicate: (item: T) => boolean): number {
    for (let i = items.length - 1; i >= 0; i--) {
        if (predicate(items[i])) return i;
    }
    return -1;
}

/**
 * 将连续的 Read 工具消息合并为 ReadCoalesced（对齐原版 IJ/ySe/CSe/iZe 行为）
 *
 * 规则：
 * - 连续的 assistant 消息，且每条包含 name === 'Read' 的 tool_use
 * - 且每条对应的第一个 tool_use 已有非错误的 tool_result（成功）
 * - 则合并为一条新的 assistant 消息：
 *   - content 为单个 tool_use（name: 'ReadCoalesced'，input: { fileReads: [...] }）
 *   - 并为该 tool_use 注入一个成功的 tool_result（"Successfully read N files"）
 */
export function mergeConsecutiveReadMessages(messages: Message[]): Message[] {
    const result: Message[] = [];
    let i = 0;

    while (i < messages.length) {
        const current = messages[i];
        if (isAssistantRead(current) && hasNonErrorToolResult(current)) {
            const group: Message[] = [current];
            let j = i + 1;
            while (j < messages.length) {
                const next = messages[j];
                if (isAssistantRead(next) && hasNonErrorToolResult(next)) {
                    group.push(next);
                    j++;
                } else {
                    break;
                }
            }

            if (group.length > 1) {
                result.push(buildReadCoalescedMessage(group));
                i = j;
                continue;
            }
        }

        result.push(current);
        i++;
    }

    return result;
}

function isAssistantRead(msg: Message): boolean {
    if (msg.type !== 'assistant') return false;
    const content = msg.message.content;
    if (typeof content === 'string' || !Array.isArray(content)) return false;
    return content.some(w => w.content.type === 'tool_use' && (w.content as ToolUseContentBlock).name === 'Read');
}

function firstReadToolUseWrapper(msg: Message): ContentBlockWrapper | undefined {
    const content = msg.message.content;
    if (typeof content === 'string' || !Array.isArray(content)) return undefined;
    return content.find(w => w.content.type === 'tool_use' && (w.content as ToolUseContentBlock).name === 'Read');
}

function hasNonErrorToolResult(msg: Message): boolean {
    const wrapper = firstReadToolUseWrapper(msg);
    if (!wrapper) return false;

    // 🔥 使用 alien-signals API：toolResult 是 signal，需要函数调用
    const tr = wrapper.getToolResultValue();
    if (!tr) return false;
    return !tr.is_error;
}

function buildReadCoalescedMessage(group: Message[]): Message {
    // 收集每条的 Read 输入
    const fileReads = group.map(g => {
        const w = firstReadToolUseWrapper(g);
        const block = w?.content as ToolUseContentBlock | undefined;
        // 与原版一致，容错：若拿不到则放空对象
        return block?.input ?? {};
    });

    const id = 'coalesced_' + Math.random().toString(36).slice(2);
    const toolUse: ToolUseContentBlock = {
        type: 'tool_use',
        id,
        name: 'ReadCoalesced',
        input: { fileReads }
    } as any; // 允许最小入侵

    const wrapper = new ContentBlockWrapper(toolUse as unknown as ContentBlockType);
    const toolResult: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: id,
        content: `Successfully read ${group.length} files`,
        is_error: false
    } as any;
    wrapper.setToolResult(toolResult);

    return new Message(
        'assistant',
        {
            role: 'assistant',
            content: [wrapper]
        }
    );
}

/**
 * 检测消息是否为 Read tool 调用
 * @param message SDK 消息
 * @returns boolean
 */
export function isReadToolMessage(message: any): boolean {
    if (message.type !== 'assistant') {
        return false;
    }

    return message.message.content.some(
        (block: any) =>
            block.type === 'tool_use' &&
            block.name === 'Read'
    );
}

/**
 * 检测消息是否可见（非空白）
 * @param message SDK 消息
 * @returns boolean
 */
export function isVisibleMessage(message: any): boolean {
    if (message.type !== 'assistant') {
        return true; // 非助手消息默认可见
    }

    return message.message.content.some((block: any) => {
        if (block.type === 'text') {
            return block.text.trim() !== '';
        }
        return true; // tool_use 默认可见
    });
}

/**
 * 合并连续的 Read tool 调用
 * 优化 UI 显示，减少冗余的 Read tool 消息
 *
 * @param messages SDK 消息数组
 * @returns 优化后的消息数组
 */
export function mergeConsecutiveReads(messages: any[]): any[] {
    const result: any[] = [];
    let i = 0;

    while (i < messages.length) {
        const current = messages[i];

        // 检测是否为连续的 Read tool 调用
        if (isReadToolMessage(current) && isVisibleMessage(current)) {
            const readMessages: any[] = [current];

            // 收集连续的 Read 消息
            let j = i + 1;
            while (j < messages.length) {
                const next = messages[j];
                if (isReadToolMessage(next) && isVisibleMessage(next)) {
                    readMessages.push(next);
                    j++;
                } else {
                    break;
                }
            }

            // 如果有多个连续的 Read，合并它们
            if (readMessages.length > 1) {
                const merged = mergeReadToolMessages(readMessages);
                result.push(merged);
                i = j;
            } else {
                result.push(current);
                i++;
            }
        } else {
            result.push(current);
            i++;
        }
    }

    return result;
}

/**
 * 合并多个 Read tool 消息
 * @param messages Read tool 消息数组
 * @returns 合并后的单个消息
 */
function mergeReadToolMessages(messages: any[]): any {
    if (messages.length === 0) {
        throw new Error('Cannot merge empty messages array');
    }

    if (messages.length === 1) {
        return messages[0];
    }

    // 收集所有 tool_use 块
    const toolUseBlocks = messages.flatMap((msg) =>
        msg.message.content.filter((block: any) => block.type === 'tool_use')
    );

    // 使用第一个消息作为基础
    const base = messages[0];

    return {
        ...base,
        message: {
            ...base.message,
            content: [
                {
                    type: 'text',
                    text: `[Merged ${toolUseBlocks.length} Read operations]`,
                    citations: null
                },
                ...toolUseBlocks
            ]
        }
    };
}

/**
 * 提取消息中的文本内容
 * @param message SDK 消息
 * @returns 文本内容
 */
export function extractMessageText(message: any): string {
    if (message.type === 'user') {
        const content = message.message.content;
        if (Array.isArray(content)) {
            return content
                .map((block: any) => {
                    if (typeof block === 'string') {
                        return block;
                    } else if (block.type === 'text') {
                        return block.text;
                    }
                    return '';
                })
                .join('\n');
        }
        return '';
    }

    if (message.type === 'assistant') {
        return message.message.content
            .map((block: any) => {
                if (block.type === 'text') {
                    return block.text;
                }
                return '';
            })
            .filter((text: string) => text.trim() !== '')
            .join('\n');
    }

    return '';
}

/**
 * 检测消息是否包含错误
 * @param message SDK 消息
 * @returns boolean
 */
export function hasError(message: any): boolean {
    if (message.type === 'result') {
        return message.is_error === true;
    }
    return false;
}

/**
 * 计算消息的 Token 数量（估算）
 * @param message SDK 消息
 * @returns Token 数量
 */
export function estimateTokenCount(message: any): number {
    const text = extractMessageText(message);
    // 简单估算：1 token ≈ 4 个字符
    return Math.ceil(text.length / 4);
}
