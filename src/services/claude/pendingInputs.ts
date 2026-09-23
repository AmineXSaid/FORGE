/**
 * Which messages a channel's CLI still holds.
 *
 * A message typed while the model works is sent at once, as the official does,
 * and the CLI queues it: it is folded into the running turn between tool
 * rounds, or it runs as the next turn. So one `result` does not mean the
 * channel is idle -- a message sent mid-way through a turn that ended without
 * a tool round is still waiting. Closing the channel then (an endpoint switch
 * recycles idle channels, and retires a stale one after its turn) would drop
 * that message.
 *
 * The CLI says what it consumed in two places, both keyed by the uuid the
 * webview minted for the message:
 * - the echo `--replay-user-messages` produces (`SDKUserMessageReplay`,
 *   `isReplay: true`, sdk.d.ts:5923), sent when it takes the message;
 * - the turn's `result`: `user_message_uuid` and `user_message_uuids`, "every
 *   user message whose prompt this turn consumed" (sdk.d.ts:5368-5372 on the
 *   error result, 5402-5403 on the success one).
 */

export interface TurnTracking {
  /** A turn is running, or a message is still queued for one. */
  turnOpen?: boolean;
  /** Uuids of messages sent to the CLI and not yet consumed by a turn. */
  pendingInputs?: Set<string>;
}

type AnyMessage = { type?: unknown; uuid?: unknown; isReplay?: unknown; user_message_uuid?: unknown; user_message_uuids?: unknown };

/** A user message went into the channel's input stream. */
export function noteInputSent(channel: TurnTracking, message: AnyMessage): void {
  channel.turnOpen = true;
  if (typeof message.uuid === 'string' && message.uuid) {
    (channel.pendingInputs ??= new Set()).add(message.uuid);
  }
}

/**
 * A message came out of the CLI. Returns true when it ended a turn and the
 * channel has nothing left queued, i.e. the channel is now idle.
 */
export function noteOutput(channel: TurnTracking, message: AnyMessage): boolean {
  if (message.type === 'user' && message.isReplay === true && typeof message.uuid === 'string') {
    channel.pendingInputs?.delete(message.uuid);
    return false;
  }
  if (message.type !== 'result') return false;

  const consumed = [
    ...(typeof message.user_message_uuid === 'string' ? [message.user_message_uuid] : []),
    ...(Array.isArray(message.user_message_uuids) ? message.user_message_uuids.filter((u): u is string => typeof u === 'string') : []),
  ];
  if (consumed.length === 0 && message.user_message_uuid === undefined && message.user_message_uuids === undefined) {
    // An older CLI that reports neither: the result is all there is to go on,
    // which is how every channel was treated before.
    channel.pendingInputs?.clear();
  } else {
    for (const uuid of consumed) channel.pendingInputs?.delete(uuid);
  }
  channel.turnOpen = (channel.pendingInputs?.size ?? 0) > 0;
  return !channel.turnOpen;
}
