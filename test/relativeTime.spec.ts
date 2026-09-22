/**
 * Session row ages, against the official `K95`.
 *
 * `SessionsPage.vue` shipped a different function in a different language --
 * `刚刚`, `5分钟前`, `3天前`, then a `zh-CN` date after a week -- inside an
 * otherwise English UI. It is the text on every row of the list the activity
 * bar now opens, so it is the first thing anyone reads there.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { formatRelativeTime } from '../src/webview/src/utils/relativeTime';

const NOW = new Date('2026-09-20T12:00:00Z').getTime();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `ago(ms)` is a timestamp that many milliseconds before the frozen now. */
function ago(ms: number): number {
  vi.setSystemTime(NOW);
  return NOW - ms;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the official units', () => {
  it.each([
    [0, 'now'],
    [1 * SECOND, 'now'],
    [59 * SECOND, 'now'],
    [1 * MINUTE, '1m'],
    [59 * MINUTE, '59m'],
    [1 * HOUR, '1h'],
    [23 * HOUR, '23h'],
    [1 * DAY, '1d'],
    [29 * DAY, '29d'],
    [30 * DAY, '1mo'],
    [364 * DAY, '12mo'],
    [365 * DAY, '1y'],
    [800 * DAY, '2y'],
  ])('%dms ago reads %s', (delta, expected) => {
    vi.useFakeTimers();
    expect(formatRelativeTime(ago(delta))).toBe(expected);
  });

  it('never says "ago", and never uses a non-English word', () => {
    vi.useFakeTimers();
    for (const delta of [0, MINUTE, HOUR, DAY, 40 * DAY, 400 * DAY]) {
      const text = formatRelativeTime(ago(delta));
      expect(text).not.toContain('ago');
      expect(text).toMatch(/^(now|\d+(m|h|d|mo|y))$/);
    }
  });
});

describe('floor, not round', () => {
  it('a conversation 31 minutes old is 0h, not 1h', () => {
    // Rounding was the old behaviour and it lies in the direction that matters:
    // something you just left claiming to be an hour old.
    vi.useFakeTimers();
    expect(formatRelativeTime(ago(31 * MINUTE))).toBe('31m');
  });

  it('90 minutes is 1h, not 2h', () => {
    vi.useFakeTimers();
    expect(formatRelativeTime(ago(90 * MINUTE))).toBe('1h');
  });

  it('a boundary belongs to the larger unit only once it is reached', () => {
    vi.useFakeTimers();
    expect(formatRelativeTime(ago(HOUR - 1))).toBe('59m');
    expect(formatRelativeTime(ago(HOUR))).toBe('1h');
    expect(formatRelativeTime(ago(DAY - 1))).toBe('23h');
    expect(formatRelativeTime(ago(DAY))).toBe('1d');
  });
});

describe('inputs that are not a number', () => {
  it('accepts a Date and an ISO string alike', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const twoHoursAgo = new Date(NOW - 2 * HOUR);
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h');
    expect(formatRelativeTime(twoHoursAgo.toISOString())).toBe('2h');
  });

  it.each([undefined, null, 'not a date', NaN])('falls back to "now" for %j', (bad) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatRelativeTime(bad as any)).toBe('now');
  });

  it('does not go negative for a clock skewed into the future', () => {
    // A session written by a machine whose clock is ahead would otherwise read
    // "-1h". The official's floors make every future delta land on "now".
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatRelativeTime(NOW + HOUR)).toBe('now');
  });
});
