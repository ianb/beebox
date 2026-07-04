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

import type { SelectionItem } from "../lib/selection-serialize";
import { joinTranscript } from "../components/chat/InteractiveChat-helpers";
import { createVoiceEmission, type Emission } from "./emission";

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
    }
  | { kind: "cancel" }
  | { kind: "mic-off" }
  | { kind: "erase" };

/**
 * Pure freeze-boundary mapping: a "submit" intent's final committed text
 * (after any HQ pass rewrites it) plus the composer context frozen at
 * keyword-fire time (`priorInput`, `selectionsSnapshot`) becomes the voice
 * Emission. Selections added to the live composer after the freeze never
 * reach this function — the caller snapshots and clears them before the HQ
 * round-trip starts, so they land in the NEXT emission instead. This is the
 * one piece of `runKeywordSend`'s submit logic that's pure enough to
 * doctest headlessly (see `test/frontend/voice-intent.doctest.md`).
 */
export function buildVoiceSubmitEmission(opts: {
  priorInput: string;
  finalText: string;
  selectionsSnapshot: readonly SelectionItem[];
  diarized: boolean;
}): Emission {
  const full = joinTranscript(opts.priorInput, opts.finalText);
  return createVoiceEmission({ text: full, selections: opts.selectionsSnapshot, diarized: opts.diarized });
}
