/**
 * Spoken-command handling for `useRealtimeTranscription`: spotting keywords
 * in the live transcript, and turning a spotted keyword into machine events
 * plus a `VoiceIntent`. Split from the hook to keep it under the line budget.
 */

import { useCallback, useEffect, useRef } from "react";
import { detectKeyword, type KeywordResult } from "../lib/audio/speech-keywords";
import type { TranscriptionEvent, TranscriptionState } from "../machines/transcription-events";
import type { VoiceIntent } from "../input/voice-intent";

/**
 * A send waiting for its segment to end: the text is parked here while the
 * machine STOPs, and the hook's idle-transition effect fires the "submit"
 * intent with it and the segment's recording.
 */
export interface PendingSend {
  processedTranscript: string;
  matchedPhrase: string;
  closeMic: boolean;
  hq: boolean;
}

/**
 * Keyword detection over the live transcripts: finals match anywhere (so
 * phrases spanning segments are caught); interims only at the start, deduped
 * by action+phrase so successive interim revisions containing the same match
 * don't re-fire. Gated on `recording` — the only state with live text.
 * Returns reset(), called at segment start/cancel so dedup state doesn't leak
 * across segments.
 */
export function useKeywordSpotting(opts: {
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
 * `VoiceIntent`. Every send variant parks its text and STOPs: the segment's
 * TRANSCRIPTION_DONE brings the recording, and the hook fires "submit" with
 * both once the machine is idle.
 */
export function dispatchKeyword(
  keyword: KeywordResult,
  ctx: {
    send: (event: TranscriptionEvent) => void;
    pendingSendRef: React.MutableRefObject<PendingSend | null>;
    emitIntent: (intent: VoiceIntent) => void;
    /** The START event for a fresh segment (reads the target session at call time). */
    startEvent: () => TranscriptionEvent;
  },
): void {
  const { send, pendingSendRef, emitIntent, startEvent } = ctx;
  switch (keyword.action) {
    case "send":
    case "sendHq":
    case "sendClose":
      // `closeMic` controls re-arming; `hq` asks the chat layer for HQ even
      // when narration mode is off.
      pendingSendRef.current = {
        processedTranscript: keyword.processedTranscript,
        matchedPhrase: keyword.matchedPhrase,
        closeMic: keyword.action === "sendClose",
        hq: keyword.action === "sendHq",
      };
      send({ type: "STOP" });
      break;
    case "micOff":
      send({ type: "CANCEL" });
      emitIntent({ kind: "mic-off" });
      break;
    case "cancel":
      emitIntent({ kind: "cancel" });
      break;
    case "erase":
      send({ type: "CANCEL" });
      send(startEvent());
      // The machine restart only clears the live segment; the chat layer
      // holds the rest of the in-progress message and must erase it too.
      emitIntent({ kind: "erase" });
      break;
  }
}
