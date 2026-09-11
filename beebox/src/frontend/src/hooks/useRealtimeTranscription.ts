/**
 * Hook for realtime speech-to-text via XState machine.
 *
 * Captures mic audio via AudioWorklet (PCM 16kHz mono), stages every frame
 * to the box, and routes it to the box's live transcription service when a
 * socket is up. See realtimeTranscriptionMachine.ts and transcription-actor.ts.
 *
 * The machine tracks finalTranscript and interimTranscript separately:
 *   - `transcript` (combined) is what the UI shows.
 *   - `finalTranscript` alone is what we run keyword detection against
 *     (interim revisions would otherwise misfire commands repeatedly).
 *
 * Each ended segment leaves a `PendingRecording` in machine context. The hook
 * hands it to exactly one place: a "submit" intent (which then owes the seal),
 * or — for every other end — a seal with `hq: null` here.
 */

import { useCallback, useEffect, useRef } from "react";
import { useMachine } from "@xstate/react";
import type { Actor } from "xstate";
import { transcriptionStateOf } from "../machines/realtimeTranscriptionMachine";
import { liveTranscriptionMachine } from "../machines/realtime-transcription-live";
import { segmentCapturing, type FinalWord, type TranscriptionEvent, type TranscriptionState } from "../machines/transcription-events";
import type { PendingRecording } from "../lib/audio/voice-stager";
import { stillListening, recordingStart } from "../lib/audio/earcons";
import { claimMicAcrossTabs } from "../lib/audio/mic-tab-lock";
import type { VoiceIntent } from "../input/voice-intent";
import { dispatchKeyword, useKeywordSpotting, type PendingSend } from "./transcription-keywords";

const STILL_LISTENING_DELAY_MS = 10000;

export type { TranscriptionState };

export interface UseRealtimeTranscriptionOptions {
  /**
   * The chat session a new segment's recording belongs to, read when each
   * segment starts; null while the chat has no session yet.
   */
  targetSessionId: () => string | null;
  /**
   * The four spoken commands the keyword spotter recognizes, as one
   * `VoiceIntent` stream (docs/implemented-plans/input-extraction.md, chunk 5).
   * `submit`'s `text` is the processed transcript, `matchedPhrase` the
   * trigger phrase the realtime pass matched (so a later transcription pass
   * that drops it can re-inject), and `recording` the segment's staged
   * recording, which the handler must seal or discard.
   */
  onVoiceIntent?: (intent: VoiceIntent) => void;
  /**
   * Called when a segment ends with transcript text nobody took: no stop()
   * promise was awaiting it and no send keyword fired — a mic loss that
   * outlasted its window, or a silence auto-stop. Without a handler the
   * words silently disappear from the composer when `isTranscribing` flips.
   */
  onUnconsumedTranscript?: (transcript: string) => void;
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
   * this segment (Voxtral/OpenAI realtime, or nothing finalized yet).
   */
  finalWords: FinalWord[] | null;
  /** Live, unconfirmed text. May change as the recognizer revises. */
  interimTranscript: string;
  error: string | null;
  /**
   * Begin a recording segment. Pass `{ earcon: true }` to play the
   * recording-start cue once capture is truly live (the mic started and
   * audio is staging — not the socket), never before the mic-permission
   * dialog settles. Auto-disarmed if the attempt errors out first.
   */
  start: (opts?: { earcon?: boolean }) => void;
  /**
   * Stop recording and wait for the final transcript and its words (Fix D,
   * docs/plans/transcript-confidence.md). The segment's recording is sealed
   * with `hq: null`: this path hands over text only.
   */
  stop: () => Promise<{ text: string; words: FinalWord[] | null }>;
  /**
   * End the segment and treat it as a submit — the same path a spoken send
   * keyword takes, triggered from a manual UI control
   * (docs/implemented-plans/hq-dictation-switch.md, chunk 2). Parks the
   * current combined transcript with an empty `matchedPhrase` and STOPs the
   * machine; the idle-transition effect fires the "submit" intent with the
   * segment's recording. Returns false when nothing is recording.
   */
  submitSegment: (opts: { closeMic: boolean }) => boolean;
  cancel: () => void;
  dismissError: () => void;
}

function combine(finalText: string, interimText: string): string {
  if (!finalText) return interimText;
  if (!interimText) return finalText;
  return `${finalText} ${interimText}`;
}

/**
 * Everything that happens when a segment ends: the parked send fires with the
 * segment's recording, a stop() promise resolves, an untaken recording is
 * sealed without HQ, unconsumed text is handed back, and MAX_DURATION parks a
 * submit. Declaration order matters: the consumption marks set by the first
 * two effects are read by the third in the same idle-transition commit.
 */
function useSegmentEnd(opts: {
  state: TranscriptionState;
  transcript: string;
  context: { finalWords: FinalWord[] | null; recording: PendingRecording | null };
  actorRef: Actor<typeof liveTranscriptionMachine>;
  optionsRef: React.MutableRefObject<UseRealtimeTranscriptionOptions>;
  pendingSendRef: React.MutableRefObject<PendingSend | null>;
  doneResolveRef: React.MutableRefObject<((result: { text: string; words: FinalWord[] | null }) => void) | null>;
}): void {
  const { state, transcript, context, actorRef, optionsRef, pendingSendRef, doneResolveRef } = opts;
  const { finalWords, recording } = context;
  /**
   * Set when this segment's text was handed to a consumer (stop() promise
   * resolution or a send); read and reset by the idle-transition effect.
   * Nothing else may reset it: a send calls start() synchronously from inside
   * the consuming effect, before the idle-transition effect has read the mark.
   */
  const consumedRef = useRef(false);
  const prevStateRef = useRef<TranscriptionState>("idle");
  /** The recording last handed to a submit; the submit owes its seal. */
  const handedOffRef = useRef<PendingRecording | null>(null);
  const transcriptRef = useRef(transcript);
  const recordingRef = useRef(recording);
  useEffect(() => {
    transcriptRef.current = transcript;
    recordingRef.current = recording;
  });

  // MAX_DURATION submits the segment (and the send re-arms the mic): park the
  // send before the machine's own STOP brings TRANSCRIPTION_DONE.
  useEffect(() => {
    const sub = actorRef.on("maxDurationReached", () => {
      if (pendingSendRef.current !== null) return;
      pendingSendRef.current = { processedTranscript: transcriptRef.current, matchedPhrase: "", closeMic: false, hq: false };
    });
    return () => sub.unsubscribe();
  }, [actorRef, pendingSendRef]);

  // A parked send fires once the machine is idle and the recording is in context.
  useEffect(() => {
    if (state !== "idle" || pendingSendRef.current === null) return;
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    const onVoiceIntent = optionsRef.current.onVoiceIntent;
    if (!onVoiceIntent) return;
    consumedRef.current = true;
    handedOffRef.current = recording;
    onVoiceIntent({
      kind: "submit",
      text: pending.processedTranscript,
      matchedPhrase: pending.matchedPhrase,
      closeMic: pending.closeMic,
      hq: pending.hq,
      recording,
      // The words the machine finalized for the parked text, at the same transition.
      words: finalWords,
    });
  }, [state, recording, finalWords, optionsRef, pendingSendRef]);

  // Resolve stop() when the machine returns to idle — words from context at
  // this same transition (Fix D), not from a caller's stale closure.
  useEffect(() => {
    if (state === "idle" && doneResolveRef.current) {
      doneResolveRef.current({ text: transcript, words: finalWords });
      doneResolveRef.current = null;
      consumedRef.current = true;
    }
  }, [state, transcript, finalWords, doneResolveRef]);

  // Segment ended: keep an untaken recording on the box without HQ, and hand
  // back text nobody took (see onUnconsumedTranscript).
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (state !== "idle" || prev === "idle") return;
    if (recording !== null && recording !== handedOffRef.current) recording.seal(null);
    const consumed = consumedRef.current;
    consumedRef.current = false;
    if (consumed || !transcript) return;
    optionsRef.current.onUnconsumedTranscript?.(transcript);
  }, [state, transcript, recording, optionsRef]);

  // Unmount between TRANSCRIPTION_DONE and the effects above: nothing will
  // take the recording now. (A segment still recording is sealed by the actor.)
  useEffect(() => () => {
    const latest = recordingRef.current;
    if (latest !== null && latest !== handedOffRef.current) latest.seal(null);
  }, []);
}

export function useRealtimeTranscription(
  options: UseRealtimeTranscriptionOptions
): UseRealtimeTranscriptionResult {
  const [snapshot, send, actorRef] = useMachine(liveTranscriptionMachine);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const doneResolveRef = useRef<((result: { text: string; words: FinalWord[] | null }) => void) | null>(null);
  const pendingSendRef = useRef<PendingSend | null>(null);
  /**
   * Set by `start({ earcon: true })`. The recording-start earcon plays when
   * the machine first reaches a capturing state (normally `recordingLocal`,
   * on MIC_LIVE) — never before the mic-permission dialog settles. Cleared on
   * play, or on a return to idle without capturing (error / cancel / denied).
   */
  const playStartEarconRef = useRef(false);
  const prevEarconStateRef = useRef<TranscriptionState>("idle");

  const state = transcriptionStateOf(snapshot);
  const { finalTranscript, finalWords, interimTranscript, error, recording } = snapshot.context;
  const transcript = combine(finalTranscript, interimTranscript);

  const startEvent = useCallback(
    (): TranscriptionEvent => ({ type: "START", targetSessionId: optionsRef.current.targetSessionId() }),
    [],
  );

  const fireKeyword = useCallback(
    (keyword: Parameters<typeof dispatchKeyword>[0]) =>
      dispatchKeyword(keyword, {
        send,
        pendingSendRef,
        emitIntent: (intent) => optionsRef.current.onVoiceIntent?.(intent),
        startEvent,
      }),
    [send, startEvent]
  );

  useSegmentEnd({
    state, transcript, context: { finalWords, recording }, actorRef, optionsRef, pendingSendRef, doneResolveRef,
  });

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

  // Recording-start earcon: fire when capture goes live, armed only by
  // start({ earcon: true }). getUserMedia resolves inside `connecting`, so a
  // cue played before that would precede the permission dialog.
  useEffect(() => {
    const prev = prevEarconStateRef.current;
    prevEarconStateRef.current = state;
    if (!playStartEarconRef.current) return;
    if (segmentCapturing(state) && !segmentCapturing(prev)) {
      playStartEarconRef.current = false;
      recordingStart.play();
    } else if (state === "idle") {
      playStartEarconRef.current = false;
    }
  }, [state]);

  const start = useCallback((opts?: { earcon?: boolean }) => {
    keywordSpotting.reset();
    if (opts?.earcon === true) playStartEarconRef.current = true;
    send(startEvent());
  }, [send, keywordSpotting, startEvent]);

  const stop = useCallback((): Promise<{ text: string; words: FinalWord[] | null }> => {
    // A stop while the live text is paused or the mic is recovering still
    // ends the segment properly; resolving immediately would leave it running.
    if (!segmentCapturing(state)) {
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

  const submitSegment = useCallback((opts: { closeMic: boolean }): boolean => {
    // A send is already parked (a spoken keyword fired moments before the
    // tap) — clobbering it would drop its matchedPhrase and "send HQ" choice.
    if (pendingSendRef.current !== null) return true;
    // Segment fully settled: the caller falls back to its direct-send path.
    if (state === "idle") return false;
    pendingSendRef.current = {
      processedTranscript: transcript,
      matchedPhrase: "",
      closeMic: opts.closeMic,
      hq: false,
    };
    // `connecting`/`finalizing`: nothing to stop yet, or a stop is already in
    // flight — the idle-transition effect fires the parked send either way.
    if (segmentCapturing(state)) send({ type: "STOP" });
    return true;
  }, [state, transcript, send]);

  // Cross-tab mic mutex: while a session is active, claim the mic (yielding
  // it in any other same-origin tab) and yield it back if another tab later
  // claims. Eviction ends a live segment with STOP, so its text and recording
  // survive; during `connecting` nothing is captured yet, so cancel. The
  // callback fires long after this effect ran, so it reads state from a ref.
  const active = state !== "idle";
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    if (!active) return;
    return claimMicAcrossTabs(() => {
      send(segmentCapturing(stateRef.current) ? { type: "STOP" } : { type: "CANCEL" });
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
