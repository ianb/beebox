/**
 * Deterministic capture-timeline assembly — build a capture-session card's
 * transcript body by interleaving transcribed words and photos in absolute-time
 * order, with `{% silence %}` markers for gaps and `{% image %}` markers where
 * a photo was taken.
 *
 * Relocated from `src/core/commands/assemble-timeline-helpers.ts` for the
 * preparation worker (Track 3). Two differences from the original:
 * - No `allImagesAnalyzed` / `allAudioTranscribed` gate. This plan drops the
 *   describe-images pass, and audio may be left untranscribed on a provider
 *   outage, so we assemble whatever is present rather than refusing.
 * - Operates on a single capture card path (not an inbox scan) and takes no
 *   command context — warnings go to `console.warn`.
 *
 * The paragraph grouping, silence threshold, and marker syntax are preserved
 * exactly (covered by the capture fixtures).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { splitCardContent } from "../../cards/index.js";
import { cardFields, parseCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { type ImageFields, ImageSchema } from "../../schemas/image.js";
import { type AudioFields, AudioSchema } from "../../schemas/audio.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { errnoCode } from "../../lib/error-guards.js";

async function readImageCard(cardPath: string): Promise<ImageFields | null> {
  try {
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = parseCardText(content, { source: cardPath, schemas: await createCardSchemaMap() });
    return cardFields(parsed, ImageSchema);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Failed to read image card ${cardPath}, treating as unavailable:`, e);
    }
    return null;
  }
}

async function readAudioCard(cardPath: string): Promise<AudioFields | null> {
  try {
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = parseCardText(content, { source: cardPath, schemas: await createCardSchemaMap() });
    return cardFields(parsed, AudioSchema);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Failed to read audio card ${cardPath}, treating as unavailable:`, e);
    }
    return null;
  }
}

interface TimedWord {
  word: string;
  absoluteStart: number; // ms since epoch
  absoluteEnd: number;
}

interface TimedImage {
  ref: string; // session-scope ref to the image card (e.g. attach/photo-001.image.card)
  absoluteTime: number; // ms since epoch
}

/** A clip present in the session but left untranscribed (provider outage). */
interface UntranscribedClip {
  absoluteTime: number; // ms since epoch (segment start)
  label: string; // e.g. "audio clip 2"
}

type TimelineEvent =
  | { type: "word"; word: TimedWord }
  | { type: "image"; image: TimedImage }
  | { type: "untranscribed"; clip: UntranscribedClip };

const SILENCE_THRESHOLD_MS = 10_000;

/** Human label for an audio card ("audio-002.audio.card" → "audio clip 2"). */
function clipLabel(ac: string): string {
  const match = /audio-0*(\d+)\.audio\.card$/.exec(ac);
  return match ? `audio clip ${match[1]}` : ac.replace(/\.audio\.card$/, "");
}

/**
 * The timing outcome for one audio card: its transcribed words, or a marker
 * that it exists but was left untranscribed, or unavailable (unreadable card).
 */
type ClipTiming =
  | { kind: "words"; words: TimedWord[] }
  | { kind: "untranscribed"; clip: UntranscribedClip }
  | { kind: "unavailable" };

/** Load the timing for a single audio card. */
async function loadClipTiming(sessionAttachDir: string, ac: string): Promise<ClipTiming> {
  const audioCardPath = path.join(sessionAttachDir, ac);
  const acFields = await readAudioCard(audioCardPath);
  if (!acFields) return { kind: "unavailable" };
  const recordedMs = new Date(acFields.filename.recorded).getTime();

  const audioBasename = ac.replace(/\.audio\.card$/, "");
  const timingPath = path.join(attachDirFor(audioCardPath), `${audioBasename}.timing.json`);
  let timingData: { words: Array<{ word: string; start: number; end: number }> };
  try {
    timingData = JSON.parse(await fs.readFile(timingPath, "utf-8"));
  } catch (e) {
    // No timing sidecar — an untranscribed clip (provider outage). Emit a
    // visible marker at the clip's start rather than silently dropping it.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not load timing data ${timingPath} for ${ac}:`, e);
    }
    return { kind: "untranscribed", clip: { absoluteTime: recordedMs, label: clipLabel(ac) } };
  }

  return {
    kind: "words",
    words: timingData.words.map((w) => ({
      word: w.word,
      absoluteStart: recordedMs + w.start * 1000,
      absoluteEnd: recordedMs + w.end * 1000,
    })),
  };
}

/** Collect timed words + untranscribed-clip markers across all audio cards. */
async function collectAudioTiming(
  sessionAttachDir: string,
  audioCards: string[],
): Promise<{ words: TimedWord[]; untranscribed: UntranscribedClip[] }> {
  const words: TimedWord[] = [];
  const untranscribed: UntranscribedClip[] = [];
  for (const ac of audioCards) {
    const timing = await loadClipTiming(sessionAttachDir, ac);
    if (timing.kind === "words") words.push(...timing.words);
    else if (timing.kind === "untranscribed") untranscribed.push(timing.clip);
  }
  return { words, untranscribed };
}

/** Collect timed images across all (non-invalid) image cards in the session. */
async function collectTimedImages(sessionAttachDir: string, imageCards: string[]): Promise<TimedImage[]> {
  const allImages: TimedImage[] = [];
  for (const ic of imageCards) {
    const icFields = await readImageCard(path.join(sessionAttachDir, ic));
    if (!icFields) continue;
    if (icFields.status === "invalid") continue;
    allImages.push({
      ref: `attach/${ic}`,
      absoluteTime: new Date(icFields.filename.captured).getTime(),
    });
  }
  return allImages;
}

/** Absolute time (ms) an event is anchored at, for sorting. */
function eventTime(e: TimelineEvent): number {
  switch (e.type) {
    case "word":
      return e.word.absoluteStart;
    case "image":
      return e.image.absoluteTime;
    case "untranscribed":
      return e.clip.absoluteTime;
  }
}

/** Merge words, images, and untranscribed markers into one time-sorted timeline. */
function mergeTimelineEvents(input: {
  words: TimedWord[];
  images: TimedImage[];
  untranscribed: UntranscribedClip[];
}): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...input.words.map((w): TimelineEvent => ({ type: "word", word: w })),
    ...input.images.map((img): TimelineEvent => ({ type: "image", image: img })),
    ...input.untranscribed.map((clip): TimelineEvent => ({ type: "untranscribed", clip })),
  ];
  events.sort((a, b) => eventTime(a) - eventTime(b));
  return events;
}

/**
 * Build the transcript markdown body: text runs as paragraphs, gaps as
 * `{% silence %}` block tags, and photos as `{% image %}` block tags. Blocks
 * are blank-line separated so the Markdoc tags parse as block-level.
 */
function buildTranscriptMarkdown(events: TimelineEvent[], allImages: TimedImage[]): string {
  const parts: string[] = [];
  let currentWords: string[] = [];
  let lastWordEnd = 0;

  function flushText(): void {
    if (currentWords.length > 0) {
      parts.push(currentWords.join(" "));
      currentWords = [];
    }
  }

  for (const event of events) {
    switch (event.type) {
      case "word": {
        const w = event.word;
        if (lastWordEnd > 0 && w.absoluteStart - lastWordEnd > SILENCE_THRESHOLD_MS) {
          flushText();
          const gapSeconds = Math.round((w.absoluteStart - lastWordEnd) / 1000);
          parts.push(`{% silence duration="${gapSeconds}s" /%}`);
        }
        currentWords.push(w.word);
        lastWordEnd = w.absoluteEnd;
        break;
      }
      case "image":
        flushText();
        parts.push(`{% image ref="${event.image.ref}" /%}`);
        break;
      case "untranscribed":
        flushText();
        parts.push(`[${event.clip.label} not transcribed]`);
        break;
    }
  }

  flushText();

  // Images-only (or empty) session: list the photos in order.
  if (parts.length === 0 && allImages.length > 0) {
    for (const img of allImages) parts.push(`{% image ref="${img.ref}" /%}`);
  }

  return parts.join("\n\n");
}

/**
 * Assemble the timeline for a single capture-session card and write it into the
 * card body. Idempotent: a card whose body is already non-empty is left
 * untouched (returns false). Returns true when a body was written.
 */
export async function assembleCaptureTimeline(opts: { captureCardPath: string }): Promise<boolean> {
  const { captureCardPath } = opts;
  const sessionAttachDir = attachDirFor(captureCardPath);

  const attachFiles = await fs.readdir(sessionAttachDir);
  const content = await fs.readFile(captureCardPath, "utf-8");
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return false;
  // A non-empty body means the transcript is already assembled (idempotent).
  if (split.body.trim().length > 0) return false;

  const audioCards = attachFiles.filter((f) => f.endsWith(".audio.card"));
  const imageCards = attachFiles.filter((f) => f.endsWith(".image.card"));

  const { words: allWords, untranscribed } = await collectAudioTiming(sessionAttachDir, audioCards);
  const allImages = await collectTimedImages(sessionAttachDir, imageCards);
  const events = mergeTimelineEvents({ words: allWords, images: allImages, untranscribed });
  const transcript = buildTranscriptMarkdown(events, allImages);

  await fs.writeFile(captureCardPath, `---\n${split.frontmatterText}\n---\n${transcript}\n`, "utf-8");
  return true;
}
