/**
 * Voice orchestration for InteractiveChat. Composes the speech-dispatch hook
 * (TTS playback off the stream) with realtime transcription + keyword
 * spotting, the narration HQ-transcription pass, the screen wake lock, and
 * the transcription handlers. The two halves share the voice refs created in
 * useSpeechDispatch so mic pause/resume stays coordinated with playback.
 *
 * All hooks run unconditionally and in a fixed order, so rules-of-hooks hold
 * exactly as in the original inline component.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRealtimeTranscription } from "../../hooks/useRealtimeTranscription";
import { useDebouncedWakeLock } from "../../hooks/useWakeLock";
import { detectKeyword } from "../../lib/speech-keywords";
import { postAudioForHqTranscription } from "../../api";
import { sendSound, tick, recordingStart, recordingStop } from "../../lib/earcons";
import { localTime } from "./InteractiveChat-helpers";
import { useSpeechDispatch, type VoiceRefs } from "./InteractiveChat-speech";
import type { ReplaySpeechOptions } from "../ChatMessages";

interface SnapshotLike {
  value: unknown;
  context: { streamText: string };
}

/**
 * Run the realtime-transcription `onKeywordSend` flow. Module-level so the
 * hook body stays under the per-function line budget. Invoked from inside
 * the inline event handler, so reading `*.current` here is at fire time, not
 * render time.
 */
function runKeywordSend(opts: {
  text: string;
  audioBlob: Blob | null;
  transcription: { start: () => void };
  refs: VoiceRefs;
  sessionId: string | null;
  narrationEnabledRef: React.MutableRefObject<boolean>;
  setHqInFlight: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingHqDraft: React.Dispatch<React.SetStateAction<string | null>>;
  doSend: (wrapped: string) => void;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
}) {
  const { text, audioBlob, transcription, refs, sessionId, narrationEnabledRef, setHqInFlight, setPendingHqDraft, doSend, zoomedViewAttr, timePassedAttr } = opts;
  if (!text.trim()) {
    transcription.start();
    return;
  }
  sendSound.play();
  refs.stopTickRef.current = tick.repeatPlay(1000, 30000);
  // Narration mode swaps in a high-quality transcription before sending
  // to the agent — the realtime text is good enough for the live UI
  // but accuracy matters more for the persistent record.
  const submit = (finalText: string, submitOpts?: { diarized?: boolean }) => {
    const diarizedAttr = submitOpts?.diarized === true ? " diarized=\"1\"" : "";
    doSend(`<speech${diarizedAttr} local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${finalText}</speech>`);
  };
  if (narrationEnabledRef.current && audioBlob) {
    setHqInFlight(true);
    setPendingHqDraft(text);
    void postAudioForHqTranscription(audioBlob, { sessionId })
      .then((hqResult) => {
        // Clear the pending bubble before submit so it doesn't overlap
        // with the real user message about to land in the chat history.
        setPendingHqDraft(null);
        if (hqResult === null) {
          console.warn("[hq-transcribe] returned null — falling back to realtime");
          submit(text);
          return;
        }
        // Re-run keyword detection on the HQ text so the agent sees the
        // send-message (or other) keyword as a pill, not plain words.
        // If HQ misheard the keyword entirely, just submit the raw text.
        const keyword = detectKeyword(hqResult.text);
        submit(keyword ? keyword.processedTranscript : hqResult.text, { diarized: hqResult.diarized });
      })
      .finally(() => { setHqInFlight(false); });
  } else {
    if (narrationEnabledRef.current) {
      console.warn("[hq-transcribe] narration enabled but no audioBlob — submitting realtime text");
    }
    submit(text);
  }
  // Restart recording so the user can keep talking
  transcription.start();
}

export function useChatVoice(opts: {
  snapshot: SnapshotLike;
  sessionId: string | null;
  muted: boolean;
  narrationEnabled: boolean;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  doSend: (wrapped: string) => void;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
}) {
  const { snapshot, sessionId, muted, narrationEnabled, setInput, doSend, zoomedViewAttr, timePassedAttr } = opts;

  const [voicePaused, setVoicePaused] = useState(false);
  const { speechPlayback, refs } = useSpeechDispatch({ snapshot, muted, setVoicePaused });
  const { turnTakingRef, transcriptionRef, voicePausedRef } = refs;

  // Realtime transcription with voice keyword spotting. `wantAudioBlob`
  // is a predicate read at keyword-fire time so a mid-session toggle of
  // narration takes effect on the next send.
  const narrationEnabledRef = useRef(narrationEnabled);
  useEffect(() => { narrationEnabledRef.current = narrationEnabled; });
  const [hqInFlight, setHqInFlight] = useState(false);
  // Realtime transcript shown as a pending user-message bubble while the
  // HQ pass runs. Null when no narration submit is in flight. Driven by
  // the same lifecycle as hqInFlight but carries the text to render.
  const [pendingHqDraft, setPendingHqDraft] = useState<string | null>(null);

  const transcription = useRealtimeTranscription({
    wantAudioBlob: () => narrationEnabledRef.current,
    onKeywordSend: (text, audioBlob) => runKeywordSend({
      text, audioBlob, transcription,
      refs, sessionId, narrationEnabledRef, setHqInFlight, setPendingHqDraft,
      doSend, zoomedViewAttr, timePassedAttr,
    }),
    onKeywordCancel: () => {
      transcription.cancel();
    },
    onKeywordMicOff: () => {
      turnTakingRef.current = false;
      recordingStop.play();
    },
    onKeywordErase: () => {
      // Transcript is already cleared by the hook; nothing else needed
    },
  });
  useEffect(() => {
    transcriptionRef.current = transcription;
  });
  const isTranscribing =
    transcription.state === "connecting" ||
    transcription.state === "recording" ||
    transcription.state === "finalizing";

  // Screen wake lock — held for the entire voice-conversation window:
  // mic recording, mic paused for speech, OR TTS actively playing.
  // Release is debounced (in useDebouncedWakeLock) so the brief idle
  // gap between narration segments doesn't churn request/release —
  // re-requesting outside a user gesture fails on mobile.
  const voiceModeActive = [
    isTranscribing,
    voicePaused,
    speechPlayback.isPlaying,
  ].some(Boolean);
  useDebouncedWakeLock(voiceModeActive);

  // When transcription ends with an error, preserve partial text into the input field.
  // Uses queueMicrotask to avoid synchronous setState within the effect body.
  const prevTranscribingRef = useRef(false);
  useEffect(() => {
    const wasTranscribing = prevTranscribingRef.current;
    prevTranscribingRef.current = isTranscribing;
    if (wasTranscribing && !isTranscribing && transcription.error && transcription.transcript.trim()) {
      const partial = transcription.transcript.trim();
      console.log("[chat] Preserved partial transcript on error:", partial.slice(0, 80));
      queueMicrotask(() => {
        setInput((prev) => (prev ? prev + " " + partial : partial));
      });
    }
  }, [isTranscribing, transcription.error, transcription.transcript, setInput]);

  // Escape key cancels transcription
  useEffect(() => {
    if (!isTranscribing) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        transcription.cancel();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isTranscribing, transcription]);

  const handleCancelTranscription = useCallback(() => {
    turnTakingRef.current = false;
    recordingStop.play();
    transcription.cancel();
  }, [transcription, turnTakingRef]);

  const handleStopSpeech = useCallback(() => {
    speechPlayback.stop();
  }, [speechPlayback]);

  const handleSkipSpeech = useCallback(() => {
    speechPlayback.skip();
  }, [speechPlayback]);

  const handleReplaySpeech = useCallback((replayOpts: ReplaySpeechOptions) => {
    // A manual replay shouldn't fight an in-progress recording: pause the mic
    // the same way auto-played speech does (see queueSpeechBatch).
    if (transcriptionRef.current && transcriptionRef.current.state === "recording") {
      voicePausedRef.current = true;
      setVoicePaused(true);
      transcriptionRef.current.cancel();
    }
    speechPlayback.replay(replayOpts);
  }, [speechPlayback, transcriptionRef, voicePausedRef]);

  const startVoice = useCallback(async () => {
    turnTakingRef.current = true;
    await recordingStart.play().started;
    transcription.start();
  }, [transcription, turnTakingRef]);

  const unpauseVoice = useCallback(() => {
    // Abort speech and resume recording
    speechPlayback.stop();
    voicePausedRef.current = false;
    setVoicePaused(false);
    transcription.start();
  }, [speechPlayback, transcription, voicePausedRef]);

  return {
    speechPlayback,
    transcription,
    isTranscribing,
    voicePaused,
    hqInFlight,
    pendingHqDraft,
    turnTakingRef,
    handleStopSpeech,
    handleSkipSpeech,
    handleReplaySpeech,
    handleCancelTranscription,
    startVoice,
    unpauseVoice,
  };
}
