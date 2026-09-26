/**
 * Notice a reply that has started repeating itself.
 *
 * Small models degenerate into "chanting" -- the same sentence, or the same
 * few sentences, over and over until `max_tokens` -- and every repeat costs
 * the user time and the gateway tokens. The relay sees the text as it streams,
 * so it can stop reading the moment the pattern is clear instead of waiting
 * for the token limit.
 *
 * Ported from Gemini CLI `packages/core/src/services/loopDetectionService.ts`
 * (`checkContentLoop`, `analyzeContentChunksForLoop`,
 * `isLoopDetectedForChunk`), constants unchanged: a 50-character window
 * slides over the text; a window seen 10 times, with the occurrences on
 * average no more than 5 windows apart and with at most 5 distinct stretches
 * of text between them, is a loop. Code blocks, tables, lists, headings and
 * quotes reset the tracking, because repetitive structure is normal there.
 * The only change is the key: the window text itself instead of its SHA-256,
 * which is the same comparison without the hashing.
 */

const CHUNK_SIZE = 50;
const LOOP_THRESHOLD = 10;
const MAX_HISTORY_LENGTH = 5000;

export class RepetitionDetector {
  private history = '';
  private index = 0;
  private stats = new Map<string, number[]>();
  private inCodeBlock = false;

  /** Feed one streamed text delta. True once the reply is repeating. */
  push(content: string): boolean {
    const numFences = (content.match(/```/g) ?? []).length;
    const hasTable = /(^|\n)\s*(\|.*\||[|+-]{3,})/.test(content);
    const hasListItem = /(^|\n)\s*[*+-]\s/.test(content) || /(^|\n)\s*\d+\.\s/.test(content);
    const hasHeading = /(^|\n)#+\s/.test(content);
    const hasBlockquote = /(^|\n)>\s/.test(content);
    const isDivider = /^[+\-_=*─-╿]+$/.test(content);
    if (numFences || hasTable || hasListItem || hasHeading || hasBlockquote || isDivider) this.reset();

    const wasInCodeBlock = this.inCodeBlock;
    if (numFences % 2 === 1) this.inCodeBlock = !this.inCodeBlock;
    if (wasInCodeBlock || this.inCodeBlock || isDivider) return false;

    this.history += content;
    this.truncate();
    while (this.index + CHUNK_SIZE <= this.history.length) {
      if (this.isLoopAt(this.history.substring(this.index, this.index + CHUNK_SIZE))) return true;
      this.index++;
    }
    return false;
  }

  private reset(): void {
    this.history = '';
    this.index = 0;
    this.stats.clear();
  }

  private truncate(): void {
    if (this.history.length <= MAX_HISTORY_LENGTH) return;
    const cut = this.history.length - MAX_HISTORY_LENGTH;
    this.history = this.history.slice(cut);
    this.index = Math.max(0, this.index - cut);
    for (const [chunk, positions] of this.stats) {
      const kept = positions.map((p) => p - cut).filter((p) => p >= 0);
      if (kept.length) this.stats.set(chunk, kept);
      else this.stats.delete(chunk);
    }
  }

  private isLoopAt(chunk: string): boolean {
    const positions = this.stats.get(chunk);
    if (!positions) {
      this.stats.set(chunk, [this.index]);
      return false;
    }
    positions.push(this.index);
    if (positions.length < LOOP_THRESHOLD) return false;

    const recent = positions.slice(-LOOP_THRESHOLD);
    const averageDistance = (recent[recent.length - 1] - recent[0]) / (LOOP_THRESHOLD - 1);
    if (averageDistance > CHUNK_SIZE * 5) return false;

    // A true loop repeats the same stretch between occurrences; a list of
    // distinct items that merely share a prefix does not.
    const periods = new Set<string>();
    for (let i = 0; i < recent.length - 1; i++) periods.add(this.history.substring(recent[i], recent[i + 1]));
    return periods.size <= Math.floor(LOOP_THRESHOLD / 2);
  }
}
