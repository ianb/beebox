import { captureVoiceSend } from "./conversation/capture-voice-send";
import type { EmissionDispatch } from "./conversation/use-bound-emission";
import type { ComposerEvent } from "../../machines/composerMachine";
import { markVoiceAudioAbsent } from "../../lib/audio/last-audio";
import { sendSound, tick } from "../../lib/audio/earcons";
import { awaitHq } from "../../lib/audio/await-hq";
import { HQ_WAIT_BUDGET_MS, hqStatusLine, type HqWaitOutcome } from "../../lib/audio/hq-wait";
import { recordHqFailureNotice } from "../../lib/audio/hq-failure-notices";
import { pendingChunkCount } from "../../lib/audio/voice-staging-queue";
import { voiceSendSequencer, type VoiceSendSlot } from "../../lib/audio/voice-send-sequencer";
import type { PendingRecording } from "../../lib/audio/voice-stager";
import { joinTranscript } from "./InteractiveChat-helpers";
import type { Emission } from "../../input/emission";
import type { EmissionStore } from "../../input/emission-store";
import { buildVoiceSubmitEmission, prepareVoiceSubmitEmission, sendKeywordOf, type VoiceIntent } from "../../input/voice-intent";
import type { SelectionItem } from "../../lib/selection/serialize";
import type { InputStore } from "./input-store";
import { toastError } from "../ui/toast-store";

export interface RunKeywordSendOpts {
  /** The realtime keyword spotter's "submit" intent (docs/implemented-plans/input-extraction.md, chunk 5). */
  intent: Extract<VoiceIntent, { kind: "submit" }>;
  transcription: { start: () => void };
  stopTickRef: React.MutableRefObject<(() => void) | null>;
  composerSend: (event: ComposerEvent) => void;
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
}

/**
 * Run the realtime-transcription "submit" flow: commit the utterance and
 * either restart the mic so the user can keep talking (plain `send`) or close
 * it (`closeMic`, the "send and close" sign-off). The intent carries the
 * segment's staged recording; every exit below seals it exactly once.
 *
 * With HQ wanted (narration mode, the HQ dictation switch, or "clean up and
 * send"), the recording is sealed with an HQ request and the send waits for
 * the box's HQ job (docs/plans/resilient-voice-recording.md, Track 4): the HQ
 * text if it arrives within the budget, otherwise the live text marked
 * `hq="failed"`. The mic re-arms at once; waits run concurrently and dispatch
 * in segment order.
 */
export async function runKeywordSend(opts: RunKeywordSendOpts): Promise<void> {
  // Reserved before the first await, so dispatch order is segment-end order.
  const slot = voiceSendSequencer.reserve();
  try {
    await sendVoiceSegment(opts, slot);
  } finally {
    slot.release();
  }
}

async function sendVoiceSegment(opts: RunKeywordSendOpts, slot: VoiceSendSlot): Promise<void> {
  const { intent, transcription, stopTickRef, composerSend, narrationEnabledRef, hqDictationEnabledRef, resetSelections, emissionStore, resetAttachments, clearDraftRef, inputStore, awaitPendingUploads } = opts;
  const { text, recording, closeMic } = intent;
  // Restart the mic for a continuous conversation, or — for "send and close" —
  // end dictation (STOP_DICTATION clears turnTaking, suppressing the
  // post-response re-arm too). Called at every exit below.
  const settleMic = () => {
    if (closeMic) composerSend({ type: "STOP_DICTATION" });
    else transcription.start();
  };
  const wantsHq = hqDictationEnabledRef.current || narrationEnabledRef.current || intent.hq;
  // A segment recorded while live text was paused has no text of its own;
  // with HQ wanted it still becomes a message (its text comes from HQ).
  const hqRecording = wantsHq ? recording : null;
  // Any text already in the composer (a prior stopped segment, or typing)
  // continues into this utterance rather than being discarded.
  let priorInput = inputStore.get().trim();
  if (!priorInput && !text.trim() && hqRecording === null) {
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
  const { images: imagesSnapshot, files: filesSnapshot } = captured.attachments;
  const prepared = buildVoiceSubmitEmission({ priorInput, finalText: text, selectionsSnapshot: captured.draft.selections,
    imagesSnapshot, filesSnapshot, diarized: false, words: intent.words });
  try { dispatchCaptured.stage(prepared, hqRecording === null ? {} : { recordingId: hqRecording.recordingId }); }
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
  if (imagesSnapshot.length > 0 || filesSnapshot.length > 0) resetAttachments();
  sendSound.play();
  stopTickRef.current = tick.repeatPlay(1000, 30000);
  // The segment is committed — drop any persisted draft so the recovery
  // widget doesn't resurface the text we just sent.
  clearDraftRef.current();

  if (hqRecording === null) {
    recording?.seal(null);
    settleMic();
    await slot.turn();
    dispatchVoice(dispatchCaptured, prepared);
    return;
  }
  hqRecording.seal({ emissionId: prepared.id, sessionId: dispatchCaptured.currentSessionId() });
  composerSend({ type: "START_HQ", id: prepared.id, text: prepared.text || "Recording without live text" });
  settleMic();
  const outcome = await waitForHq({ recording: hqRecording, emission: prepared, composerSend });
  const final = prepareVoiceSubmitEmission({ realtime: prepared, outcome, keyword: sendKeywordOf(intent) });
  await slot.turn();
  composerSend({ type: "HQ_DONE", id: prepared.id });
  dispatchVoice(dispatchCaptured, final);
  followUpOutcome(outcome);
}

function waitForHq(opts: {
  recording: PendingRecording;
  emission: Emission;
  composerSend: (event: ComposerEvent) => void;
}): Promise<HqWaitOutcome> {
  const { recording, emission, composerSend } = opts;
  return awaitHq({
    recordingId: recording.recordingId,
    emissionId: emission.id,
    budgetMs: HQ_WAIT_BUDGET_MS,
    onProgress: (progress) => composerSend({
      type: "HQ_STATUS",
      id: emission.id,
      status: hqStatusLine(progress, { uploading: pendingChunkCount(recording.recordingId) > 0, now: Date.now() }),
    }),
  });
}

function dispatchVoice(dispatch: EmissionDispatch, emission: Emission): void {
  void dispatch(emission).catch((error: unknown) => {
    dispatch.release();
    toastError("Voice message kept for recovery", { cause: error });
  });
  // The recording lives on the box now, not in this tab. Until
  // `get-last-audio` reads staged recordings (Track 5), answer "none" for
  // this message rather than an older message's audio.
  markVoiceAudioAbsent(emission.id);
}

/** After the send: a permanent HQ failure shows its persistent notice. */
function followUpOutcome(outcome: HqWaitOutcome): void {
  if (outcome.kind !== "fallback" || typeof outcome.reason === "string") return;
  if (outcome.reason.kind === "permanent") recordHqFailureNotice({ service: outcome.service, failure: outcome.reason });
}
