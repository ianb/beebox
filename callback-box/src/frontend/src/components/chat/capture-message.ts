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
 * This turns that string back into the chip model the transcript renders. Kept
 * import-free (no React, no view-url) so it doctests against the exact wrapper
 * string, and so `message-parsing`/`user-message` can consume it without a cycle.
 */

/** The parsed shape a capture chip renders from. */
export interface CaptureChipModel {
  /** Box-relative path of the capture-session card (`doc=`). */
  doc: string;
  /** Number of photos in the capture. */
  images: number;
  /** Audio duration label, `M:SS` (empty string when the capture had no audio > 0). */
  audio: string;
  /** The one-line summary (wrapper body). */
  summary: string;
  /** The capture cut off unexpectedly (browser crash / abandonment sweep). */
  partial: boolean;
  /** Transcription failed at preparation; audio is present but untranscribed. */
  transcriptionFailed: boolean;
}

const CAPTURE_RE = /<capture\b([^>]*)>([\S\s]*?)<\/capture>/i;

const DOC_RE = /\bdoc="([^"]*)"/i;
const IMAGES_RE = /\bimages="([^"]*)"/i;
const AUDIO_RE = /\baudio="([^"]*)"/i;
const PARTIAL_RE = /\bpartial="([^"]*)"/i;
const TRANSCRIPTION_FAILED_RE = /\btranscription-failed="([^"]*)"/i;

function readStringAttr(attrs: string, re: RegExp): string | null {
  const match = re.exec(attrs);
  return match ? match[1] : null;
}

/**
 * Parse a `<capture>` wrapper out of a user message. Returns `null` when the
 * text isn't a capture wrapper (the common case — a normal message), so callers
 * can branch on it. Tolerant of surrounding whitespace, but the ENTIRE trimmed
 * message must be the wrapper: a message with text before or after the block is
 * ordinary prose that happens to mention `<capture>`, not a delivered capture,
 * and rendering it as a chip would swallow the surrounding text. `doc` is
 * required (a wrapper without it isn't a capture we can link).
 */
export function parseCaptureWrapper(text: string): CaptureChipModel | null {
  const trimmed = text.trim();
  const match = CAPTURE_RE.exec(trimmed);
  // Reject unless the wrapper is the whole message (no leading/trailing text).
  if (!match || match[0] !== trimmed) return null;
  const attrs = match[1];
  const doc = readStringAttr(attrs, DOC_RE);
  if (doc === null || doc === "") return null;
  const imagesRaw = readStringAttr(attrs, IMAGES_RE);
  const images = imagesRaw === null ? 0 : Number.parseInt(imagesRaw, 10);
  const audioRaw = readStringAttr(attrs, AUDIO_RE);
  const audio = audioRaw === null || audioRaw === "0:00" ? "" : audioRaw;
  return {
    doc,
    images: Number.isNaN(images) ? 0 : images,
    audio,
    summary: match[2].trim(),
    partial: readStringAttr(attrs, PARTIAL_RE) === "1",
    transcriptionFailed: readStringAttr(attrs, TRANSCRIPTION_FAILED_RE) === "1",
  };
}

/**
 * The chip's one-line label, e.g. "Capture — 3 photos, 4:10 audio". Pure so it
 * doctests; the chip component adds the icon and the summary line around it.
 */
export function captureChipLabel(model: CaptureChipModel): string {
  const parts: string[] = [];
  if (model.images > 0) parts.push(`${String(model.images)} photo${model.images === 1 ? "" : "s"}`);
  if (model.audio !== "") parts.push(`${model.audio} audio`);
  if (parts.length === 0) parts.push("capture");
  return `Capture — ${parts.join(", ")}`;
}
