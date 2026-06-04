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
import { sendSound, tick, recordingStop } from "../../lib/earcons";
import { localTime, buildSpeechMessage, joinTranscript } from "./InteractiveChat-helpers";
import { useSpeechDispatch, type VoiceRefs } from "./InteractiveChat-speech";
import { type SelectionItem } from "../../lib/selection-serialize";
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
  selectionsRef: React.MutableRefObject<SelectionItem[]>;
  resetSelections: () => void;
  setHqInFlight: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingHqDraft: React.Dispatch<React.SetStateAction<string | null>>;
  doSend: (wrapped: string) => void;
  clearDraftRef: React.MutableRefObject<() => void>;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
  /** Latest composer text at fire time, prepended so it isn't dropped. */
  inputRef: React.MutableRefObject<string>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}) {
  const { text, audioBlob, transcription, refs, sessionId, narrationEnabledRef, selectionsRef, resetSelections, setHqInFlight, setPendingHqDraft, doSend, clearDraftRef, zoomedViewAttr, timePassedAttr, inputRef, setInput } = opts;
  // Any text already in the composer (a prior stopped segment, or typing)
  // continues into this utterance rather than being discarded.
  const priorInput = inputRef.current.trim();
  if (!priorInput && !text.trim()) {
    transcription.start();
    return;
  }
  // The prior text is being committed with this utterance — clear it so the
  // next segment doesn't prepend it a second time.
  if (priorInput) setInput("");
  // Snapshot the pending selections at keyword-fire (phase 1) and clear them
  // now: they belong to *this* utterance. The deferred HQ submit reads this
  // frozen snapshot, so selections added during the HQ window go to the next
  // message. Spoken bodies carry no tokens, so the serializer appends them.
  const selectionsSnapshot = selectionsRef.current;
  if (selectionsSnapshot.length > 0) {
    resetSelections();
  }
  sendSound.play();
  refs.stopTickRef.current = tick.repeatPlay(1000, 30000);
  // Narration mode swaps in a high-quality transcription before sending
  // to the agent — the realtime text is good enough for the live UI
  // but accuracy matters more for the persistent record.
  const submit = (finalText: string, submitOpts?: { diarized?: boolean }) => {
    const diarized = submitOpts !== undefined && submitOpts.diarized === true;
    const attrs = ` local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}`;
    // The HQ audio (and the realtime text) cover only the spoken segment, so
    // fold the prior composer text back in at submit time.
    const full = joinTranscript(priorInput, finalText);
    doSend(buildSpeechMessage({ text: full, diarized, selections: selectionsSnapshot, attrs }));
    // The segment is committed — drop any persisted draft so the recovery
    // widget doesn't resurface the text we just sent.
    clearDraftRef.current();
  };
  if (narrationEnabledRef.current && audioBlob) {
    setHqInFlight(true);
    setPendingHqDraft(joinTranscript(priorInput, text));
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
  selections: SelectionItem[];
  resetSelections: () => void;
  /** Drops the persisted dictation draft once a segment commits (set by the chat). */
  clearDraftRef: React.MutableRefObject<() => void>;
  /** Current composer text, so a voice-keyword send doesn't drop it. */
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  doSend: (wrapped: string) => void;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
}) {
  const { snapshot, sessionId, muted, narrationEnabled, selections, resetSelections, clearDraftRef, input, setInput, doSend, zoomedViewAttr, timePassedAttr } = opts;

  const [voicePaused, setVoicePaused] = useState(false);
  const { speechPlayback, refs } = useSpeechDispatch({ snapshot, muted, setVoicePaused });
  const { turnTakingRef, transcriptionRef, voicePausedRef } = refs;

  // Realtime transcription with voice keyword spotting. `wantAudioBlob`
  // is a predicate read at keyword-fire time so a mid-session toggle of
  // narration takes effect on the next send.
  const narrationEnabledRef = useRef(narrationEnabled);
  useEffect(() => { narrationEnabledRef.current = narrationEnabled; });
  // Keep the latest selections readable at keyword-fire time (the onKeywordSend
  // closure is captured by the transcription hook, not re-read per render).
  const selectionsRef = useRef(selections);
  useEffect(() => { selectionsRef.current = selections; });
  // Same pattern for the composer text: read the latest value at keyword-fire
  // time, since the onKeywordSend closure isn't re-read per render.
  const inputRef = useRef(input);
  useEffect(() => { inputRef.current = input; });
  const [hqInFlight, setHqInFlight] = useState(false);
  // Realtime transcript shown as a pending user-message bubble while the
  // HQ pass runs. Null when no narration submit is in flight. Driven by
  // the same lifecycle as hqInFlight but carries the text to render.
  const [pendingHqDraft, setPendingHqDraft] = useState<string | null>(null);

  const transcription = useRealtimeTranscription({
    wantAudioBlob: () => narrationEnabledRef.current,
    onKeywordSend: (text, audioBlob) => runKeywordSend({
      text, audioBlob, transcription,
      refs, sessionId, narrationEnabledRef, selectionsRef, resetSelections, setHqInFlight, setPendingHqDraft,
      doSend, clearDraftRef, zoomedViewAttr, timePassedAttr, inputRef, setInput,
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
    transcription.state === "reconnecting" ||
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

  // Partial-transcript loss on an interrupted session (error, screen sleep,
  // reload) is handled by the persisted dictation draft + recovery widget
  // (useDictationDraft), not by autofilling the composer — the draft survives
  // a full reload, which an in-memory composer value wouldn't.

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
    // The user deliberately discarded this dictation — drop the persisted
    // draft too, so it doesn't resurface later as a phantom "Recovered
    // dictation". (The draft only exists to rescue an *interrupted* session.)
    clearDraftRef.current();
  }, [transcription, turnTakingRef, clearDraftRef]);

  // Exposed so the composer's manual stop/edit/send controls can drop the
  // persisted draft once the transcript is safely in the user's hands (moved
  // into the textarea as editable text, or sent). Without this, every manual
  // stop leaks a draft that re-surfaces as a recovered-dictation widget.
  const clearDraft = useCallback(() => {
    clearDraftRef.current();
  }, [clearDraftRef]);

  const handleStopSpeech = useCallback(() => {
    speechPlayback.stop();
    // If the mic was auto-paused for this speech (see queueSpeechBatch in
    // InteractiveChat-speech.ts), stopping the speech should hand recording
    // back — otherwise the user reads "Stop killed my voice input."
    if (voicePausedRef.current) {
      voicePausedRef.current = false;
      setVoicePaused(false);
      transcription.start();
    }
  }, [speechPlayback, transcription, voicePausedRef]);

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

  const startVoice = useCallback(() => {
    turnTakingRef.current = true;
    // The earcon is armed here but plays inside the transcription hook once
    // the mic is truly live — never before the permission dialog settles.
    transcription.start({ earcon: true });
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
    clearDraft,
    handleStopSpeech,
    handleSkipSpeech,
    handleReplaySpeech,
    handleCancelTranscription,
    startVoice,
    unpauseVoice,
  };
}
