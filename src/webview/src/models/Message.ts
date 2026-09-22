/**
 * Message - 消息类
 *
 * 核心功能：
 * 1. 包装消息数据
 * 2. 提供 isEmpty getter（动态计算）
 * 3. 支持 ContentBlockWrapper 响应式 tool_result 关联
 */

import type { ContentBlockType } from '../models/ContentBlock';
import { parseMessageContent } from '../models/contentParsers';
import { ContentBlockWrapper } from '../models/ContentBlockWrapper';

/**
 * 消息类型
 */
/**
 * `meta` is the official `I51`'s row type: a one-line note the webview inserts
 * itself, never something the host sent. Step 24 uses it for the rewind result
 * (`insertMetaMessage(TR(skippedLinks))`).
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'result' | 'tip' | 'slash_command_result' | 'meta';

/**
 * 消息内容数据
 */
export interface MessageData {
  role: MessageRole;
  content: string | ContentBlockWrapper[];
}

/**
 * 消息类
 *
 * 对应原版逻辑：
 * - user/assistant 消息：content 是 ContentBlockWrapper[]
 * - system/result 消息：content 是 string
 */
export class Message {
  type: MessageRole;
  message: MessageData;
  timestamp: number;

  // 额外字段（用于 system 和 result 消息）
  subtype?: string;
  session_id?: string;
  is_error?: boolean;

  /** The CLI message uuid. A row the stream assembler built has none until its final message replaces it. */
  uuid?: string;
  /** The API message id (`message.id`) an assistant row belongs to (the official `betaMessageId`). */
  betaMessageId?: string;

  constructor(
    type: MessageRole,
    message: MessageData,
    timestamp: number = Date.now(),
    extra?: {
      subtype?: string;
      session_id?: string;
      is_error?: boolean;
      uuid?: string;
      betaMessageId?: string;
    }
  ) {
    this.type = type;
    this.message = message;
    this.timestamp = timestamp;

    if (extra) {
      this.subtype = extra.subtype;
      this.session_id = extra.session_id;
      this.is_error = extra.is_error;
      this.uuid = extra.uuid;
      this.betaMessageId = extra.betaMessageId;
    }
  }

  /**
   * isEmpty getter - 判断消息是否为"空"
   *
   * 判断逻辑（官方 `_Z.isEmpty`）：
   * 1. system 消息永远不是 empty
   * 2. user/assistant 消息：
   *    - 内容为空数组 → empty
   *    - 所有内容块都是 tool_result → empty
   *    - 所有内容块都是仍在流式传输的 tool_use → empty
   *    - 所有内容块都是空白文本（官方 `GU`）→ empty
   */
  get isEmpty(): boolean {
    // system 消息永远不是 empty
    if (this.type === 'system') {
      return false;
    }

    const content = this.message.content;

    // 字符串内容不会是 empty
    if (typeof content === 'string') {
      return content.length === 0;
    }

    // ContentBlockWrapper 数组
    if (Array.isArray(content)) {
      // 空数组 → empty
      if (content.length === 0) {
        return true;
      }

      // 所有内容块都是 tool_result → empty
      return (
        content.every((wrapper) => wrapper.content.type === 'tool_result') ||
        content.every((wrapper) => wrapper.content.type === 'tool_use' && wrapper.isPartial) ||
        content.every((wrapper) => wrapper.content.type === 'text' && isBlankText(wrapper.content.text))
      );
    }

    return false;
  }

  /**
   * 静态工厂方法 - 从原始消息创建 Message 实例
   *
   * @param raw 原始消息对象
   * @returns Message 实例或 null
   */
  static fromRaw(raw: any): Message | null {
    if (raw.type === 'user' || raw.type === 'assistant') {
      const rawContent = Array.isArray(raw.message?.content)
        ? raw.message.content
        : raw.message?.content !== undefined
          ? [{ type: 'text', text: String(raw.message.content) }]
          : [];

      // 解析原始 content
      const contentBlocks = parseMessageContent(rawContent);

      // 包装为 ContentBlockWrapper
      const wrappedContent = contentBlocks.map((block) => new ContentBlockWrapper(block));

      // 基于 contentParsers 的解析结果判断消息类型
      let messageType: MessageRole = raw.type;

      // 检查是否为特殊消息类型
      if (raw.type === 'user') {
        const specialType = getSpecialMessageType(contentBlocks);
        if (specialType) {
          messageType = specialType;
        }
      }

      return new Message(
        messageType,
        {
          role: raw.message?.role ?? raw.type,
          content: wrappedContent,
        },
        raw.timestamp || Date.now(),
        {
          uuid: raw.uuid,
          betaMessageId: raw.type === 'assistant' ? raw.message?.id : undefined,
        }
      );
    }

    // 不渲染 system 消息（仅用于状态更新）
    if (raw.type === 'system') {
      return null;
    }

    // 不渲染 result 消息（仅用于结束标志/用量统计等状态更新）
    if (raw.type === 'result') {
      return null;
    }

    // stream_event 等不创建消息
    return null;
  }
}

/** The CLI's placeholder for an assistant turn with no text (the official `S_1`). */
const NO_CONTENT_TEXT = '(no content)';

/** The official `GU`: text that renders as nothing. */
export function isBlankText(text: string | undefined): boolean {
  const trimmed = text?.trim();
  return !trimmed || trimmed === NO_CONTENT_TEXT;
}

/**
 * 类型守卫
 */
export function isUserMessage(msg: Message): boolean {
  return msg.type === 'user';
}

export function isAssistantMessage(msg: Message): boolean {
  return msg.type === 'assistant';
}

export function isSystemMessage(msg: Message): boolean {
  return msg.type === 'system';
}

/**
 * 获取特殊消息类型
 *
 * 基于 contentParsers.ts 的解析结果判断
 * 返回特定的消息类型，用于分化渲染
 */
function getSpecialMessageType(contentBlocks: ContentBlockType[]): MessageRole | null {
  if (contentBlocks.length === 1) {
    const blockType = contentBlocks[0].type;

    if (blockType === 'interrupt' || blockType === 'llm_error') {
      return 'tip';
    }

    if (blockType === 'slash_command_result') {
      return 'slash_command_result';
    }
  }

  return null;
}
