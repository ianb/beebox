/**
 * Voice orchestration for InteractiveChat. Owns the composer machine
 * (`composerMachine`) — the speech ↔ mic coordination overlay — and wires it
 * to the two device hooks it commands: realtime transcription (the mic) and
 * `useSpeechDispatch` (TTS playback off the stream).
 *
 * The machine is the single source of truth for the modal voice state. Its
 * device-command seams (startMic/resumeMic/cancelMic/playSpeech/stopSpeech/
 * markPlayed) are wired here to the live device handles via refs; the handlers
 * and mirror effects below translate user intents and device state into
 * machine events. The old `voicePaused`/`voicePausedRef`/`turnTakingRef`
 * tangle is gone — `voicePaused` is now `voice === "pausedForSpeech"`.
 */

import { useEffect, useRef, useCallback } from "react";
import { useRealtimeTranscription } from "../../hooks/useRealtimeTranscription";
import { useDebouncedWakeLock } from "../../hooks/useWakeLock";
import { useSSRMachine } from "../../hooks/useSSRMachine";
import { composerMachine, type ComposerEvent } from "../../machines/composerMachine";
import { detectKeyword, appendSendKeywordTag } from "../../lib/speech-keywords";
import { postAudioForHqTranscription } from "../../api";
import { sendSound, tick, recordingStop } from "../../lib/earcons";
import { localTime, buildSpeechMessage, joinTranscript } from "./InteractiveChat-helpers";
import { useSpeechDispatch } from "./InteractiveChat-speech";
import { type SelectionItem } from "../../lib/selection-serialize";
import type { SpeechSegment } from "../../lib/speech-parsing";
import type { ReplaySpeechOptions } from "../ChatMessages";

interface SnapshotLike {
  value: unknown;
  context: { streamText: string };
}

/**
 * Live device handles the machine seams command. A plain mutable holder
 * (not a ref) so the `.provide()` closures can capture it without tripping the
 * "no refs during render" rule; effects keep its fields pointed at the current
 * transcription / playback handles.
 */
interface VoiceDevices {
  transcription: { start: (o?: { earcon?: boolean }) => void; cancel: () => void } | null;
  speechPlayback: {
    playSegments: (o: { messageId: string; segments: SpeechSegment[]; baseIndex: number }) => void;
    stop: () => void;
    markAsPlayed: (id: string) => void;
  } | null;
}

/**
 * Run the realtime-transcription `onKeywordSend` flow: commit the utterance and
 * restart the mic so the user can keep talking. Narration mode runs a
 * high-quality transcription pass before sending; the `hq` region of the
 * composer machine carries the in-flight + pending-draft state for the UI.
 * Module-level so the hook body stays under the per-function line budget.
 */
function runKeywordSend(opts: {
  text: string;
  /** Trigger phrase the realtime pass matched (e.g. "send message"). */
  matchedPhrase: string;
  audioBlob: Blob | null;
  transcription: { start: () => void };
  stopTickRef: React.MutableRefObject<(() => void) | null>;
  composerSend: (event: ComposerEvent) => void;
  sessionId: string | null;
  narrationEnabledRef: React.MutableRefObject<boolean>;
  selectionsRef: React.MutableRefObject<SelectionItem[]>;
  resetSelections: () => void;
  doSend: (wrapped: string) => void;
  clearDraftRef: React.MutableRefObject<() => void>;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
  /** Latest composer text at fire time, prepended so it isn't dropped. */
  inputRef: React.MutableRefObject<string>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}) {
  const { text, matchedPhrase, audioBlob, transcription, stopTickRef, composerSend, sessionId, narrationEnabledRef, selectionsRef, resetSelections, doSend, clearDraftRef, zoomedViewAttr, timePassedAttr, inputRef, setInput } = opts;
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
  stopTickRef.current = tick.repeatPlay(1000, 30000);
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
    composerSend({ type: "START_HQ", text: joinTranscript(priorInput, text) });
    void postAudioForHqTranscription(audioBlob, { sessionId })
      .then((hqResult) => {
        // Clear the in-flight/pending state before submit so the pending
        // bubble doesn't overlap the real user message about to land.
        composerSend({ type: "HQ_DONE" });
        if (hqResult === null) {
          console.warn("[hq-transcribe] returned null — falling back to realtime");
          submit(text);
          return;
        }
        // Re-run keyword detection on the HQ text so the agent sees the
        // send-message (or other) keyword as a pill, not plain words.
        // The realtime pass heard the trigger (that's what fired this send),
        // so when HQ normalized it away, re-inject the tag rather than let
        // the trigger silently vanish from the persistent record.
        const keyword = detectKeyword(hqResult.text);
        const hqText = keyword
          ? keyword.processedTranscript
          : appendSendKeywordTag(hqResult.text, matchedPhrase);
        submit(hqText, { diarized: hqResult.diarized });
      })
      .catch(() => { composerSend({ type: "HQ_DONE" }); });
  } else {
    if (narrationEnabledRef.current) {
      console.warn("[hq-transcribe] narration enabled but no audioBlob — submitting realtime text");
    }
    submit(text);
  }
  // Restart recording so the user can keep talking.
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

  // Live device handles, in a ref the command subscriber reads at emit time
  // (never during render). Effects below keep its fields current.
  const devicesRef = useRef<VoiceDevices>({ transcription: null, speechPlayback: null });
  const [composerSnapshot, composerSend, composerActor] = useSSRMachine(composerMachine, {
    input: { narration: narrationEnabled, muted },
  });

  // Execute the device commands the machine emits against the live handles.
  useEffect(() => {
    const sub = composerActor.on("command", ({ command }) => {
      const d = devicesRef.current;
      switch (command.type) {
        case "startMic": d.transcription?.start({ earcon: true }); break;
        case "resumeMic": d.transcription?.start(); break;
        case "cancelMic": d.transcription?.cancel(); break;
        case "stopSpeech": d.speechPlayback?.stop(); break;
        case "playSpeech": d.speechPlayback?.playSegments({ messageId: command.messageId, segments: command.segments, baseIndex: command.baseIndex }); break;
        case "markPlayed": d.speechPlayback?.markAsPlayed(command.messageId); break;
      }
    });
    return () => sub.unsubscribe();
  }, [composerActor]);

  const { speechPlayback, stopTickRef } = useSpeechDispatch({ snapshot, composerSnapshot, composerSend });
  useEffect(() => {
    devicesRef.current.speechPlayback = speechPlayback;
  });

  // `wantAudioBlob` is read at keyword-fire time so a mid-session narration
  // toggle takes effect on the next send. Selections likewise read at fire time.
  const narrationEnabledRef = useRef(narrationEnabled);
  useEffect(() => { narrationEnabledRef.current = narrationEnabled; });
  const selectionsRef = useRef(selections);
  useEffect(() => { selectionsRef.current = selections; });
  // Same pattern for the composer text: read the latest value at keyword-fire
  // time, since the onKeywordSend closure isn't re-read per render.
  const inputRef = useRef(input);
  useEffect(() => { inputRef.current = input; });

  const transcription = useRealtimeTranscription({
    wantAudioBlob: () => narrationEnabledRef.current,
    onKeywordSend: ({ processedTranscript, matchedPhrase, audioBlob }) => runKeywordSend({
      text: processedTranscript, matchedPhrase, audioBlob, transcription, stopTickRef, composerSend, sessionId,
      narrationEnabledRef, selectionsRef, resetSelections, doSend, clearDraftRef, zoomedViewAttr, timePassedAttr, inputRef, setInput,
    }),
    onKeywordCancel: () => {
      transcription.cancel();
      // "Cancel the message" discards the whole in-progress message, not
      // just the live segment: prior utterances may already sit in the
      // composer input, and the dictation draft holds the persisted copy.
      setInput("");
      clearDraftRef.current();
    },
    onKeywordMicOff: () => {
      composerSend({ type: "STOP_DICTATION" });
      recordingStop.play();
    },
    onKeywordErase: () => {
      // The hook clears the machine's live transcript, but "erase the
      // message" / "start over" means the whole accumulated message —
      // composer input (prior utterances folded back or typed) and the
      // persisted dictation draft included.
      setInput("");
      clearDraftRef.current();
    },
    onUnconsumedTranscript: (text) => {
      // Recording ended without a send or a manual stop (transport death, mic
      // taken away, reconnect window expired, silence/max-duration auto-stop).
      // Fold the words into the composer so they stay visible and editable
      // instead of vanishing when isTranscribing flips false.
      setInput((existing) => joinTranscript(existing, text));
      // The text now lives in the composer (persisted as the composer draft),
      // so drop the dictation draft — otherwise it resurfaces after the next
      // reload as a phantom "Recovered dictation" duplicate.
      clearDraftRef.current();
    },
  });
  useEffect(() => {
    devicesRef.current.transcription = transcription;
  });
  const isTranscribing =
    transcription.state === "connecting" ||
    transcription.state === "recording" ||
    transcription.state === "reconnecting" ||
    transcription.state === "finalizing";

  // Mirror device + settings state into the machine so its guards can read it.
  useEffect(() => {
    composerSend({ type: "RECORDING", value: transcription.state === "recording" });
  }, [transcription.state, composerSend]);
  useEffect(() => {
    composerSend({ type: "TRANSCRIPT", nonEmpty: transcription.transcript.trim().length > 0 });
  }, [transcription.transcript, composerSend]);
  useEffect(() => {
    composerSend({ type: "SET_NARRATION", value: narrationEnabled });
  }, [narrationEnabled, composerSend]);
  useEffect(() => {
    composerSend({ type: "SET_MUTE", value: muted });
    // Stop any in-flight speech the moment mute is engaged.
    if (muted) composerSend({ type: "STOP_SPEECH" });
  }, [muted, composerSend]);

  const voicePaused = composerSnapshot.matches({ voice: "pausedForSpeech" });

  // Screen wake lock — held for the whole voice-conversation window: mic
  // recording, mic paused for speech, or TTS actively playing. Release is
  // debounced so the brief idle gap between narration segments doesn't churn.
  const voiceModeActive = [isTranscribing, voicePaused, speechPlayback.isPlaying].some(Boolean);
  useDebouncedWakeLock(voiceModeActive);

  const handleCancelTranscription = useCallback(() => {
    recordingStop.play();
    composerSend({ type: "STOP_DICTATION" });
    transcription.cancel();
    // The user deliberately discarded this dictation — drop the persisted draft
    // so it doesn't resurface later as a phantom "Recovered dictation".
    clearDraftRef.current();
  }, [transcription, composerSend, clearDraftRef]);

  // Escape cancels transcription (same as the Cancel control).
  useEffect(() => {
    if (!isTranscribing) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancelTranscription();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isTranscribing, handleCancelTranscription]);

  // Exposed so the composer's manual stop/edit/send controls can drop the
  // persisted draft once the transcript is safely in the user's hands.
  const clearDraft = useCallback(() => {
    clearDraftRef.current();
  }, [clearDraftRef]);

  const handleStopSpeech = useCallback(() => {
    // The machine hands the mic back if speech was paused for it (the SpeechMenu
    // Stop fix) — see pausedForSpeech's STOP_SPEECH transition.
    composerSend({ type: "STOP_SPEECH" });
  }, [composerSend]);

  const handleSkipSpeech = useCallback(() => {
    speechPlayback.skip();
  }, [speechPlayback]);

  const handleReplaySpeech = useCallback((replayOpts: ReplaySpeechOptions) => {
    // Reflect that speech is now playing (pausing the mic if recording); the
    // replay itself plays, so the machine doesn't re-queue it.
    composerSend({ type: "SPEECH_EXTERNAL" });
    speechPlayback.replay(replayOpts);
  }, [speechPlayback, composerSend]);

  const startVoice = useCallback(() => {
    composerSend({ type: "START_DICTATION" });
  }, [composerSend]);

  const unpauseVoice = useCallback(() => {
    composerSend({ type: "RESUME" });
  }, [composerSend]);

  // End the voice turn without tearing the mic down here — the caller (typed
  // send, or a manual stop control that handles its own transcript) owns that.
  const stopDictation = useCallback(() => {
    composerSend({ type: "STOP_DICTATION" });
  }, [composerSend]);

  const notifySent = useCallback(() => {
    composerSend({ type: "MESSAGE_SENT" });
  }, [composerSend]);

  return {
    speechPlayback,
    transcription,
    isTranscribing,
    voicePaused,
    hqInFlight: composerSnapshot.matches({ hq: "inFlight" }),
    pendingHqDraft: composerSnapshot.context.pendingHqText,
    clearDraft,
    handleStopSpeech,
    handleSkipSpeech,
    handleReplaySpeech,
    handleCancelTranscription,
    startVoice,
    unpauseVoice,
    stopDictation,
    notifySent,
  };
}
