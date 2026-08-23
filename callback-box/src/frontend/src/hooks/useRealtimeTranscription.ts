/**
 * Hook for realtime speech-to-text via XState machine.
 *
 * Captures mic audio via AudioWorklet (PCM 16kHz mono) and routes it to
 * either the Voxtral WS proxy or directly to Deepgram (with a temp key),
 * depending on box config. See realtimeTranscriptionMachine.ts.
 *
 * The machine tracks finalTranscript and interimTranscript separately:
 *   - `transcript` (combined) is what the UI shows.
 *   - `finalTranscript` alone is what we run keyword detection against
 *     (interim revisions would otherwise misfire commands repeatedly).
 */

import { useCallback, useEffect, useRef } from "react";
import { useMachine } from "@xstate/react";
import {
  realtimeTranscriptionMachine,
  type TranscriptionState,
  type FinalWord,
} from "../machines/realtimeTranscriptionMachine";
import { detectKeyword, type KeywordResult } from "../lib/audio/speech-keywords";
import { stillListening, recordingStart } from "../lib/audio/earcons";
import { claimMicAcrossTabs } from "../lib/audio/mic-tab-lock";
import type { VoiceIntent } from "../input/voice-intent";

const STILL_LISTENING_DELAY_MS = 10000;

export type { TranscriptionState };

export interface UseRealtimeTranscriptionOptions {
  /**
   * The four spoken commands the keyword spotter recognizes, as one
   * `VoiceIntent` stream (docs/implemented-plans/input-extraction.md, chunk 5) instead
   * of four separate callbacks. `submit`'s `text` is the processed
   * transcript, `matchedPhrase` the trigger phrase the realtime pass
   * matched (so a later transcription pass that drops it can re-inject),
   * and `audioBlob` — when `wantAudioBlob` returned true and the segment
   * captured any audio — a WAV blob the caller can use for narration
   * mode's HQ pass.
   */
  onVoiceIntent?: (intent: VoiceIntent) => void;
  /**
   * Called when a segment ends with transcript text nobody took: no stop()
   * promise was awaiting it and no send keyword fired — a mid-recording
   * transport/mic failure, an expired reconnect window, or a silence /
   * max-duration auto-stop. Without a handler the words silently disappear
   * from the composer the moment `isTranscribing` flips false.
   */
  onUnconsumedTranscript?: (transcript: string) => void;
  /**
   * Predicate checked at keyword-fire time. When it returns false, the
   * machine is canceled immediately (fast path) and `onKeywordSend` fires
   * synchronously with `audioBlob = null`. When true, the machine is
   * stopped and the callback fires after the WS finalizes with the
   * recorded segment's WAV blob in hand. Default: false.
   */
  wantAudioBlob?: () => boolean;
}

export interface UseRealtimeTranscriptionResult {
  state: TranscriptionState;
  /** Final + interim text combined, for display. */
  transcript: string;
  /** Confirmed text only — keyword detection runs against this. */
  finalTranscript: string;
  /**
   * Words backing `finalTranscript`, with confidence when the service
   * reports one. `null` means no confidence data has been captured for
   * this segment (Voxtral/OpenAI realtime, or nothing finalized yet) —
   * only Deepgram ever produces an array. Stays aligned with
   * `finalTranscript` across reconnects; see realtimeTranscriptionMachine's
   * `finalWords` context field.
   */
  finalWords: FinalWord[] | null;
  /** Live, unconfirmed text. May change as the recognizer revises. */
  interimTranscript: string;
  error: string | null;
  /**
   * Begin a recording segment. Pass `{ earcon: true }` to play the
   * recording-start cue — but only once capture is *truly* live (the machine
   * reaches `recording`, i.e. getUserMedia resolved and the socket opened),
   * never before the mic-permission dialog settles. Auto-disarmed if the
   * attempt errors out (e.g. permission denied) before recording begins.
   */
  start: (opts?: { earcon?: boolean }) => void;
  /**
   * Stop recording and wait for the final transcript. Resolves with the
   * words backing that text too (Fix D, docs/plans/
   * transcript-confidence.md) — read inside the hook at the same idle
   * transition that finalizes them, never from a caller's possibly-stale
   * closure over the returned handle.
   */
  stop: () => Promise<{ text: string; words: FinalWord[] | null }>;
  /**
   * End the segment and treat it as a submit — the same finalize→blob path a
   * spoken send keyword takes, but triggered from a manual UI control (the
   * composer's stop-and-send buttons) rather than keyword detection
   * (docs/plans/hq-dictation-switch.md, chunk 2). Parks the current combined
   * transcript with an empty `matchedPhrase` (nothing was spoken to match)
   * and STOPs the machine; the same idle-transition effect that fires a
   * keyword-detected "submit" VoiceIntent fires this one too, so callers get
   * identical HQ / audio-blob / fallback handling for free instead of
   * duplicating it. No-op when nothing is recording.
   */
  submitSegment: (opts: { closeMic: boolean }) => void;
  cancel: () => void;
  dismissError: () => void;
}

function combine(finalText: string, interimText: string): string {
  if (!finalText) return interimText;
  if (!interimText) return finalText;
  return `${finalText} ${interimText}`;
}

/**
 * Keyword detection over the live transcripts: finals match anywhere (so
 * phrases spanning segments are caught); interims only at the start, deduped
 * by action+phrase so successive interim revisions containing the same match
 * don't re-fire. Returns reset(), called at segment start/cancel so dedup
 * state doesn't leak across segments.
 */
function useKeywordSpotting(opts: {
  state: TranscriptionState;
  finalTranscript: string;
  interimTranscript: string;
  fireKeyword: (keyword: KeywordResult) => void;
}): { reset: () => void } {
  const { state, finalTranscript, interimTranscript, fireKeyword } = opts;
  const prevFinalRef = useRef("");
  /**
   * Identifier of the most recent keyword fired against an *interim*
   * transcript ("<action>:<matchedPhrase>"). Cleared whenever the final
   * transcript changes (so a finalized keyword can re-fire later) or when
   * the interim has no match.
   */
  const lastInterimFireKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (finalTranscript === prevFinalRef.current) return;
    prevFinalRef.current = finalTranscript;
    // Final has advanced; allow the same keyword to fire again from interim.
    lastInterimFireKeyRef.current = null;

    if (!finalTranscript || state !== "recording") return;

    const keyword = detectKeyword(finalTranscript);
    if (!keyword) return;
    fireKeyword(keyword);
  }, [finalTranscript, state, fireKeyword]);

  useEffect(() => {
    if (state !== "recording" || !interimTranscript) {
      lastInterimFireKeyRef.current = null;
      return;
    }
    const keyword = detectKeyword(interimTranscript, { atStart: true });
    if (!keyword) {
      lastInterimFireKeyRef.current = null;
      return;
    }
    const fireKey = `${keyword.action}:${keyword.matchedPhrase}`;
    if (lastInterimFireKeyRef.current === fireKey) return;
    lastInterimFireKeyRef.current = fireKey;
    // The match was found against just the interim text, so its
    // processedTranscript only covers that segment. Prepend the existing
    // final text so commands like "send message" don't drop everything
    // the user said before the keyword.
    const combinedProcessed = finalTranscript
      ? `${finalTranscript} ${keyword.processedTranscript}`.trim()
      : keyword.processedTranscript;
    fireKeyword({ ...keyword, processedTranscript: combinedProcessed });
  }, [interimTranscript, finalTranscript, state, fireKeyword]);

  const reset = useCallback(() => {
    prevFinalRef.current = "";
    lastInterimFireKeyRef.current = null;
  }, []);
  return { reset };
}

/**
 * Turn a spotted keyword into the right machine event(s) plus a
 * `VoiceIntent`. Module-level (not a hook body closure) so
 * `useRealtimeTranscription`'s own body stays under the per-function line
 * budget; takes the machine's `send`, the live-options ref, and the
 * slow-path parking ref as explicit context instead of closing over hook
 * internals.
 */
function dispatchKeyword(
  keyword: KeywordResult,
  ctx: {
    send: (event: { type: "STOP" | "CANCEL" | "START" }) => void;
    optionsRef: React.MutableRefObject<UseRealtimeTranscriptionOptions | undefined>;
    pendingSendRef: React.MutableRefObject<{ processedTranscript: string; matchedPhrase: string; closeMic: boolean; hq: boolean } | null>;
    /**
     * Live-synced snapshot of `finalWords`, read at the same moment the
     * fast path commits its text (docs/plans/transcript-confidence.md,
     * Track 3) — a plain state variable would go stale inside this
     * module-level function, which isn't itself a hook.
     */
    finalWordsRef: React.MutableRefObject<FinalWord[] | null>;
  }
): void {
  const { send, optionsRef, pendingSendRef, finalWordsRef } = ctx;
  switch (keyword.action) {
    case "send":
    case "sendHq":
    case "sendClose": {
      // All send variants use one path. `closeMic` controls re-arming, while
      // `hq` asks the chat layer to run HQ even when narration mode is off.
      const closeMic = keyword.action === "sendClose";
      const hq = keyword.action === "sendHq";
      const wantBlob = optionsRef.current?.wantAudioBlob?.() ?? false;
      if (wantBlob) {
        // Slow path: park the text and STOP so the machine finalizes and
        // emits the segment's audio blob. The idle-transition effect fires the
        // "submit" intent with both text and blob once the machine settles.
        // Used by narration mode to get the HQ-quality transcript.
        pendingSendRef.current = {
          processedTranscript: keyword.processedTranscript,
          matchedPhrase: keyword.matchedPhrase,
          closeMic,
          hq,
        };
        send({ type: "STOP" });
      } else {
        // Fast path: drop the in-flight stream and fire immediately so the
        // message commits with the realtime text — no waiting on WS
        // finalization (which adds 1-2s of dead air).
        send({ type: "CANCEL" });
        optionsRef.current?.onVoiceIntent?.({
          kind: "submit",
          text: keyword.processedTranscript,
          matchedPhrase: keyword.matchedPhrase,
          audioBlob: null,
          closeMic,
          hq,
          words: finalWordsRef.current,
        });
      }
      break;
    }
    case "micOff":
      send({ type: "CANCEL" });
      optionsRef.current?.onVoiceIntent?.({ kind: "mic-off" });
      break;
    case "cancel":
      optionsRef.current?.onVoiceIntent?.({ kind: "cancel" });
      break;
    case "erase":
      send({ type: "CANCEL" });
      send({ type: "START" });
      // Notify the consumer: the machine restart only clears the live
      // segment; the chat layer holds the rest of the in-progress message
      // (composer input, persisted draft) and must erase it too.
      optionsRef.current?.onVoiceIntent?.({ kind: "erase" });
      break;
  }
}

export function useRealtimeTranscription(
  options?: UseRealtimeTranscriptionOptions
): UseRealtimeTranscriptionResult {
  const [snapshot, send] = useMachine(realtimeTranscriptionMachine);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const doneResolveRef = useRef<((result: { text: string; words: FinalWord[] | null }) => void) | null>(null);
  /**
   * When a send-keyword fires, we send STOP to the machine and wait for it
   * to transition to idle so the audio blob lands in context. The pending
   * text + matched phrase are parked here in the meantime; the
   * idle-transition effect picks them up and fires onKeywordSend.
   */
  const pendingSendRef = useRef<{ processedTranscript: string; matchedPhrase: string; closeMic: boolean; hq: boolean } | null>(null);
  /**
   * Set by `start({ earcon: true })`. The recording-start earcon plays only
   * when the machine actually reaches `recording` — so the "you're recording
   * now" cue never precedes the mic-permission dialog or lies about a segment
   * that hasn't gone live. Cleared on play, or on a return to idle without
   * recording (error / cancel / permission denied).
   */
  const playStartEarconRef = useRef(false);
  const prevEarconStateRef = useRef<TranscriptionState>("idle");
  /**
   * Set when this segment's text was handed to a consumer (stop() promise
   * resolution or a keyword send); checked by the unconsumed-transcript
   * effect below, which must be declared after both so it observes their
   * same-commit writes, and which resets the mark after every read. Nothing
   * else may reset it — see the note in start().
   */
  const consumedRef = useRef(false);
  const prevSegmentStateRef = useRef<TranscriptionState>("idle");

  // Map machine state to TranscriptionState (nested under "active" parent)
  const state: TranscriptionState = snapshot.matches({ active: "recording" })
    ? "recording"
    : snapshot.matches({ active: "reconnecting" })
      ? "reconnecting"
      : snapshot.matches({ active: "finalizing" })
        ? "finalizing"
        : snapshot.matches({ active: "connecting" })
          ? "connecting"
          : "idle";

  const { finalTranscript, finalWords, interimTranscript, error } = snapshot.context;
  const transcript = combine(finalTranscript, interimTranscript);

  // Live-synced snapshot of finalWords, read by the fast keyword-send path
  // (dispatchKeyword, a module function outside the render closure) at the
  // same moment it commits the text (Track 3, docs/plans/
  // transcript-confidence.md). Declared here — before fireKeyword/keyword
  // spotting below — so the sync effect runs first within a commit.
  const finalWordsRef = useRef<FinalWord[] | null>(finalWords);
  useEffect(() => {
    finalWordsRef.current = finalWords;
  });

  // Wake-lock used to live here, tied to mic state. It now lives in the
  // chat layer where the broader "voice conversation in progress" signal
  // is available — mic-active alone doesn't capture the TTS-playback
  // window where the mic is intentionally paused.

  const fireKeyword = useCallback(
    (keyword: KeywordResult) => dispatchKeyword(keyword, { send, optionsRef, pendingSendRef, finalWordsRef }),
    [send]
  );

  // Slow-path completion: fire the "submit" intent after the machine has
  // finalized and the audio blob is in context. Triggered by the state
  // transition back to idle. No-op when the fast path was taken (ref is null).
  useEffect(() => {
    if (state !== "idle" || pendingSendRef.current === null) return;
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    consumedRef.current = true;
    optionsRef.current?.onVoiceIntent?.({
      kind: "submit",
      text: pending.processedTranscript,
      matchedPhrase: pending.matchedPhrase,
      closeMic: pending.closeMic,
      hq: pending.hq,
      audioBlob: snapshot.context.audioBlob,
      // Read alongside the parked text at the same idle transition, so the
      // words are the ones the machine finalized for it (Track 3).
      words: snapshot.context.finalWords,
    });
  }, [state, snapshot.context.audioBlob, snapshot.context.finalWords]);

  const keywordSpotting = useKeywordSpotting({ state, finalTranscript, interimTranscript, fireKeyword });

  // Idle cue: subtle earcon every 10s while recording if there's text but
  // no new updates have arrived
  useEffect(() => {
    if (state !== "recording" || !transcript) return;
    const interval = setInterval(() => {
      stillListening.play();
    }, STILL_LISTENING_DELAY_MS);
    return () => clearInterval(interval);
  }, [state, transcript]);

  // Resolve stop() promise when machine returns to idle — words come from
  // context at this same idle transition (Fix D), not from a caller's
  // possibly-stale closure over the returned handle.
  useEffect(() => {
    if (state === "idle" && doneResolveRef.current) {
      doneResolveRef.current({ text: transcript, words: snapshot.context.finalWords });
      doneResolveRef.current = null;
      consumedRef.current = true;
    }
  }, [state, transcript, snapshot.context.finalWords]);

  // Segment ended with text nobody took (see onUnconsumedTranscript docs).
  // Declared after the keyword-send and stop()-resolve effects so their
  // consumption marks land first within the same idle-transition commit.
  useEffect(() => {
    const prev = prevSegmentStateRef.current;
    prevSegmentStateRef.current = state;
    if (state !== "idle" || prev === "idle") return;
    const consumed = consumedRef.current;
    consumedRef.current = false;
    if (consumed || !transcript) return;
    optionsRef.current?.onUnconsumedTranscript?.(transcript);
  }, [state, transcript]);

  // Recording-start earcon: fire the moment capture goes live (entering
  // `recording`), and only when armed by start({ earcon: true }). This is the
  // fix for "earcon plays before recording starts" — getUserMedia resolves
  // inside the machine's `connecting` state, so anything that played the cue
  // before start() ran would precede the permission dialog and lie about
  // being live. Disarm on a return to idle without recording (denied/error).
  useEffect(() => {
    const prev = prevEarconStateRef.current;
    prevEarconStateRef.current = state;
    if (!playStartEarconRef.current) return;
    if (state === "recording" && prev !== "recording") {
      playStartEarconRef.current = false;
      recordingStart.play();
    } else if (state === "idle") {
      playStartEarconRef.current = false;
    }
  }, [state]);

  const start = useCallback((opts?: { earcon?: boolean }) => {
    keywordSpotting.reset();
    // Deliberately do NOT touch consumedRef here: a keyword send calls
    // start() synchronously from inside the consuming effect, BEFORE the
    // unconsumed-transcript effect below has read the mark. Resetting it
    // here made every narration send re-fold its own just-sent text into
    // the composer. The unconsumed effect resets the mark after each read,
    // so it can't go stale across segments.
    if (opts?.earcon === true) playStartEarconRef.current = true;
    send({ type: "START" });
  }, [send, keywordSpotting]);

  const stop = useCallback((): Promise<{ text: string; words: FinalWord[] | null }> => {
    // A stop during a reconnect blip still ends the segment properly —
    // resolving immediately would leave the machine reconnecting and the
    // expired window would later re-surface the same text as unconsumed.
    if (state !== "recording" && state !== "reconnecting") {
      return Promise.resolve({ text: transcript, words: finalWords });
    }
    send({ type: "STOP" });
    return new Promise((resolve) => {
      doneResolveRef.current = resolve;
    });
  }, [state, transcript, finalWords, send]);

  const cancel = useCallback(() => {
    keywordSpotting.reset();
    send({ type: "CANCEL" });
  }, [send, keywordSpotting]);

  const submitSegment = useCallback((opts: { closeMic: boolean }) => {
    if (state !== "recording" && state !== "reconnecting") return;
    // Mirrors dispatchKeyword's "send" case (wantBlob branch) — this app
    // always wants the blob, so that branch is the only one manual
    // stop-and-send needs to reach.
    pendingSendRef.current = {
      processedTranscript: transcript,
      matchedPhrase: "",
      closeMic: opts.closeMic,
      hq: false,
    };
    send({ type: "STOP" });
  }, [state, transcript, send]);

  // Cross-tab mic mutex: while a recording session is active, claim the mic
  // (yielding it in any other same-origin tab that holds it) and yield it back
  // if another tab later claims. Eviction ends the segment the same way an OS
  // mic-grab does — STOP, not CANCEL — so the captured transcript survives into
  // the composer via onUnconsumedTranscript instead of vanishing. During
  // `connecting` there's nothing captured yet and STOP isn't handled, so cancel
  // to tear down cleanly. The callback fires whenever another tab claims, long
  // after this effect ran, so it must read the live state from a ref.
  const active = state !== "idle";
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    if (!active) return;
    return claimMicAcrossTabs(() => {
      const current = stateRef.current;
      if (current === "recording" || current === "reconnecting") {
        send({ type: "STOP" });
      } else {
        send({ type: "CANCEL" });
      }
    });
  }, [active, send]);

  const dismissError = useCallback(() => {
    send({ type: "DISMISS_ERROR" });
  }, [send]);

  return {
    state,
    transcript,
    finalTranscript,
    finalWords,
    interimTranscript,
    error,
    start,
    stop,
    submitSegment,
    cancel,
    dismissError,
  };
}
