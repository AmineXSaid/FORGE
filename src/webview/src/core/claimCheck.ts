/**
 * The claim checker lives in `src/shared/claimCheck.ts` now: the extension host
 * uses it too, to make the model answer for an unverified claim before the
 * turn ends (`services/claude/stopGate.ts`), where this badge only tells the
 * reader. Re-exported here so the webview's imports stay as they were.
 */
export * from '../../../shared/claimCheck';
