/**
 * Pure parser for the `<capture …>` chat-message wrapper (Track 4).
 *
 * A delivered capture is a first-class user message whose body is the wrapper
 * built by `core/capture/deliver.ts` `buildCaptureWrapper`:
 *
 *   <capture doc="…/x.capture-session.card" images="3" audio="4:10" partial="1"
 *            transcription-failed="1">
 *   one-line summary
 *   </capture>
 *
 * The shared delivered-user-message codec turns that string into the chip model
 * the transcript renders. This module keeps the capture-specific compatibility
 * parser and label text.
 */

import {
  parseDeliveredUserMessageParts,
  type CaptureUserMessage,
} from "@shared/delivered-user-message";

/** The parsed shape a capture chip renders from. */
export type CaptureChipModel = Omit<CaptureUserMessage, "kind">;

/**
 * Compatibility parser for callers that expect one capture model or `null`.
 * The transcript renderer uses the shared ordered-parts parser so it can retain
 * text around a delivered block. This helper accepts only one capture plus
 * optional surrounding whitespace.
 */
export function parseCaptureWrapper(text: string): CaptureChipModel | null {
  const parts = parseDeliveredUserMessageParts(text)
    .filter((part) => part.kind !== "text" || part.text.trim() !== "");
  const part = parts.length === 1 ? parts.at(0) : undefined;
  if (part?.kind !== "capture") return null;
  return {
    doc: part.doc,
    images: part.images,
    audio: part.audio,
    summary: part.summary,
    partial: part.partial,
    transcriptionFailed: part.transcriptionFailed,
  };
}

/**
 * The chip's one-line label, e.g. "Capture — 3 photos, 4:10 audio". Pure so it
 * doctests; the chip component adds the icon and the summary line around it.
 */
export function captureChipLabel(model: CaptureChipModel): string {
  const parts: string[] = [];
  if (model.images > 0) parts.push(`${String(model.images)} photo${model.images === 1 ? "" : "s"}`);
  if (model.audio !== "0:00") parts.push(`${model.audio} audio`);
  if (parts.length === 0) parts.push("capture");
  return `Capture — ${parts.join(", ")}`;
}
