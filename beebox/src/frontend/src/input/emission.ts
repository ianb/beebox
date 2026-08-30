/**
 * The Emission — the message-being-composed as a value
 * (docs/plans/input-widget.md; implementation plan
 * docs/implemented-plans/input-extraction.md, chunk 1).
 *
 * One serializable noun bundling everything the input accumulates: text,
 * images, file references, selections, and voice metadata. Every send site
 * builds one of these and hands it to the target adapter, which assembles
 * the wire payload (see targets/chat-assemble.ts) — the emission itself
 * never contains payload markup.
 *
 * Serializable-boundary rule (the native-embodiment constraint from the
 * design doc): nothing in this module may reference React or DOM types;
 * binary content crosses as base64 or by reference (file paths, retention
 * keys), never as live objects.
 */

import type { ChatImageAttachment } from "../api-chat";
import type { SelectionItem } from "../lib/selection/serialize";
import type { ImageItem, FileItem } from "./emission-store";
import type { FinalWord } from "../machines/transcription-events";
import { newMessageId } from "../components/chat/InteractiveChat-helpers";

/**
 * A file attachment as the emission carries it: the upload already
 * happened (the path is a box-relative `tmp/…` reference); `id` pairs the
 * entry with its `[fileN]` token in the text.
 */
export interface EmissionFile {
  id: number;
  path: string;
  originalName?: string;
  size?: number;
  mimetype?: string;
}

/**
 * The message being composed, as an immutable value. `id` is minted at
 * creation and becomes the wire `messageId` — the backend's dedup key and
 * (from chunk 5) the audio-retention key.
 */
export interface Emission {
  readonly id: string;
  readonly origin: "typed" | "voice";
  readonly text: string;
  readonly images: readonly ChatImageAttachment[];
  readonly files: readonly EmissionFile[];
  readonly selections: readonly SelectionItem[];
  /** Voice metadata: the HQ transcription reported speaker diarization. */
  readonly diarized: boolean;
  /**
   * Realtime words backing `text`, with confidence (Track 3, docs/plans/
   * transcript-confidence.md). `undefined` means no per-word confidence
   * data was captured for this text (typed origin, a non-Deepgram service,
   * or an HQ pass that replaced the realtime words) — the assembler stamps
   * `stt="deepgram"` and marks `<unsure>` words in the body only when this
   * is defined (an empty array still stamps `stt`, just marks nothing).
   * Only a voice-origin emission ever sets this.
   */
  readonly words?: readonly FinalWord[];
  /**
   * Char offset in `text` where the spoken portion begins (Track 3 review
   * Fix B) — text before it is a typed composer prefix the words stream
   * never describes, and the assembler's `<unsure>` marking must never wrap
   * anything there. Default 0 (the whole text is spoken); only meaningful
   * when `words` is defined.
   */
  readonly spokenStart?: number;
  /**
   * Set when the committed text came from an HQ transcription pass — the
   * always-HQ switch, narration mode, or an explicit "send HQ" keyword
   * (docs/implemented-plans/hq-dictation-switch.md). The assembler stamps `stt="hq"` for
   * it; mutually exclusive with `words` (an HQ pass always drops the
   * realtime words it replaced — the pre-existing HQ-drop rule — so a
   * message is never both `stt="hq"` and `stt="deepgram"`). A minimal typed
   * bit rather than a string: nothing downstream needs to know which HQ
   * backend ran, only that retranscription has nothing to add.
   */
  readonly hqText?: true;
  /** Server-resolved HQ backend; present only with `hqText`. */
  readonly hqService?: string;
}

/**
 * Snapshot the draft store's pending attachments into emission shape — the
 * one mapping from draft items (which carry preview metadata like object
 * URLs) to the wire payloads an emission carries. Every live-composer send
 * path (typed send, stop-and-send, keyword send) goes through this.
 */
export function draftAttachments(draft: { images: ImageItem[]; files: FileItem[] }): {
  images: ChatImageAttachment[];
  files: EmissionFile[];
} {
  return {
    images: draft.images.map((a) => ({ id: a.id, mimeType: a.mimeType, dataBase64: a.dataBase64 })),
    files: draft.files.map((f) => ({
      id: f.id,
      path: f.path,
      originalName: f.originalName,
      size: f.size,
      mimetype: f.mimetype,
    })),
  };
}

interface TypedEmissionInput {
  text: string;
  images: readonly ChatImageAttachment[];
  files: readonly EmissionFile[];
  selections: readonly SelectionItem[];
}

/** A typed-composer emission (the desktop/mobile textarea send). */
export function createTypedEmission(input: TypedEmissionInput): Emission {
  return {
    id: newMessageId(),
    origin: "typed",
    text: input.text,
    images: input.images,
    files: input.files,
    selections: input.selections,
    diarized: false,
  };
}

interface VoiceEmissionInput {
  text: string;
  images?: readonly ChatImageAttachment[];
  files?: readonly EmissionFile[];
  selections: readonly SelectionItem[];
  diarized: boolean;
  /** See `Emission.words` — omit for "no data captured". */
  words?: readonly FinalWord[];
  /** See `Emission.spokenStart`. */
  spokenStart?: number;
  /** See `Emission.hqText`. */
  hqText?: true;
  /** See `Emission.hqService`. */
  hqService?: string;
}

/**
 * A voice emission (keyword send, the stop-and-send buttons, recovered
 * dictation). Live-composer voice sends sweep pending images and files in
 * (same alignment as selections); recovered dictation omits them — no live
 * composer state exists in that case.
 */
export function createVoiceEmission(input: VoiceEmissionInput): Emission {
  return {
    id: newMessageId(),
    origin: "voice",
    text: input.text,
    images: input.images ?? [],
    files: input.files ?? [],
    selections: input.selections,
    diarized: input.diarized,
    words: input.words,
    spokenStart: input.spokenStart,
    hqText: input.hqText,
    hqService: input.hqService,
  };
}
