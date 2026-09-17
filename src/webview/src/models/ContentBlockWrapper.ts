/**
 * ContentBlockWrapper - Content Block 包装器
 *
 * 使用 alien-signals 管理 tool_result 的响应式关联
 *
 * 核心功能：
 * 1. 包装每个 content block
 * 2. 使用 Signal 管理 toolResult（响应式）
 * 3. 提供 setToolResult 方法用于异步关联
 *
 * 为什么需要这个包装器？
 * - tool_use 和 tool_result 不在同一条消息中
 * - 需要异步关联（收到 tool_result 时，反向查找 tool_use）
 * - 使用 signal 可以响应式更新 UI
 */

import { signal } from 'alien-signals';
import type { ContentBlockType, ToolResultBlock } from './ContentBlock';

let nextWrapperId = 0;

export class ContentBlockWrapper {
  /**
   * 原始 content block
   */
  public readonly content: ContentBlockType;

  /**
   * Tool Result 的 Signal（响应式）
   * 用于实时对话中的 tool_result
   */
  private readonly toolResultSignal = signal<ToolResultBlock | undefined>(undefined);

  /**
   * The official `kJ.partial`: true while the block is still streaming in. Only the
   * stream assembler creates partial wrappers; `complete()` clears the flag.
   */
  private readonly partialSignal = signal(false);

  /**
   * Bumped by every streamed delta. The official re-keys the row on each update
   * (`kJ.key` = hash + lastModifiedTime); Vue views read this instead, because a
   * delta mutates `content` in place.
   */
  private readonly revisionSignal = signal(0);

  /** A stable identity for keying the rendered block (the official `kJ.hash`). */
  public readonly id = nextWrapperId++;

  /**
   * Tool Use Result（普通属性）
   * 用于会话加载时的 toolUseResult（不需要响应式）
   */
  public toolUseResult?: any;

  constructor(content: ContentBlockType, partial = false) {
    this.content = content;
    this.partialSignal(partial);
  }

  get partial() {
    return this.partialSignal;
  }

  get isPartial(): boolean {
    return this.partialSignal();
  }

  get revision() {
    return this.revisionSignal;
  }

  /** The official `kJ.updated()`: the content changed in place. */
  updated(): void {
    this.revisionSignal(this.revisionSignal() + 1);
  }

  /** The official `kJ.complete()`: the block finished streaming. */
  complete(): void {
    this.partialSignal(false);
    this.updated();
  }

  /**
   * 获取 toolResult signal
   *
   * @returns Alien signal 函数
   */
  get toolResult() {
    return this.toolResultSignal;
  }

  /**
   * 设置 tool result
   *
   * 🔥 使用 alien-signals 函数调用 API
   *
   * @param result Tool 执行结果
   */
  setToolResult(result: ToolResultBlock): void {
    this.toolResultSignal(result);
  }

  /**
   * 检查是否有 tool_result
   */
  hasToolResult(): boolean {
    return this.toolResultSignal() !== undefined;
  }

  /**
   * 获取 tool_result 的值（非响应式）
   */
  getToolResultValue(): ToolResultBlock | undefined {
    return this.toolResultSignal();
  }
}
