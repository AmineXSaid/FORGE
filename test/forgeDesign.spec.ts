/**
 * Forge's own design where it departs from the official on purpose (the user's
 * requests, 2026-09-19): the composer's placeholder wording, and the capability
 * chips on the model menu. docs/forge-design.md lists them.
 */
import { describe, expect, it } from 'vitest';
import {
  FIRST_RUN_PLACEHOLDER,
  IDLE_LINES,
  WORKING_PLACEHOLDER,
  forgePlaceholder,
  pickIdleLine,
} from '../src/webview/src/components/forge/composerVoice';
import { modelCapabilities } from '../src/webview/src/components/forge/effort';

describe("the composer's placeholder, in Forge's voice", () => {
  const idleLine = IDLE_LINES[0];

  it('keeps the three official states: working, first run, then the focus shortcut', () => {
    expect(forgePlaceholder({ working: true, firstRun: true, mac: false, idleLine })).toBe(WORKING_PLACEHOLDER);
    expect(forgePlaceholder({ working: false, firstRun: true, mac: false, idleLine })).toBe(FIRST_RUN_PLACEHOLDER);
    expect(forgePlaceholder({ working: false, firstRun: false, mac: false, idleLine })).toBe(`${idleLine} · ctrl esc toggles focus`);
    expect(forgePlaceholder({ working: false, firstRun: false, mac: true, idleLine })).toBe(`${idleLine} · ⌘ Esc toggles focus`);
  });

  it('picks one idle line, and every random value lands on a line', () => {
    expect(pickIdleLine(0)).toBe(IDLE_LINES[0]);
    expect(pickIdleLine(0.999999)).toBe(IDLE_LINES[IDLE_LINES.length - 1]);
    expect(pickIdleLine(1)).toBe(IDLE_LINES[IDLE_LINES.length - 1]);
    expect(pickIdleLine(-1)).toBe(IDLE_LINES[0]);
    for (let i = 0; i < 50; i++) expect(IDLE_LINES).toContain(pickIdleLine());
  });

  it('never mentions Claude, and keeps the shortcut short enough for a sidebar', () => {
    for (const line of [FIRST_RUN_PLACEHOLDER, WORKING_PLACEHOLDER, ...IDLE_LINES]) expect(line).not.toMatch(/claude/i);
    for (const line of IDLE_LINES) {
      expect(forgePlaceholder({ working: false, firstRun: false, mac: false, idleLine: line }).length).toBeLessThanOrEqual(70);
    }
  });
});

describe('the model menu capability chips', () => {
  const settings = { effective: {} };
  const ids = (row: Parameters<typeof modelCapabilities>[0], s: any = settings) => modelCapabilities(row, s).map((c) => c.id);

  it('only what the CLI lists: Max for max, Ultracode for xhigh, Fast for fast mode', () => {
    expect(ids({ supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsFastMode: true })).toEqual([
      'max',
      'ultracode',
      'fast',
    ]);
    expect(ids({ supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] })).toEqual([]);
    expect(ids({ supportsEffort: true })).toEqual([]);
    expect(ids({ supportsEffort: false, supportedEffortLevels: ['max'], supportsFastMode: false })).toEqual([]);
  });

  it("Ultracode follows the official rule: not before settings are read, not with workflows disabled", () => {
    const row = { supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] };
    expect(modelCapabilities(row, undefined)).toEqual([]);
    expect(ids(row, { effective: { disableWorkflows: true } })).toEqual([]);
    expect(ids(row)).toEqual(['ultracode']);
  });
});
