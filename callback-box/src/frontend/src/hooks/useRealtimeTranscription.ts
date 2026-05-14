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
import { stillListening } from "../lib/earcons";

const STILL_LISTENING_DELAY_MS = 10000;

export type { TranscriptionState };

export interface UseRealtimeTranscriptionOptions {
  /**
   * Called when a send keyword fires. Receives the processed transcript
   * and (if `wantAudioBlob` returned true and the segment captured any
   * audio) a WAV blob the caller can use for narration mode's HQ pass.
   */
  onKeywordSend?: (processedTranscript: string, audioBlob: Blob | null) => void;
  onKeywordCancel?: () => void;
  onKeywordMicOff?: () => void;
  onKeywordErase?: () => void;
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
  start: () => void;
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

export function useRealtimeTranscription(
  options?: UseRealtimeTranscriptionOptions
): UseRealtimeTranscriptionResult {
  const [snapshot, send] = useSSRMachine(realtimeTranscriptionMachine);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const doneResolveRef = useRef<((text: string) => void) | null>(null);
  const prevFinalRef = useRef("");
  /**
   * When a send-keyword fires, we send STOP to the machine and wait for it
   * to transition to idle so the audio blob lands in context. The pending
   * text is parked here in the meantime; the idle-transition effect picks
   * it up and fires onKeywordSend(text, audioBlob).
   */
  const pendingSendTextRef = useRef<string | null>(null);
  /**
   * Identifier of the most recent keyword fired against an *interim*
   * transcript ("<action>:<matchedPhrase>"). Suppresses re-firing when an
   * interim revision still contains the same match. Cleared whenever the
   * final transcript changes (so a finalized keyword can re-fire later) or
   * when the interim has no match.
   */
  const lastInterimFireKeyRef = useRef<string | null>(null);

  // Map machine state to TranscriptionState (nested under "active" parent)
  const state: TranscriptionState = snapshot.matches({ active: "recording" })
    ? "recording"
    : snapshot.matches({ active: "finalizing" })
      ? "finalizing"
      : snapshot.matches({ active: "connecting" })
        ? "connecting"
        : "idle";

  const { finalTranscript, interimTranscript, error } = snapshot.context;
  const transcript = combine(finalTranscript, interimTranscript);

  // Screen Wake Lock: keep device awake while recording
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isActive = state !== "idle";

  useEffect(() => {
    if (!isActive) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }
    let cancelled = false;
    navigator.wakeLock?.request("screen").then((sentinel) => {
      if (cancelled) {
        sentinel.release().catch(() => {});
      } else {
        wakeLockRef.current = sentinel;
      }
    }).catch((err) => {
      console.warn("[realtime-transcription] Wake lock failed:", err);
    });
    return () => {
      cancelled = true;
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [isActive]);

  // Re-acquire wake lock when tab regains focus (browser releases it on hide)
  useEffect(() => {
    if (!isActive) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && wakeLockRef.current && wakeLockRef.current.released) {
        navigator.wakeLock?.request("screen").then((sentinel) => {
          wakeLockRef.current = sentinel;
        }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isActive]);

  const fireKeyword = useCallback((keyword: KeywordResult) => {
    if (keyword.action === "send") {
      const wantBlob = optionsRef.current?.wantAudioBlob?.() ?? false;
      if (wantBlob) {
        // Slow path: park the text and STOP so the machine finalizes and
        // emits the segment's audio blob. The idle-transition effect below
        // fires onKeywordSend with both text and blob once the machine
        // settles. Used by narration mode to get the HQ-quality transcript.
        pendingSendTextRef.current = keyword.processedTranscript;
        send({ type: "STOP" });
      } else {
        // Fast path: drop the in-flight stream and fire immediately so
        // the message commits with the realtime text — no waiting on WS
        // finalization (which adds 1-2s of dead air).
        send({ type: "CANCEL" });
        optionsRef.current?.onKeywordSend?.(keyword.processedTranscript, null);
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
    if (state !== "idle" || pendingSendTextRef.current === null) return;
    const text = pendingSendTextRef.current;
    pendingSendTextRef.current = null;
    optionsRef.current?.onKeywordSend?.(text, snapshot.context.audioBlob);
  }, [state, snapshot.context.audioBlob]);

  // Keyword detection on confirmed (final) text — matches anywhere, so it
  // catches phrases that span multiple final segments.
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

  // Keyword detection on the live (interim) text — only matches at the
  // *start* of the interim, since command words mid-utterance are usually
  // false positives. Dedup by action+phrase so successive interim revisions
  // containing the same match don't fire repeatedly.
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
    }
  }, [state, transcript]);

  const start = useCallback(() => {
    prevFinalRef.current = "";
    lastInterimFireKeyRef.current = null;
    send({ type: "START" });
  }, [send]);

  const stop = useCallback((): Promise<string> => {
    if (state !== "recording") {
      return Promise.resolve(transcript);
    }
    send({ type: "STOP" });
    return new Promise<string>((resolve) => {
      doneResolveRef.current = resolve;
    });
  }, [state, transcript, send]);

  const cancel = useCallback(() => {
    prevFinalRef.current = "";
    lastInterimFireKeyRef.current = null;
    send({ type: "CANCEL" });
  }, [send]);

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
