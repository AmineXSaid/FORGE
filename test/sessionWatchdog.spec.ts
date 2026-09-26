/**
 * A2: session watchdog and crash recovery.
 *
 * The behaviour worth pinning hardest is a negative one: **the watchdog never
 * terminates anything.** A turn legitimately goes quiet while the CLI runs a
 * ten-minute build inside a Bash call, so killing on silence would abort real
 * work — and abort it precisely on the long-running tasks that are most
 * expensive to lose. It reports; the user decides. That makes a false positive
 * cheap rather than destructive, which is why the threshold can be generous
 * without being useless.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MIN_STALL_MS,
  STALL_TIMEOUT_MULTIPLIER,
  SessionWatchdog,
  describeStall,
  type StallReport,
} from '../src/services/claude/sessionWatchdog';

/** A watchdog with a controllable clock, so nothing in these specs waits. */
function makeWatchdog(timeoutMs = 120_000) {
  let clock = 0;
  const stalls: StallReport[] = [];
  const watchdog = new SessionWatchdog({
    requestTimeoutMs: () => timeoutMs,
    onStall: (r) => stalls.push(r),
    now: () => clock,
  });
  return {
    watchdog,
    stalls,
    advance: (ms: number) => { clock += ms; },
  };
}

describe('the threshold follows the endpoint, not a constant', () => {
  it('is a multiple of the profile request timeout', () => {
    const { watchdog } = makeWatchdog(300_000);
    expect(watchdog.thresholdMs()).toBe(300_000 * STALL_TIMEOUT_MULTIPLIER);
  });

  it('is floored, so a tiny timeout cannot produce constant alarms', () => {
    const { watchdog } = makeWatchdog(1_000);
    expect(watchdog.thresholdMs()).toBe(MIN_STALL_MS);
  });

  it('falls back sanely on a nonsense timeout', () => {
    for (const bad of [0, -1, NaN]) {
      const { watchdog } = makeWatchdog(bad);
      expect(watchdog.thresholdMs()).toBe(120_000 * STALL_TIMEOUT_MULTIPLIER);
    }
  });

  it('is generous, because a false positive must be cheap', () => {
    // A ten-minute build is a real thing. The threshold is allowed to be
    // long precisely because crossing it costs a dismissable notice.
    const { watchdog } = makeWatchdog(120_000);
    expect(watchdog.thresholdMs()).toBeGreaterThanOrEqual(6 * 60_000);
  });
});

describe('a channel producing output is never reported', () => {
  it('stays quiet while beats keep arriving', () => {
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('c1');
    for (let i = 0; i < 20; i++) {
      advance(60_000);
      watchdog.beat('c1');
      watchdog.sweep();
    }
    expect(stalls).toEqual([]);
  });

  it('reports only after the threshold is crossed', () => {
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('c1');

    advance(watchdog.thresholdMs() - 1);
    watchdog.sweep();
    expect(stalls).toEqual([]);

    advance(2);
    watchdog.sweep();
    expect(stalls).toHaveLength(1);
  });
});

describe('a stall is reported once, not every sweep', () => {
  it('latches', () => {
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('c1');
    advance(watchdog.thresholdMs() + 1);
    watchdog.sweep();
    watchdog.sweep();
    watchdog.sweep();
    expect(stalls).toHaveLength(1);
  });

  it('can report again after the channel recovers', () => {
    // Output means alive. A channel that woke up and stalled again is a new
    // fact and deserves a new notice.
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('c1');

    advance(watchdog.thresholdMs() + 1);
    watchdog.sweep();
    expect(stalls).toHaveLength(1);

    watchdog.beat('c1');
    expect(watchdog.get('c1')?.health).toBe('running');

    advance(watchdog.thresholdMs() + 1);
    watchdog.sweep();
    expect(stalls).toHaveLength(2);
  });
});

describe('the report distinguishes the two silences', () => {
  it('flags a channel that never produced anything', () => {
    // Usually the endpoint accepted the request and is not answering.
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('c1');
    advance(watchdog.thresholdMs() + 1);
    watchdog.sweep();
    expect(stalls[0].producedOutput).toBe(false);
    expect(describeStall(stalls[0])).toMatch(/produced nothing yet/);
  });

  it('flags a channel that went quiet mid-turn', () => {
    // Usually a long-running tool, where interrupting throws away work.
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('c1');
    watchdog.beat('c1');
    advance(watchdog.thresholdMs() + 1);
    watchdog.sweep();
    expect(stalls[0].producedOutput).toBe(true);
    expect(describeStall(stalls[0])).toMatch(/long tool/);
  });

  it('reports how long the silence lasted', () => {
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('c1');
    advance(400_000);
    watchdog.sweep();
    expect(stalls[0].silentMs).toBe(400_000);
    expect(describeStall(stalls[0])).toMatch(/400s/);
  });
});

describe('channels are independent', () => {
  it('reports only the silent one', () => {
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('quiet');
    watchdog.open('busy');

    for (let i = 0; i < 10; i++) {
      advance(60_000);
      watchdog.beat('busy');
      watchdog.sweep();
    }
    expect(stalls.map((s) => s.channelId)).toEqual(['quiet']);
  });

  it('ignores beats for a channel it is not watching', () => {
    const { watchdog } = makeWatchdog();
    expect(() => watchdog.beat('never-opened')).not.toThrow();
    expect(watchdog.size).toBe(0);
  });
});

describe('crash recovery: a failed channel is marked, not discarded', () => {
  it('records the error', () => {
    const { watchdog } = makeWatchdog();
    watchdog.open('c1');
    watchdog.crashed('c1', 'CLI exited with code 1');
    expect(watchdog.get('c1')?.health).toBe('crashed');
    expect(watchdog.get('c1')?.error).toMatch(/exited with code 1/);
  });

  it('lists crashed channels for a recovery surface', () => {
    const { watchdog } = makeWatchdog();
    watchdog.open('ok');
    watchdog.open('bad');
    watchdog.crashed('bad', 'boom');
    expect(watchdog.crashedChannels().map((c) => c.channelId)).toEqual(['bad']);
  });

  it('never reports a crashed channel as stalled as well', () => {
    // It already failed loudly; a second notice saying it is quiet is noise.
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('c1');
    watchdog.crashed('c1', 'boom');
    advance(watchdog.thresholdMs() * 5);
    watchdog.sweep();
    expect(stalls).toEqual([]);
  });
});

describe('lifecycle', () => {
  it('stops watching a channel that closed', () => {
    const { watchdog, stalls, advance } = makeWatchdog();
    watchdog.open('c1');
    watchdog.close('c1');
    advance(watchdog.thresholdMs() * 3);
    watchdog.sweep();
    expect(stalls).toEqual([]);
    expect(watchdog.size).toBe(0);
  });

  it('leaves no timer behind after dispose', () => {
    vi.useFakeTimers();
    try {
      const watchdog = new SessionWatchdog({
        requestTimeoutMs: () => 120_000,
        onStall: () => { },
      });
      watchdog.start();
      expect(vi.getTimerCount()).toBe(1);
      watchdog.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('start is idempotent', () => {
    vi.useFakeTimers();
    try {
      const watchdog = new SessionWatchdog({
        requestTimeoutMs: () => 120_000,
        onStall: () => { },
      });
      watchdog.start();
      watchdog.start();
      watchdog.start();
      expect(vi.getTimerCount()).toBe(1);
      watchdog.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('constructs without starting a timer', () => {
    vi.useFakeTimers();
    try {
      // eslint-disable-next-line no-new
      new SessionWatchdog({ requestTimeoutMs: () => 1, onStall: () => { } });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Found by the end-to-end run (2026-09-24): every conversation left open for
// six minutes got "This turn has produced no output", with no turn running.
describe('only a running turn is watched', () => {
  it('stays quiet while the channel is idle between turns', () => {
    const clock = { t: 0 };
    const stalls: StallReport[] = [];
    const dog = new SessionWatchdog({ requestTimeoutMs: () => 120_000, onStall: (r) => stalls.push(r), now: () => clock.t });
    dog.open('c');
    dog.beat('c');
    dog.idle('c'); // the result arrived
    clock.t += 3_600_000;
    expect(dog.sweep()).toEqual([]);
    expect(dog.get('c')?.health).toBe('idle');
  });

  it('watches again from the next message, timed from when it was sent', () => {
    const clock = { t: 0 };
    const dog = new SessionWatchdog({ requestTimeoutMs: () => 120_000, onStall: () => {}, now: () => clock.t });
    dog.open('c');
    dog.idle('c');
    clock.t += 3_600_000;
    dog.turnStarted('c');
    clock.t += dog.thresholdMs() - 1;
    expect(dog.sweep()).toEqual([]);
    clock.t += 2;
    expect(dog.sweep().map((r) => r.channelId)).toEqual(['c']);
  });

  it('a message between turns does not start the clock; a crash stays a crash', () => {
    const clock = { t: 0 };
    const dog = new SessionWatchdog({ requestTimeoutMs: () => 120_000, onStall: () => {}, now: () => clock.t });
    dog.open('c');
    dog.idle('c');
    dog.beat('c');
    clock.t += 3_600_000;
    expect(dog.sweep()).toEqual([]);
    dog.crashed('c', 'boom');
    dog.turnStarted('c');
    dog.idle('c');
    expect(dog.get('c')?.health).toBe('crashed');
  });
});
