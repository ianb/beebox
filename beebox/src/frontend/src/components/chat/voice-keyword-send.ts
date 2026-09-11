import { captureVoiceSend } from "./conversation/capture-voice-send";
import type { EmissionDispatch } from "./conversation/use-bound-emission";
import type { ComposerEvent } from "../../machines/composerMachine";
import { markVoiceAudioAbsent } from "../../lib/audio/last-audio";
import { sendSound, tick } from "../../lib/audio/earcons";
import { joinTranscript } from "./InteractiveChat-helpers";
import type { EmissionStore } from "../../input/emission-store";
import { buildVoiceSubmitEmission, type VoiceIntent } from "../../input/voice-intent";
import type { SelectionItem } from "../../lib/selection/serialize";
import type { InputStore } from "./input-store";
import { toastError } from "../ui/toast-store";

/**
 * Run the realtime-transcription "submit" flow: commit the utterance and
 * either restart the mic so the user can keep talking (plain `send`) or close it
 * and leave it closed (`closeMic`, the "send and close" sign-off). The intent
 * carries the segment's staged recording; every exit below seals it exactly
 * once.
 *
 * TEMPORARY BRIDGE (docs/plans/resilient-voice-recording.md, Track 3 → 4):
 * the message always sends the realtime text. When HQ is wanted (narration
 * mode, the HQ dictation switch, or "clean up and send"), the recording is
 * sealed with an HQ request for this message, so the box runs the HQ job —
 * but nothing waits for or applies its result yet. Track 4 adds the bounded
 * wait, the visible fallback and the late correction.
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
  const { text, recording, closeMic } = intent;
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
    // Nothing to send (e.g. a send while live text was paused). The audio
    // stays on the box without HQ; turning it into text is Track 4's wait.
    recording?.seal(null);
    settleMic();
    return;
  }
  const captured = await captureVoiceSend({
    capture: opts.captureEmissionDispatch, awaitUploads: awaitPendingUploads,
    readDraft: emissionStore.get,
    preserve: () => inputStore.set(joinTranscript(inputStore.get(), text)),
    refused: (error) => { settleMic(); toastError("Voice text remains in the draft", { cause: error }); },
  });
  if (captured === null) {
    // The text went back to the draft; there is no message to run HQ for.
    recording?.seal(null);
    return;
  }
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
    recording?.seal(null);
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
  const wantsHq = hqDictationEnabledRef.current || narrationEnabledRef.current || intent.hq;
  if (wantsHq && sessionId === null) {
    // A brand-new chat has no session id to name in the HQ request yet.
    console.warn("[voice-send] HQ wanted, but this chat has no session yet — recording kept without HQ");
  }
  recording?.seal(wantsHq && sessionId !== null ? { emissionId: prepared.id, sessionId } : null);
  void dispatchCaptured(prepared).catch((error: unknown) => {
    dispatchCaptured.release();
    toastError("Voice message kept for recovery", { cause: error });
  });
  // The recording lives on the box now, not in this tab. Until
  // `get-last-audio` reads staged recordings (Track 5), answer "none" for this
  // message rather than an older message's audio.
  markVoiceAudioAbsent(prepared.id);
  // The segment is committed — drop any persisted draft so the recovery
  // widget doesn't resurface the text we just sent.
  clearDraftRef.current();
  settleMic();
}
