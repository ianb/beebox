import { mergeFinalText, mergeFinalWords } from "./transcription-merge";
import type { FinalWord } from "./transcription-events";

/**
 * One segment's transcript across live connections. Each transport emits its
 * session's full accumulated transcript (replace, not append), and a
 * reconnect opens an empty-start session — so text confirmed by earlier
 * connections is folded into a committed prefix and prepended to everything
 * the current connection emits. Word lists follow the same rule; `null`
 * means no service attached word data (Voxtral/OpenAI) and stays `null`.
 */
export class SegmentTranscript {
  private committedText = "";
  private currentText = "";
  private committedWords: FinalWord[] | null = null;
  private currentWords: FinalWord[] | null = null;

  /** Record the current connection's final text/words; returns the segment-wide merge. */
  update(opts: { finalText: string; finalWords: FinalWord[] | null }): { text: string; words: FinalWord[] | null } {
    this.currentText = opts.finalText;
    this.currentWords = opts.finalWords;
    return { text: this.textWith(opts.finalText), words: this.wordsWith(opts.finalWords) };
  }

  /** The current connection is going away: fold its text into the prefix. */
  fold(): void {
    if (this.currentText) {
      this.committedText = mergeFinalText(this.committedText, this.currentText);
      this.currentText = "";
    }
    this.committedWords = mergeFinalWords(this.committedWords, this.currentWords);
    this.currentWords = null;
  }

  /** Segment text given a connection's own final text. */
  textWith(finalText: string): string {
    return mergeFinalText(this.committedText, finalText);
  }

  /** Segment words given a connection's own final words. */
  wordsWith(words: FinalWord[] | null): FinalWord[] | null {
    return mergeFinalWords(this.committedWords, words);
  }
}
