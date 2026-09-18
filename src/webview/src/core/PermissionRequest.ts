import type { PermissionUpdate, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from '../utils/events';

let nextRequestId = 1;

/**
 * One tool-permission prompt: the official `CL`.
 *
 * `accept` sends no permission updates unless it is given some. Only the
 * prompt's second option ("... don't ask again", "Yes, allow X for ...") passes
 * the suggestions back; plain "Yes" allows this one call.
 */
export class PermissionRequest {
  readonly channelId: string;
  readonly toolName: string;
  readonly inputs: Record<string, unknown>;
  readonly suggestions: PermissionUpdate[];
  /** Open on the decline option, with no one-key approve (`CanUseTool` `defaultToNo`). */
  readonly defaultToNo: boolean;
  /** Offer no "don't ask again" option (`CanUseTool` `suppressAlwaysAllowRule`). */
  readonly suppressAlwaysAllowRule: boolean;
  readonly toolUseId?: string;
  readonly agentId?: string;
  /** The official `id`: the prompt is keyed on it, so a new request starts fresh. */
  readonly id = nextRequestId++;

  private readonly resolved: EventEmitter<PermissionResult> = new EventEmitter();

  constructor(
    channelId: string,
    toolName: string,
    inputs: Record<string, unknown>,
    suggestions: PermissionUpdate[] = [],
    defaultToNo = false,
    suppressAlwaysAllowRule = false,
    toolUseId?: string,
    agentId?: string
  ) {
    this.channelId = channelId;
    this.toolName = toolName;
    this.inputs = inputs;
    this.suggestions = suggestions;
    this.defaultToNo = defaultToNo;
    this.suppressAlwaysAllowRule = suppressAlwaysAllowRule;
    this.toolUseId = toolUseId;
    this.agentId = agentId;
  }

  accept(updatedInput: Record<string, unknown> = {}, updatedPermissions: PermissionUpdate[] = []): void {
    this.resolved.emit({ behavior: 'allow', updatedInput, updatedPermissions });
  }

  reject(message: string, interrupt?: boolean): void {
    this.resolved.emit({ behavior: 'deny', message, interrupt });
  }

  onResolved(callback: (resolution: PermissionResult) => void): () => void {
    return this.resolved.add(callback);
  }
}
