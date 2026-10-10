import { mergeFinalText, mergeFinalWords } from "./transcription-merge";
import type { FinalWord } from "../transcription-events";
import { LIVE_GAP_MARKER } from "../../lib/audio/live-gap-marker";

/**
 * Where the segment stands on live gaps (docs/implemented-plans/live-gap-marker.md):
 * - `beforeFirst`: no connection yet; nothing is shown for the wait.
 * - `none`: live text is complete as far as it goes.
 * - `open`: live text is down; the committed text ends with the marker.
 * - `awaitingText`: a reconnect replayed the whole gap; the marker stays
 *   until the new connection's first non-empty final text.
 */
type GapState = "beforeFirst" | "none" | "open" | "awaitingText";

/**
 * One segment's transcript across live connections. Each transport emits its
 * session's full accumulated transcript (replace, not append), and a
 * reconnect opens an empty-start session — so text confirmed by earlier
 * connections is folded into a committed prefix and prepended to everything
 * the current connection emits. Word lists follow the same rule; `null`
 * means no service attached word data (Voxtral/OpenAI) and stays `null`.
 * A gap in live text is marked with `LIVE_GAP_MARKER`; see `GapState`.
 */
export class SegmentTranscript {
  private gap: GapState = "beforeFirst";
  /**
   * The trailing marker stands for audio no replay will bring back: live text
   * dropped again before a covered reconnect delivered any words, so the
   * earlier outage may lie outside the next replay.
   */
  private markerPermanent = false;
  private committedText = "";
  private currentText = "";
  private committedWords: FinalWord[] | null = null;
  private currentWords: FinalWord[] | null = null;

  /** Record the current connection's final text/words; returns the segment-wide merge. */
  update(opts: { finalText: string; finalWords: FinalWord[] | null }): { text: string; words: FinalWord[] | null } {
    if (this.gap === "awaitingText" && opts.finalText.trim() !== "") {
      this.dropTrailingMarker();
      this.gap = "none";
    }
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

  /** Live text went down (a drop, or given up for the segment): fold, then mark the gap once. */
  openGap(): void {
    const pendingRecovery = this.gap === "awaitingText";
    this.fold();
    if (!this.committedText.endsWith(LIVE_GAP_MARKER)) {
      this.committedText = mergeFinalText(this.committedText, LIVE_GAP_MARKER);
      this.markerPermanent = false;
    } else if (pendingRecovery) {
      this.markerPermanent = true;
    }
    this.gap = "open";
  }

  /**
   * A connection was adopted and replayed what it could. `covered`: the
   * replay held every frame since the outage (`ReplayRing.coversGap`).
   * Returns whether the text changed.
   */
  connected(opts: { covered: boolean }): boolean {
    const before = this.committedText;
    if (this.gap === "beforeFirst") {
      if (!opts.covered) this.committedText = mergeFinalText(this.committedText, LIVE_GAP_MARKER);
      this.gap = "none";
    } else if (this.gap === "open") {
      this.gap = opts.covered && !this.markerPermanent ? "awaitingText" : "none";
    }
    return this.committedText !== before;
  }

  private dropTrailingMarker(): void {
    if (this.committedText.endsWith(LIVE_GAP_MARKER)) {
      this.committedText = this.committedText.slice(0, -LIVE_GAP_MARKER.length).trimEnd();
    }
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
