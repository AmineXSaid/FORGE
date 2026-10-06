/**
 * The guard policy (48b): one table for every guard, from the profile's level
 * and the Alpha switch. Alpha off must equal what each level did before Alpha.
 */
import { describe, expect, it } from 'vitest';
import { ALPHA_THRESHOLDS, guardPolicy } from '../src/forge-sdk/guards/policy';
import { STRICT_MAX_TURNS, thresholdsFor } from '../src/forge-sdk/guards/loopGuard';
import type { GuardLevel } from '../src/forge-sdk/guards/levels';

describe('guardPolicy: the full level x alpha matrix', () => {
  it.each<[GuardLevel, boolean, ReturnType<typeof guardPolicy>]>([
    // Alpha off: exactly the behaviour before Alpha existed.
    ['strict', false, { hints: true, emptyAnswer: true, claimChallenge: true, editDiagnostics: true, loop: thresholdsFor('strict'), stepCap: STRICT_MAX_TURNS, smallModelRules: true, alphaRules: false }],
    ['standard', false, { hints: true, emptyAnswer: true, claimChallenge: false, editDiagnostics: false, loop: { repeats: 5 }, stepCap: undefined, smallModelRules: false, alphaRules: false }],
    ['off', false, { hints: false, emptyAnswer: false, claimChallenge: false, editDiagnostics: false, loop: undefined, stepCap: undefined, smallModelRules: false, alphaRules: false }],
    // Alpha on.
    ['strict', true, { hints: true, emptyAnswer: true, claimChallenge: true, editDiagnostics: true, loop: thresholdsFor('strict'), stepCap: STRICT_MAX_TURNS, smallModelRules: true, alphaRules: true }],
    ['standard', true, { hints: true, emptyAnswer: true, claimChallenge: true, editDiagnostics: true, loop: ALPHA_THRESHOLDS, stepCap: 60, smallModelRules: false, alphaRules: true }],
    ['off', true, { hints: true, emptyAnswer: true, claimChallenge: true, editDiagnostics: true, loop: ALPHA_THRESHOLDS, stepCap: 60, smallModelRules: false, alphaRules: true }],
  ])('%s, alpha %s', (level, alpha, expected) => {
    expect(guardPolicy(level, alpha)).toEqual(expected);
  });

  it('Alpha thresholds are tuned for strong models', () => {
    expect(ALPHA_THRESHOLDS).toEqual({ repeats: 3, readOnlyStreak: 20, maxTurns: 60 });
    // strict keeps its small-model read-only streak under Alpha.
    expect(guardPolicy('strict', true).loop?.readOnlyStreak).toBe(8);
  });
});
