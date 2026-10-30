/**
 * Live text from the browser's on-device recognizer, in place of a socket to
 * a streaming service (research/browser-live-stt/). The recognizer takes the
 * mic graph's own track, so the PCM worklet (the recording that feeds HQ) and
 * this engine share one capture.
 *
 * Two behaviors of Chrome's recognizer shape this module:
 *
 *   - It can run for minutes as one growing interim result, with no final, so
 *     a word that has held still for {@link STABLE_WORD_MS} counts as final
 *     here. Keyword spotting matches finals anywhere and interims only at the
 *     start; without this, "send message" after a sentence would not fire.
 *   - It ends by itself (a long silence, or a session limit). {@link
 *     BrowserSpeechLink} restarts on the same track and keeps the text it has.
 */

import {
  browserSpeechAvailability,
  browserSpeechLang,
  liveEngine,
  speechRecognitionCtor,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from "../../lib/audio/live-engine";
import type { ServiceCallbacks } from "./transcription-connections";

/** How long a word must stay unchanged before it counts as final. */
export const STABLE_WORD_MS = 700;
const STABILITY_TICK_MS = 200;
/** Restarts closer together than this count toward {@link MAX_RAPID_RESTARTS}. */
const RAPID_RESTART_MS = 1000;
const MAX_RAPID_RESTARTS = 5;
/** Errors a restart would only repeat. */
const FATAL_ERRORS: ReadonlySet<string> = new Set(["not-allowed", "service-not-allowed", "language-not-supported", "audio-capture"]);

/**
 * Splits a changing word list into a stable prefix and a live tail. A word's
 * clock resets when it changes, ignoring case (the engine re-cases words as
 * context arrives). The prefix never shrinks; a later revision to a counted
 * word shows through because the text is rebuilt from the latest words.
 */
export class StablePrefix {
  private words: string[] = [];
  private changedAt: number[] = [];
  private count = 0;

  update(words: string[], now: number): void {
    this.changedAt = words.map((word, i) => (this.words[i]?.toLowerCase() === word.toLowerCase() ? (this.changedAt[i] ?? now) : now));
    this.words = words;
    this.count = Math.min(this.count, words.length);
  }

  /** How many leading words count as final at `now`. */
  stableCount(now: number): number {
    while (this.count < this.words.length && now - (this.changedAt[this.count] ?? now) >= STABLE_WORD_MS) this.count++;
    return this.count;
  }
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

export class BrowserSpeechLink {
  private readonly ctor: SpeechRecognitionCtor;
  private readonly lang: string;
  private readonly listen: (recognizer: SpeechRecognitionLike) => void;
  private readonly callbacks: ServiceCallbacks;
  private readonly now: () => number;
  private recognizer: SpeechRecognitionLike | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private wanted = true;
  private fatal = false;
  /** Text from recognizer instances that have ended. */
  private earlier: string[] = [];
  private instanceFinal: string[] = [];
  private instanceInterim: string[] = [];
  private stable = new StablePrefix();
  private lastStartAt = Number.NEGATIVE_INFINITY;
  private rapidRestarts = 0;
  private lastEmitted = "";

  constructor(opts: { ctor: SpeechRecognitionCtor; lang: string; listen: (recognizer: SpeechRecognitionLike) => void; callbacks: ServiceCallbacks; now?: () => number }) {
    this.ctor = opts.ctor;
    this.lang = opts.lang;
    this.listen = opts.listen;
    this.callbacks = opts.callbacks;
    this.now = opts.now ?? (() => performance.now());
  }

  start(): void {
    this.spawn();
    this.tick = setInterval(() => this.emit(), STABILITY_TICK_MS);
  }

  private spawn(): void {
    const now = this.now();
    this.rapidRestarts = now - this.lastStartAt < RAPID_RESTART_MS ? this.rapidRestarts + 1 : 0;
    this.lastStartAt = now;
    if (this.rapidRestarts > MAX_RAPID_RESTARTS) {
      this.giveUp("The browser's speech recognizer keeps stopping");
      return;
    }
    const recognizer = new this.ctor();
    recognizer.lang = this.lang;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.processLocally = true;
    recognizer.onresult = (event) => this.onResult(event);
    recognizer.onerror = (event) => {
      if (!FATAL_ERRORS.has(event.error)) {
        console.warn(`[realtime-transcription] browser speech error, restarting: ${event.error}`);
        return;
      }
      this.fatal = true;
      this.giveUp(`Browser speech failed: ${event.error}`);
    };
    recognizer.onend = () => this.onEnd();
    this.recognizer = recognizer;
    this.listen(recognizer);
  }

  private onResult(event: Parameters<NonNullable<SpeechRecognitionLike["onresult"]>>[0]): void {
    const final: string[] = [];
    const interim: string[] = [];
    for (const result of Array.from(event.results)) {
      const words = splitWords(result[0]?.transcript ?? "");
      (result.isFinal ? final : interim).push(...words);
    }
    this.instanceFinal = final;
    this.instanceInterim = interim;
    this.stable.update(interim, this.now());
    this.emit();
  }

  /** Keep the text the ended instance held, then carry on with a fresh one. */
  private onEnd(): void {
    this.foldInstance();
    this.emit();
    if (!this.wanted || this.fatal) return;
    try {
      this.spawn();
    } catch (e) {
      console.error("[realtime-transcription] browser speech restart failed:", e);
      this.giveUp("The browser's speech recognizer could not restart");
    }
  }

  private foldInstance(): void {
    this.earlier.push(...this.instanceFinal, ...this.instanceInterim);
    this.instanceFinal = [];
    this.instanceInterim = [];
    this.stable = new StablePrefix();
  }

  private emit(): void {
    const stableCount = this.stable.stableCount(this.now());
    const finalText = [...this.earlier, ...this.instanceFinal, ...this.instanceInterim.slice(0, stableCount)].join(" ");
    const interimText = this.instanceInterim.slice(stableCount).join(" ");
    const key = `${finalText}\n${interimText}`;
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    this.callbacks.onTextUpdate({ finalText, interimText });
  }

  private giveUp(message: string): void {
    this.foldInstance();
    this.emit();
    this.detach();
    this.callbacks.onServerError(message);
  }

  /** End of segment: everything heard so far becomes final, now. */
  finish(): void {
    if (!this.wanted) return;
    this.foldInstance();
    this.emit();
    this.detach();
  }

  /** Stop without touching text (the segment is being discarded). */
  detach(): void {
    this.wanted = false;
    if (this.tick !== null) {
      clearInterval(this.tick);
      this.tick = null;
    }
    const recognizer = this.recognizer;
    this.recognizer = null;
    if (recognizer === null) return;
    recognizer.onresult = null;
    recognizer.onerror = null;
    recognizer.onend = null;
    recognizer.abort();
  }
}

/**
 * The on-device engine for a segment. `"not-opted-in"` means this device uses
 * the box's service as usual. `unavailable` means it opted in but the engine
 * cannot run: the segment records with no live text rather than sending live
 * audio to a provider the person chose not to use, and `notice` tells them.
 */
export async function startBrowserSpeech(opts: {
  track: () => MediaStreamTrack | null;
  callbacks: ServiceCallbacks;
  stillWanted: () => boolean;
}): Promise<BrowserSpeechLink | "not-opted-in" | { unavailable: true; notice: string }> {
  if (liveEngine() !== "browser") return "not-opted-in";
  const ctor = speechRecognitionCtor();
  const lang = browserSpeechLang();
  const availability = await browserSpeechAvailability(lang).catch((e: unknown) => {
    console.warn("[realtime-transcription] browser speech availability check failed:", e);
    return "unavailable" as const;
  });
  const notice = availability === "downloadable" || availability === "downloading"
    ? "No live text: on-device speech isn't downloaded. Get it in Voice settings. Still recording."
    : "No live text: on-device speech isn't available here. Still recording.";
  if (!opts.stillWanted()) return { unavailable: true, notice };
  const track = availability === "available" ? opts.track() : null;
  if (ctor === null || track === null) {
    console.warn(`[realtime-transcription] browser speech not ready (${availability}, ${lang}); recording without live text`);
    return { unavailable: true, notice };
  }
  const link = new BrowserSpeechLink({ ctor, lang, listen: (recognizer) => recognizer.start(track), callbacks: opts.callbacks });
  try {
    link.start();
  } catch (e) {
    console.error("[realtime-transcription] browser speech failed to start; recording without live text:", e);
    link.detach();
    return { unavailable: true, notice: "No live text: on-device speech failed to start. Still recording." };
  }
  return link;
}
