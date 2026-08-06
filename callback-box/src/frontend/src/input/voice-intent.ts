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
import { joinTranscript } from "../components/chat/InteractiveChat-helpers";
import { appendSendKeywordTag, detectKeyword } from "../lib/audio/speech-keywords";
import { createVoiceEmission, type Emission, type EmissionFile } from "./emission";

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
}): Emission {
  const full = joinTranscript(opts.priorInput, opts.finalText);
  return createVoiceEmission({
    text: full,
    images: opts.imagesSnapshot,
    files: opts.filesSnapshot,
    selections: opts.selectionsSnapshot,
    diarized: opts.diarized,
  });
}

interface HqTranscript {
  text: string;
  diarized: boolean;
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

  if (runHq && intent.audioBlob !== null) {
    let hqResult: HqTranscript | null = null;
    try {
      hqResult = await transcribe(intent.audioBlob);
    } catch (_e) {
      // The realtime transcript below is the durable failure fallback.
    }
    if (hqResult !== null) {
      const keyword = detectKeyword(hqResult.text);
      finalText = keyword
        ? keyword.processedTranscript
        : appendSendKeywordTag(hqResult.text, {
          action: intent.closeMic ? "sendClose" : "send",
          matchedPhrase: intent.matchedPhrase,
        });
      diarized = hqResult.diarized;
      usedHq = true;
    }
  }

  return {
    emission: buildVoiceSubmitEmission({
      priorInput, finalText, selectionsSnapshot, imagesSnapshot, filesSnapshot, diarized,
    }),
    usedHq,
  };
}
