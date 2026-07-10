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

async function readImageCard(cardPath: string): Promise<ImageFields | null> {
  try {
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = parseCardText(content, { source: cardPath, schemas: await createCardSchemaMap() });
    return cardFields(parsed, ImageSchema);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
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
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
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

type TimelineEvent = { type: "word"; word: TimedWord } | { type: "image"; image: TimedImage };

const SILENCE_THRESHOLD_MS = 10_000;

/** Load the timing words for a single audio card, or null when unavailable. */
async function loadTimingWords(sessionAttachDir: string, ac: string): Promise<TimedWord[] | null> {
  const audioCardPath = path.join(sessionAttachDir, ac);
  const acFields = await readAudioCard(audioCardPath);
  if (!acFields) return null;
  const recordedMs = new Date(acFields.filename.recorded).getTime();

  const audioBasename = ac.replace(/\.audio\.card$/, "");
  const timingPath = path.join(attachDirFor(audioCardPath), `${audioBasename}.timing.json`);
  let timingData: { words: Array<{ word: string; start: number; end: number }> };
  try {
    timingData = JSON.parse(await fs.readFile(timingPath, "utf-8"));
  } catch (e) {
    // No timing sidecar — an untranscribed clip (provider outage). Its words
    // are simply absent from the timeline; not an error worth logging loudly.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not load timing data ${timingPath} for ${ac}:`, e);
    }
    return null;
  }

  return timingData.words.map((w) => ({
    word: w.word,
    absoluteStart: recordedMs + w.start * 1000,
    absoluteEnd: recordedMs + w.end * 1000,
  }));
}

/** Collect timed words across all audio cards in the session. */
async function collectTimedWords(sessionAttachDir: string, audioCards: string[]): Promise<TimedWord[]> {
  const allWords: TimedWord[] = [];
  for (const ac of audioCards) {
    const words = await loadTimingWords(sessionAttachDir, ac);
    if (words) allWords.push(...words);
  }
  return allWords;
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

/** Merge words and images into a single timeline sorted by absolute time. */
function mergeTimelineEvents(allWords: TimedWord[], allImages: TimedImage[]): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...allWords.map((w): TimelineEvent => ({ type: "word", word: w })),
    ...allImages.map((img): TimelineEvent => ({ type: "image", image: img })),
  ];
  events.sort((a, b) => {
    const timeA = a.type === "word" ? a.word.absoluteStart : a.image.absoluteTime;
    const timeB = b.type === "word" ? b.word.absoluteStart : b.image.absoluteTime;
    return timeA - timeB;
  });
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
    if (event.type === "word") {
      const w = event.word;
      if (lastWordEnd > 0 && w.absoluteStart - lastWordEnd > SILENCE_THRESHOLD_MS) {
        flushText();
        const gapSeconds = Math.round((w.absoluteStart - lastWordEnd) / 1000);
        parts.push(`{% silence duration="${gapSeconds}s" /%}`);
      }
      currentWords.push(w.word);
      lastWordEnd = w.absoluteEnd;
    } else {
      flushText();
      parts.push(`{% image ref="${event.image.ref}" /%}`);
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

  const allWords = await collectTimedWords(sessionAttachDir, audioCards);
  const allImages = await collectTimedImages(sessionAttachDir, imageCards);
  const events = mergeTimelineEvents(allWords, allImages);
  const transcript = buildTranscriptMarkdown(events, allImages);

  await fs.writeFile(captureCardPath, `---\n${split.frontmatterText}\n---\n${transcript}\n`, "utf-8");
  return true;
}
