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
 * with one narrow exception — `submit.audioBlob` carries the recorded
 * segment's `Blob` by reference, the same way `RetentionStore`'s payload
 * (`retention.ts`) and `EmissionFile`'s `path` carry their cargo by
 * reference rather than by value. Audio never serializes across this
 * boundary either way.
 */

import type { ChatImageAttachment } from "../api-chat";
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
      /** The segment's recording, when captured (see `wantAudioBlob`). */
      audioBlob: Blob | null;
      /** "Send and close": after commit, leave the mic closed (no re-arm). */
      closeMic: boolean;
      /** This keyword explicitly requests HQ cleanup, independently of narration mode. */
      hq: boolean;
      /**
       * Realtime words backing `text` at commit time (Track 3, docs/plans/
       * transcript-confidence.md) — fast path: snapshotted at CANCEL; slow
       * path: the machine's `finalWords` read at its idle transition, which
       * lands alongside the parked text. `null` means the service captured
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

interface HqTranscript {
  text: string;
  diarized: boolean;
  service?: string;
}

/**
 * Resolve an optional HQ pass against one frozen keyword-send snapshot. The
 * caller may keep accepting composer input while this awaits: only the values
 * passed here can reach the returned emission. A missing or rejected HQ result
 * deliberately falls back to the realtime text rather than losing the send.
 */
export async function prepareVoiceSubmitEmission(opts: {
  intent: Extract<VoiceIntent, { kind: "submit" }>;
  priorInput: string;
  selectionsSnapshot: readonly SelectionItem[];
  imagesSnapshot: readonly ChatImageAttachment[];
  filesSnapshot: readonly EmissionFile[];
  runHq: boolean;
  transcribe: (audio: Blob) => Promise<HqTranscript | null>;
}): Promise<{ emission: Emission; usedHq: boolean }> {
  const {
    intent, priorInput, selectionsSnapshot, imagesSnapshot, filesSnapshot, runHq, transcribe,
  } = opts;
  let finalText = intent.text;
  let diarized = false;
  let usedHq = false;
  let hqService: string | undefined;

  if (runHq && intent.audioBlob !== null) {
    let hqResult: HqTranscript | null = null;
    try {
      hqResult = await transcribe(intent.audioBlob);
    } catch (_e) {
      // The realtime transcript below is the durable failure fallback.
    }
    if (hqResult !== null) {
      const keyword = detectKeyword(hqResult.text);
      // A manual stop-and-send synthesizes this intent with an empty
      // matchedPhrase (docs/implemented-plans/hq-dictation-switch.md, chunk 2) — nothing
      // was spoken to match, so there's no trigger phrase to restore as a
      // tag if the HQ pass doesn't literally reproduce it. Only a real
      // keyword-fire (non-empty matchedPhrase) gets the fallback tag.
      finalText = keyword
        ? keyword.processedTranscript
        : intent.matchedPhrase === ""
          ? hqResult.text
          : appendSendKeywordTag(hqResult.text, {
            action: intent.closeMic ? "sendClose" : "send",
            matchedPhrase: intent.matchedPhrase,
          });
      diarized = hqResult.diarized;
      hqService = hqResult.service;
      usedHq = true;
    }
  }

  return {
    emission: buildVoiceSubmitEmission({
      priorInput, finalText, selectionsSnapshot, imagesSnapshot, filesSnapshot, diarized,
      // The HQ pass replaced the realtime text: those words describe
      // discarded audio content, so drop the entries and `stt` entirely
      // (Track 3 HQ-drop rule). A fallback to realtime text (!usedHq)
      // attaches the intent's words like any other realtime send.
      words: usedHq ? undefined : intent.words,
      // `stt="hq"` (docs/implemented-plans/hq-dictation-switch.md) stamps only when the
      // HQ pass actually ran and produced text — never on a fallback.
      hqText: usedHq ? true : undefined,
      hqService: usedHq ? hqService : undefined,
    }),
    usedHq,
  };
}
