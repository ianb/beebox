/**
 * VoiceIntent — the four spoken commands the realtime-transcription
 * keyword spotter recognizes (docs/implemented-plans/input-extraction.md, chunk 5;
 * vocabulary locked in as `submit | cancel | mic-off | erase`). The feeder
 * (`useRealtimeTranscription`) emits these through one `onVoiceIntent`
 * handler instead of four separate callbacks; the input side
 * (`InteractiveChat-voice.ts`) switches on `kind` and maps each intent to
 * its action — `submit` through `buildVoiceSubmitEmission` below, the rest
 * as they always were (cancel/mic-off/erase never built a payload).
 *
 * Serializable-boundary rule (input/ convention): no React or DOM types,
 * with one narrow exception — `submit.recording` carries the segment's
 * staged recording as a live handle (`PendingRecording`: its id plus the
 * seal/discard obligation), by reference. The audio itself is on the box
 * (`docs/plans/resilient-voice-recording.md`), never in this shape.
 */

import type { ChatImageAttachment } from "../api-chat";
import type { PendingRecording } from "../lib/audio/voice-stager";
import type { HqWaitOutcome } from "../lib/audio/hq-wait";
import type { SelectionItem } from "../lib/selection/serialize";
import type { FinalWord } from "../machines/transcription-events";
import { joinTranscript, spokenTextStart } from "../components/chat/InteractiveChat-helpers";
import { appendSendKeywordTag, detectKeyword } from "../lib/audio/speech-keywords";
import { createVoiceEmission, type Emission, type EmissionFile } from "./emission";
import { resolveEmissionWords } from "./unsure-words";

export type VoiceIntent =
  | {
      kind: "submit";
      /** Realtime-pass transcript at keyword-fire time (before any HQ pass). */
      text: string;
      /** Trigger phrase the realtime pass matched (e.g. "send message"). */
      matchedPhrase: string;
      /**
       * The segment's staged recording, or null when no segment went live
       * (a send tapped before the mic started). The receiver owes it exactly
       * one `seal` — with an HQ request when this message wants HQ — or
       * `discard`; an unsealed recording is never transcribed and waits on
       * the box for garbage collection.
       */
      recording: PendingRecording | null;
      /** "Send and close": after commit, leave the mic closed (no re-arm). */
      closeMic: boolean;
      /** This keyword explicitly requests HQ cleanup, independently of narration mode. */
      hq: boolean;
      /**
       * Realtime words backing `text` at commit time (Track 3, docs/plans/
       * transcript-confidence.md) — the machine's `finalWords` read at its
       * idle transition, which lands alongside the parked text. `null` means the service captured
       * no confidence data (Voxtral/OpenAI realtime, or nothing finalized —
       * Fix A); the HQ-drop decision (words describe discarded text) is the
       * consumer's job, not this shape's.
       */
      words: readonly FinalWord[] | null;
    }
  | { kind: "cancel" }
  | { kind: "mic-off" }
  | { kind: "erase" };

/**
 * Pure freeze-boundary mapping: a "submit" intent's final committed text
 * (after any HQ pass rewrites it) plus the composer context frozen at
 * keyword-fire time (`priorInput`, `selectionsSnapshot`, and the pending
 * image/file attachments) becomes the voice Emission. Composer state added
 * after the freeze never reaches this function — the caller snapshots and
 * clears it before the HQ round-trip starts, so it lands in the NEXT
 * emission instead. This is the one piece of `runKeywordSend`'s submit
 * logic that's pure enough to doctest headlessly (see
 * `test/frontend/voice-intent.doctest.md`).
 */
export function buildVoiceSubmitEmission(opts: {
  priorInput: string;
  finalText: string;
  selectionsSnapshot: readonly SelectionItem[];
  imagesSnapshot: readonly ChatImageAttachment[];
  filesSnapshot: readonly EmissionFile[];
  diarized: boolean;
  /**
   * Realtime words backing `finalText`, or absent/`null`/`undefined` when
   * no confidence data applies to the text being sent (HQ replaced it —
   * Track 3's HQ-drop rule; or the service never captured any — Fix A).
   * Resolved through `resolveEmissionWords` before landing on the
   * emission; the assembler does the `<unsure>` marking against the sent
   * body, since the body isn't final until selections/attachments fold in.
   */
  words?: readonly FinalWord[] | null;
  /** See `Emission.hqText` — set when this text came from an HQ pass. */
  hqText?: true;
  /** See `Emission.hqService`. */
  hqService?: string;
}): Emission {
  const full = joinTranscript(opts.priorInput, opts.finalText);
  return createVoiceEmission({
    text: full,
    images: opts.imagesSnapshot,
    files: opts.filesSnapshot,
    selections: opts.selectionsSnapshot,
    diarized: opts.diarized,
    words: resolveEmissionWords(opts.words),
    spokenStart: spokenTextStart(opts.priorInput),
    hqText: opts.hqText,
    hqService: opts.hqService,
  });
}

/** Body of a voice message whose recording produced neither live text nor an HQ transcript. */
export const UNTRANSCRIBED_PLACEHOLDER = "[recording not transcribed]";

/** The send keyword a voice message ended with, re-applied to its HQ text. */
export interface VoiceSendKeyword {
  action: "send" | "sendClose";
  matchedPhrase: string;
}

/**
 * The keyword to restore on a submit's HQ text. A manual stop-and-send
 * synthesizes the intent with an empty `matchedPhrase`
 * (docs/implemented-plans/hq-dictation-switch.md, chunk 2): nothing was
 * spoken to match, so there is no trigger phrase to restore.
 */
export function sendKeywordOf(intent: Extract<VoiceIntent, { kind: "submit" }>): VoiceSendKeyword | null {
  if (intent.matchedPhrase === "") return null;
  return { action: intent.closeMic ? "sendClose" : "send", matchedPhrase: intent.matchedPhrase };
}

/**
 * The emission a voice send finally dispatches, from the realtime emission
 * staged when its segment ended and the outcome of its HQ wait
 * (docs/plans/resilient-voice-recording.md, Track 4). The id and the frozen
 * composer context (typed prefix, selections, attachments) never change;
 * composer input added during the wait belongs to the next message.
 *
 * - `hq`: the HQ text replaces the spoken part, with the send keyword
 *   restored when the HQ pass did not reproduce it. The realtime words are
 *   dropped — they describe replaced text (Track 3 HQ-drop rule).
 * - `fallback`: the realtime text, marked `hq="failed"` — the budget ran
 *   out, the user chose to send it, or the HQ pass failed outright. A
 *   segment with no live text at all sends {@link UNTRANSCRIBED_PLACEHOLDER},
 *   so the message exists and its kept recording stays retranscribable.
 */
export function prepareVoiceSubmitEmission(opts: {
  realtime: Emission;
  outcome: HqWaitOutcome;
  keyword: VoiceSendKeyword | null;
}): Emission {
  const { realtime, outcome, keyword } = opts;
  const spokenStart = realtime.spokenStart ?? 0;
  const priorInput = realtime.text.slice(0, spokenStart).trim();
  if (outcome.kind === "hq") {
    const { result } = outcome;
    const detected = detectKeyword(result.text);
    const finalText = detected
      ? detected.processedTranscript
      : keyword === null ? result.text : appendSendKeywordTag(result.text, keyword);
    const hq = buildVoiceSubmitEmission({
      priorInput, finalText, selectionsSnapshot: realtime.selections, imagesSnapshot: realtime.images,
      filesSnapshot: realtime.files, diarized: result.diarized, hqText: true, hqService: result.service,
    });
    return { ...hq, id: realtime.id };
  }
  const hqFallback = true;
  if (realtime.text.slice(spokenStart).trim() !== "") return { ...realtime, hqFallback };
  return { ...realtime, text: joinTranscript(priorInput, UNTRANSCRIBED_PLACEHOLDER), words: undefined, hqFallback };
}
