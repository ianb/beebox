import { captureVoiceSend } from "./conversation/capture-voice-send";
import type { EmissionDispatch } from "./conversation/use-bound-emission";
import type { ComposerEvent } from "../../machines/composerMachine";
import { postAudioForHqTranscription } from "../../api";
import { retainVoiceAudio, markVoiceAudioAbsent } from "../../lib/audio/last-audio";
import { sendSound, tick } from "../../lib/audio/earcons";
import { joinTranscript } from "./InteractiveChat-helpers";
import { type Emission } from "../../input/emission";
import type { EmissionStore } from "../../input/emission-store";
import { buildVoiceSubmitEmission, prepareVoiceSubmitEmission, type VoiceIntent } from "../../input/voice-intent";
import type { SelectionItem } from "../../lib/selection/serialize";
import type { InputStore } from "./input-store";
import { toastError } from "../ui/toast-store";

/**
 * Run the realtime-transcription `onKeywordSend` flow: commit the utterance and
 * either restart the mic so the user can keep talking (plain `send`) or close it
 * and leave it closed (`closeMic`, the "send and close" sign-off). Narration
 * mode and the explicit cleanup keyword run a high-quality transcription pass
 * before sending; the `hq` region of the composer machine carries the
 * in-flight + pending-draft state for the UI.
 * Module-level so the hook body stays under the per-function line budget.
 */
export async function runKeywordSend(opts: {
  /** The realtime keyword spotter's "submit" intent (docs/implemented-plans/input-extraction.md, chunk 5). */
  intent: Extract<VoiceIntent, { kind: "submit" }>;
  transcription: { start: () => void };
  stopTickRef: React.MutableRefObject<(() => void) | null>;
  composerSend: (event: ComposerEvent) => void;
  sessionId: string | null;
  narrationEnabledRef: React.MutableRefObject<boolean>;
  /** docs/implemented-plans/hq-dictation-switch.md, chunk 1 — read at fire time, same pattern as narrationEnabledRef. */
  hqDictationEnabledRef: React.MutableRefObject<boolean>;
  selectionsRef: React.MutableRefObject<SelectionItem[]>;
  resetSelections: () => void;
  /** Pending images/files are read at fire time (`get()`), like the text store. */
  emissionStore: EmissionStore;
  resetAttachments: () => void;
  captureEmissionDispatch: () => EmissionDispatch;
  clearDraftRef: React.MutableRefObject<() => void>;
  /** Composer text store; the latest text is prepended at fire time so it isn't dropped. */
  inputStore: InputStore;
  /** Resolves once no file attachment is still uploading — see the freeze below. */
  awaitPendingUploads: () => Promise<void>;
}): Promise<void> {
  const { intent, transcription, stopTickRef, composerSend, sessionId, narrationEnabledRef, hqDictationEnabledRef, resetSelections, emissionStore, resetAttachments, clearDraftRef, inputStore, awaitPendingUploads } = opts;
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
  let priorInput = inputStore.get().trim();
  if (!priorInput && !text.trim()) {
    settleMic();
    return;
  }
  const captured = await captureVoiceSend({
    capture: opts.captureEmissionDispatch, awaitUploads: awaitPendingUploads,
    readDraft: emissionStore.get,
    preserve: () => inputStore.set(joinTranscript(inputStore.get(), text)),
    refused: (error) => { settleMic(); toastError("Voice text remains in the draft", { cause: error }); },
  });
  if (captured === null) return;
  const dispatchCaptured = captured.dispatch;
  priorInput = captured.draft.text.trim();
  const selectionsSnapshot = captured.draft.selections;
  const { images: imagesSnapshot, files: filesSnapshot } = captured.attachments;
  const prepared = buildVoiceSubmitEmission({ priorInput, finalText: text,
    selectionsSnapshot, imagesSnapshot, filesSnapshot, diarized: false, words: intent.words });
  try { dispatchCaptured.stage(prepared); }
  catch (error) {
    dispatchCaptured.release();
    inputStore.set(prepared.text);
    settleMic();
    toastError("Voice message remains in the draft", { cause: error });
    return;
  }
  inputStore.set("");
  resetSelections();
  if (imagesSnapshot.length > 0 || filesSnapshot.length > 0) {
    resetAttachments();
  }
  sendSound.play();
  stopTickRef.current = tick.repeatPlay(1000, 30000);
  const submit = (finalEmission: Emission) => {
    const emission = { ...finalEmission, id: prepared.id };
    void dispatchCaptured(emission).catch((error: unknown) => {
      dispatchCaptured.release();
      toastError("Voice message kept for recovery", { cause: error });
    });
    // Keep the original recording around, keyed by this emission's id, so the
    // agent can fetch it via `bbx chat get-last-audio` — retention is
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
    }).catch((error: unknown) => {
      dispatchCaptured.release();
      toastError("Voice message kept for recovery", { cause: error });
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
