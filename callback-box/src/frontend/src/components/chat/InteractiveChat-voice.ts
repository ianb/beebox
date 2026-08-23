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
import { useMachine } from "@xstate/react";
import { composerMachine, type ComposerEvent } from "../../machines/composerMachine";
import { postAudioForHqTranscription } from "../../api";
import { retainVoiceAudio, markVoiceAudioAbsent } from "../../lib/audio/last-audio";
import { sendSound, tick, recordingStop } from "../../lib/audio/earcons";
import { joinTranscript } from "./InteractiveChat-helpers";
import { draftAttachments, type Emission } from "../../input/emission";
import type { EmissionStore } from "../../input/emission-store";
import {
  buildVoiceSubmitEmission, prepareVoiceSubmitEmission, type VoiceIntent,
} from "../../input/voice-intent";
import { useSpeechDispatch } from "./InteractiveChat-speech";
import { type SelectionItem } from "../../lib/selection/serialize";
import type { SpeechSegment } from "../../lib/audio/speech-parsing";
import type { ReplaySpeechOptions } from "./ChatMessages";
import type { InputStore } from "./input-store";

interface SnapshotLike {
  // Flat machine → plain state-name string (see useSpeechDispatch's SnapshotLike).
  value: string;
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
 * either restart the mic so the user can keep talking (plain `send`) or close it
 * and leave it closed (`closeMic`, the "send and close" sign-off). Narration
 * mode and the explicit cleanup keyword run a high-quality transcription pass
 * before sending; the `hq` region of the composer machine carries the
 * in-flight + pending-draft state for the UI.
 * Module-level so the hook body stays under the per-function line budget.
 */
function runKeywordSend(opts: {
  /** The realtime keyword spotter's "submit" intent (docs/implemented-plans/input-extraction.md, chunk 5). */
  intent: Extract<VoiceIntent, { kind: "submit" }>;
  transcription: { start: () => void };
  stopTickRef: React.MutableRefObject<(() => void) | null>;
  composerSend: (event: ComposerEvent) => void;
  sessionId: string | null;
  narrationEnabledRef: React.MutableRefObject<boolean>;
  /** docs/plans/hq-dictation-switch.md, chunk 1 — read at fire time, same pattern as narrationEnabledRef. */
  hqDictationEnabledRef: React.MutableRefObject<boolean>;
  selectionsRef: React.MutableRefObject<SelectionItem[]>;
  resetSelections: () => void;
  /** Pending images/files are read at fire time (`get()`), like the text store. */
  emissionStore: EmissionStore;
  resetAttachments: () => void;
  dispatchEmission: (emission: Emission) => void;
  clearDraftRef: React.MutableRefObject<() => void>;
  /** Composer text store; the latest text is prepended at fire time so it isn't dropped. */
  inputStore: InputStore;
}) {
  const { intent, transcription, stopTickRef, composerSend, sessionId, narrationEnabledRef, hqDictationEnabledRef, selectionsRef, resetSelections, emissionStore, resetAttachments, dispatchEmission, clearDraftRef, inputStore } = opts;
  const { text, audioBlob, closeMic } = intent;
  // Restart the mic for a continuous conversation, or — for "send and close" —
  // end dictation (STOP_DICTATION clears turnTaking, suppressing the
  // post-response re-arm too). Called at every exit below.
  const settleMic = () => {
    if (closeMic) composerSend({ type: "STOP_DICTATION" });
    else transcription.start();
  };
  // Any text already in the composer (a prior stopped segment, or typing)
  // continues into this utterance rather than being discarded.
  const priorInput = inputStore.get().trim();
  if (!priorInput && !text.trim()) {
    settleMic();
    return;
  }
  // The prior text is being committed with this utterance — clear it so the
  // next segment doesn't prepend it a second time.
  if (priorInput) inputStore.set("");
  // Snapshot the pending selections at keyword-fire (phase 1) and clear them
  // now: they belong to *this* utterance. The deferred HQ submit reads this
  // frozen snapshot, so selections added during the HQ window go to the next
  // message. Spoken bodies carry no tokens, so the serializer appends them.
  const selectionsSnapshot = selectionsRef.current;
  if (selectionsSnapshot.length > 0) {
    resetSelections();
  }
  // Pending image/file attachments freeze at keyword-fire the same way —
  // they belong to *this* utterance; ones added during the HQ window go to
  // the next message. (They used to be silently dropped from voice sends.)
  const { images: imagesSnapshot, files: filesSnapshot } = draftAttachments(emissionStore.get());
  if (imagesSnapshot.length > 0 || filesSnapshot.length > 0) {
    resetAttachments();
  }
  sendSound.play();
  stopTickRef.current = tick.repeatPlay(1000, 30000);
  const submit = (emission: Emission) => {
    dispatchEmission(emission);
    // Keep the original recording around, keyed by this emission's id, so the
    // agent can fetch it via `cb chat get-last-audio` — retention is
    // per-emission (docs/implemented-plans/input-extraction.md, chunk 5), so nothing
    // ever needs to clear it on a later send. No recording -> an explicit
    // tombstone, so get-last-audio answers none instead of an older message's.
    if (audioBlob) retainVoiceAudio(emission.id, { blob: audioBlob, text: emission.text });
    else markVoiceAudioAbsent(emission.id);
    // The segment is committed — drop any persisted draft so the recovery
    // widget doesn't resurface the text we just sent.
    clearDraftRef.current();
  };
  const runHq = hqDictationEnabledRef.current || narrationEnabledRef.current || intent.hq;
  if (runHq && audioBlob) {
    composerSend({ type: "START_HQ", text: joinTranscript(priorInput, text) });
    void prepareVoiceSubmitEmission({
      intent,
      priorInput,
      selectionsSnapshot,
      imagesSnapshot,
      filesSnapshot,
      runHq,
      transcribe: (blob) => postAudioForHqTranscription(blob, { sessionId }),
    }).then(({ emission, usedHq }) => {
      // Clear the in-flight/pending state before submit so the pending
      // bubble doesn't overlap the real user message about to land.
      composerSend({ type: "HQ_DONE" });
      if (!usedHq) {
        console.warn("[hq-transcribe] unavailable — falling back to realtime");
      }
      submit(emission);
    });
  } else {
    if (runHq) {
      console.warn("[hq-transcribe] HQ requested but no audioBlob — submitting realtime text");
    }
    submit(buildVoiceSubmitEmission({
      priorInput,
      finalText: text,
      selectionsSnapshot,
      imagesSnapshot,
      filesSnapshot,
      diarized: false,
      words: intent.words,
    }));
  }
  settleMic();
}

/**
 * Mirror device + settings state into the composer machine so its guards can
 * read it. Module-level so `useChatVoice` stays under the per-function line
 * budget.
 */
function useComposerMirrors(opts: {
  composerSend: (event: ComposerEvent) => void;
  recording: boolean;
  transcriptNonEmpty: boolean;
  narrationEnabled: boolean;
  muted: boolean;
}) {
  const { composerSend, recording, transcriptNonEmpty, narrationEnabled, muted } = opts;
  useEffect(() => {
    composerSend({ type: "RECORDING", value: recording });
  }, [recording, composerSend]);
  useEffect(() => {
    composerSend({ type: "TRANSCRIPT", nonEmpty: transcriptNonEmpty });
  }, [transcriptNonEmpty, composerSend]);
  useEffect(() => {
    composerSend({ type: "SET_NARRATION", value: narrationEnabled });
  }, [narrationEnabled, composerSend]);
  useEffect(() => {
    composerSend({ type: "SET_MUTE", value: muted });
    // Stop any in-flight speech the moment mute is engaged.
    if (muted) composerSend({ type: "STOP_SPEECH" });
  }, [muted, composerSend]);
}

export function useChatVoice(opts: {
  snapshot: SnapshotLike;
  sessionId: string | null;
  muted: boolean;
  narrationEnabled: boolean;
  /** docs/plans/hq-dictation-switch.md — persistent HQ, independent of narration mode. */
  hqDictationEnabled: boolean;
  selections: SelectionItem[];
  resetSelections: () => void;
  /** Pending images/files sweep into keyword sends (read at fire time, like the text store). */
  emissionStore: EmissionStore;
  resetAttachments: () => void;
  /** Drops the persisted dictation draft once a segment commits (set by the chat). */
  clearDraftRef: React.MutableRefObject<() => void>;
  /** Composer text store, so a voice-keyword send doesn't drop existing text. */
  inputStore: InputStore;
  dispatchEmission: (emission: Emission) => void;
  /** Native shell (§3.2): the app owns the microphone, and the screen (§4.10). */
  nativeComposer: boolean;
}) {
  const { snapshot, sessionId, muted, narrationEnabled, hqDictationEnabled, selections, resetSelections, emissionStore, resetAttachments, clearDraftRef, inputStore, dispatchEmission, nativeComposer } = opts;

  // Live device handles, in a ref the command subscriber reads at emit time
  // (never during render). Effects below keep its fields current.
  const devicesRef = useRef<VoiceDevices>({ transcription: null, speechPlayback: null });
  const [composerSnapshot, composerSend, composerActor] = useMachine(composerMachine, {
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

  // `narrationEnabledRef` is read at keyword-fire time so a mid-session
  // narration toggle takes effect on the next send. Selections likewise read
  // at fire time.
  const narrationEnabledRef = useRef(narrationEnabled);
  useEffect(() => { narrationEnabledRef.current = narrationEnabled; });
  // Same pattern for the always-HQ switch (docs/plans/hq-dictation-switch.md).
  const hqDictationEnabledRef = useRef(hqDictationEnabled);
  useEffect(() => { hqDictationEnabledRef.current = hqDictationEnabled; });
  const selectionsRef = useRef(selections);
  useEffect(() => { selectionsRef.current = selections; });
  // The composer text store is read directly at keyword-fire time (store.get()),
  // so no ref-sync is needed — and the store doesn't re-render this hook.

  const transcription = useRealtimeTranscription({
    // Always capture the segment's audio: narration's HQ pass uses it when
    // enabled, and every voice send caches it for `cb chat get-last-audio`.
    // No latency cost — the actor finalizes the blob synchronously on STOP.
    wantAudioBlob: () => true,
    // One handler for the whole VoiceIntent stream (docs/plans/
    // input-extraction.md, chunk 5) instead of four separate callbacks.
    onVoiceIntent: (intent) => {
      switch (intent.kind) {
        case "submit":
          runKeywordSend({
            intent, transcription, stopTickRef, composerSend, sessionId,
            narrationEnabledRef, hqDictationEnabledRef, selectionsRef, resetSelections, emissionStore, resetAttachments,
            dispatchEmission, clearDraftRef, inputStore,
          });
          break;
        case "cancel":
          transcription.cancel();
          // "Cancel the message" discards the whole in-progress message, not
          // just the live segment: prior utterances may already sit in the
          // composer input, and the dictation draft holds the persisted copy.
          inputStore.set("");
          clearDraftRef.current();
          break;
        case "mic-off":
          composerSend({ type: "STOP_DICTATION" });
          recordingStop.play();
          break;
        case "erase":
          // The hook clears the machine's live transcript, but "erase the
          // message" / "start over" means the whole accumulated message —
          // composer input (prior utterances folded back or typed) and the
          // persisted dictation draft included.
          inputStore.set("");
          clearDraftRef.current();
          break;
      }
    },
    onUnconsumedTranscript: (text) => {
      // Recording ended without a send or a manual stop (transport death, mic
      // taken away, reconnect window expired, silence/max-duration auto-stop).
      // Fold the words into the composer so they stay visible and editable
      // instead of vanishing when isTranscribing flips false.
      inputStore.set((existing) => joinTranscript(existing, text));
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

  useComposerMirrors({
    composerSend,
    recording: transcription.state === "recording",
    transcriptNonEmpty: transcription.transcript.trim().length > 0,
    narrationEnabled, muted,
  });

  const voicePaused = composerSnapshot.matches({ voice: "pausedForSpeech" });

  // Screen wake lock — held for the whole voice-conversation window: mic
  // recording, mic paused for speech, or TTS actively playing. Release is
  // debounced so the brief idle gap between narration segments doesn't churn.
  //
  // Not under the native composer: there the microphone is native and this hook
  // can only see the speech half of a turn, so it would hold the screen through
  // the box talking and drop it through the listening it cannot observe — the
  // exact shape of the reported bug. Native holds the real iOS idle timer for
  // the whole turn instead (contract §4.10); a second, partial claimant here
  // would only make which mechanism is in force harder to reason about.
  const voiceModeActive = [isTranscribing, voicePaused, speechPlayback.isPlaying].some(Boolean);
  useDebouncedWakeLock(nativeComposer ? false : voiceModeActive);

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
