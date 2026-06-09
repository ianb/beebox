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
import { useSSRMachine } from "./useSSRMachine";
import {
  realtimeTranscriptionMachine,
  type TranscriptionState,
} from "../machines/realtimeTranscriptionMachine";
import { detectKeyword, type KeywordResult } from "../lib/speech-keywords";
import { stillListening, recordingStart } from "../lib/earcons";

const STILL_LISTENING_DELAY_MS = 10000;

export type { TranscriptionState };

export interface UseRealtimeTranscriptionOptions {
  /**
   * Called when a send keyword fires. Receives the processed transcript,
   * the trigger phrase the realtime pass matched (so a later transcription
   * pass that drops it can re-inject), and (if `wantAudioBlob` returned
   * true and the segment captured any audio) a WAV blob the caller can use
   * for narration mode's HQ pass.
   */
  onKeywordSend?: (send: {
    processedTranscript: string;
    matchedPhrase: string;
    audioBlob: Blob | null;
  }) => void;
  onKeywordCancel?: () => void;
  onKeywordMicOff?: () => void;
  onKeywordErase?: () => void;
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
  /** Stop recording and wait for final transcript. Returns the final text. */
  stop: () => Promise<string>;
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

export function useRealtimeTranscription(
  options?: UseRealtimeTranscriptionOptions
): UseRealtimeTranscriptionResult {
  const [snapshot, send] = useSSRMachine(realtimeTranscriptionMachine);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const doneResolveRef = useRef<((text: string) => void) | null>(null);
  /**
   * When a send-keyword fires, we send STOP to the machine and wait for it
   * to transition to idle so the audio blob lands in context. The pending
   * text + matched phrase are parked here in the meantime; the
   * idle-transition effect picks them up and fires onKeywordSend.
   */
  const pendingSendRef = useRef<{ processedTranscript: string; matchedPhrase: string } | null>(null);
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
   * same-commit writes. Cleared on each segment end and on start().
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

  const { finalTranscript, interimTranscript, error } = snapshot.context;
  const transcript = combine(finalTranscript, interimTranscript);

  // Wake-lock used to live here, tied to mic state. It now lives in the
  // chat layer where the broader "voice conversation in progress" signal
  // is available — mic-active alone doesn't capture the TTS-playback
  // window where the mic is intentionally paused.

  const fireKeyword = useCallback((keyword: KeywordResult) => {
    if (keyword.action === "send") {
      const wantBlob = optionsRef.current?.wantAudioBlob?.() ?? false;
      if (wantBlob) {
        // Slow path: park the text and STOP so the machine finalizes and
        // emits the segment's audio blob. The idle-transition effect below
        // fires onKeywordSend with both text and blob once the machine
        // settles. Used by narration mode to get the HQ-quality transcript.
        pendingSendRef.current = {
          processedTranscript: keyword.processedTranscript,
          matchedPhrase: keyword.matchedPhrase,
        };
        send({ type: "STOP" });
      } else {
        // Fast path: drop the in-flight stream and fire immediately so
        // the message commits with the realtime text — no waiting on WS
        // finalization (which adds 1-2s of dead air).
        send({ type: "CANCEL" });
        optionsRef.current?.onKeywordSend?.({
          processedTranscript: keyword.processedTranscript,
          matchedPhrase: keyword.matchedPhrase,
          audioBlob: null,
        });
      }
    } else if (keyword.action === "micOff") {
      send({ type: "CANCEL" });
      optionsRef.current?.onKeywordMicOff?.();
    } else if (keyword.action === "cancel") {
      optionsRef.current?.onKeywordCancel?.();
    } else if (keyword.action === "erase") {
      send({ type: "CANCEL" });
      send({ type: "START" });
    }
  }, [send]);

  // Slow-path completion: fire onKeywordSend after the machine has finalized
  // and the audio blob is in context. Triggered by the state transition back
  // to idle. No-op when the fast path was taken (ref is null).
  useEffect(() => {
    if (state !== "idle" || pendingSendRef.current === null) return;
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    consumedRef.current = true;
    optionsRef.current?.onKeywordSend?.({ ...pending, audioBlob: snapshot.context.audioBlob });
  }, [state, snapshot.context.audioBlob]);

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

  // Resolve stop() promise when machine returns to idle
  useEffect(() => {
    if (state === "idle" && doneResolveRef.current) {
      doneResolveRef.current(transcript);
      doneResolveRef.current = null;
      consumedRef.current = true;
    }
  }, [state, transcript]);

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
    consumedRef.current = false;
    if (opts?.earcon === true) playStartEarconRef.current = true;
    send({ type: "START" });
  }, [send, keywordSpotting]);

  const stop = useCallback((): Promise<string> => {
    // A stop during a reconnect blip still ends the segment properly —
    // resolving immediately would leave the machine reconnecting and the
    // expired window would later re-surface the same text as unconsumed.
    if (state !== "recording" && state !== "reconnecting") {
      return Promise.resolve(transcript);
    }
    send({ type: "STOP" });
    return new Promise<string>((resolve) => {
      doneResolveRef.current = resolve;
    });
  }, [state, transcript, send]);

  const cancel = useCallback(() => {
    keywordSpotting.reset();
    send({ type: "CANCEL" });
  }, [send, keywordSpotting]);

  const dismissError = useCallback(() => {
    send({ type: "DISMISS_ERROR" });
  }, [send]);

  return {
    state,
    transcript,
    finalTranscript,
    interimTranscript,
    error,
    start,
    stop,
    cancel,
    dismissError,
  };
}
