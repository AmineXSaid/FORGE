/**
 * Liveness for running channels.
 *
 * `ClaudeAgentService.channels` had no liveness check at all, so a channel that
 * stopped producing messages simply hung: the composer kept its spinner and the
 * user had no way to tell a thinking model from a dead one except by waiting.
 *
 * This matters more with self-hosted endpoints than with api.anthropic.com.
 * Queue backpressure, cold starts and a gateway that accepts a request and
 * never answers all produce stalls that Anthropic's API does not.
 *
 * **The watchdog never terminates anything.** That is the central design
 * decision, not a limitation. A turn legitimately goes quiet: the CLI runs a
 * ten-minute build inside a Bash call and emits nothing while it does. A
 * watchdog that killed on silence would abort real work, and abort it precisely
 * on the long-running tasks that are most expensive to lose. So it only ever
 * *reports*, and the user decides -- which makes a false positive cheap (a
 * notice that can be dismissed) instead of destructive.
 */

/** Silence is measured in multiples of the endpoint's own request timeout. */
export const STALL_TIMEOUT_MULTIPLIER = 3;

/** Floor, so a profile with a tiny timeoutMs cannot produce constant alarms. */
export const MIN_STALL_MS = 90_000;

/** How often the sweep runs. Coarse: this is a "something is wrong" signal. */
export const SWEEP_INTERVAL_MS = 15_000;

export type ChannelHealth = 'running' | 'stalled' | 'crashed';

export interface ChannelState {
  channelId: string;
  health: ChannelHealth;
  /** When the last stream message arrived. */
  lastBeat: number;
  /** When the channel started. */
  startedAt: number;
  /** Stream messages seen so far, so "stalled before any output" is visible. */
  beats: number;
  /** Set when the channel crashed. */
  error?: string;
}

export interface StallReport {
  channelId: string;
  /** How long the channel has been silent. */
  silentMs: number;
  /** Whether it produced anything at all before going quiet. */
  producedOutput: boolean;
  /** The threshold that was crossed. */
  thresholdMs: number;
}

export interface WatchdogOptions {
  /** Threshold source, in ms. Usually the active profile's `timeoutMs`. */
  requestTimeoutMs: () => number;
  /** Fired once per stall, never repeatedly for the same silence. */
  onStall: (report: StallReport) => void;
  /** Injectable for tests. */
  now?: () => number;
}

/**
 * Tracks which channels are still producing output.
 *
 * Deliberately has no timer of its own until `start()` is called, so
 * constructing one in a test costs nothing and leaves no handle behind.
 */
export class SessionWatchdog {
  private readonly states = new Map<string, ChannelState>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: WatchdogOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  /** The silence threshold, derived from the endpoint's request timeout. */
  thresholdMs(): number {
    const timeout = this.options.requestTimeoutMs();
    const base = Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000;
    return Math.max(MIN_STALL_MS, base * STALL_TIMEOUT_MULTIPLIER);
  }

  /** Begin watching a channel. */
  open(channelId: string): void {
    const at = this.now();
    this.states.set(channelId, {
      channelId,
      health: 'running',
      lastBeat: at,
      startedAt: at,
      beats: 0,
    });
  }

  /** Record a stream message. Clears a stall, because output means alive. */
  beat(channelId: string): void {
    const state = this.states.get(channelId);
    if (!state) return;
    state.lastBeat = this.now();
    state.beats += 1;
    // A channel that was reported stalled and then produced output is running
    // again, and is eligible to be reported again if it stalls later.
    if (state.health === 'stalled') state.health = 'running';
  }

  /** Mark a channel as having failed, so it is not silently discarded. */
  crashed(channelId: string, error: string): void {
    const state = this.states.get(channelId);
    if (!state) return;
    state.health = 'crashed';
    state.error = error;
  }

  /** Stop watching a channel that closed normally. */
  close(channelId: string): void {
    this.states.delete(channelId);
  }

  get(channelId: string): ChannelState | undefined {
    return this.states.get(channelId);
  }

  /** Channels that failed rather than finishing, for a recovery surface. */
  crashedChannels(): ChannelState[] {
    return [...this.states.values()].filter((s) => s.health === 'crashed');
  }

  /**
   * Check every channel once.
   *
   * Exposed so a test can drive it without waiting for the interval.
   */
  sweep(): StallReport[] {
    const threshold = this.thresholdMs();
    const at = this.now();
    const reports: StallReport[] = [];

    for (const state of this.states.values()) {
      if (state.health !== 'running') continue;
      const silentMs = at - state.lastBeat;
      if (silentMs < threshold) continue;

      // Latched, so one stall produces one report rather than one every sweep.
      state.health = 'stalled';
      const report: StallReport = {
        channelId: state.channelId,
        silentMs,
        producedOutput: state.beats > 0,
        thresholdMs: threshold,
      };
      reports.push(report);
      this.options.onStall(report);
    }
    return reports;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Never hold the extension host open on this alone. The DOM and Node
    // typings disagree about whether the handle has `unref`, so this is a
    // runtime check rather than a type assertion.
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.stop();
    this.states.clear();
  }

  /** Test seam. */
  get size(): number {
    return this.states.size;
  }
}

/**
 * The sentence shown to the user about a stall.
 *
 * Distinguishes the two cases because they have different likely causes and
 * different right answers: a channel that never produced anything usually means
 * the endpoint accepted the request and is not answering, while one that went
 * quiet mid-turn is usually a long-running tool -- and interrupting that would
 * throw away work in progress.
 */
export function describeStall(report: StallReport): string {
  const seconds = Math.round(report.silentMs / 1000);
  return report.producedOutput
    ? `This turn has produced no output for ${seconds}s. It may be running a long tool, ` +
      `or the endpoint may have stopped responding.`
    : `The endpoint has not answered for ${seconds}s and this turn has produced nothing yet. ` +
      `It may be queued behind other work, cold-starting, or not answering at all.`;
}
