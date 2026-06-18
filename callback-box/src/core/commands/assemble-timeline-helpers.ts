/** Helpers for assemble-timeline; in a sibling file to keep the command under 300 lines. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { splitCardContent } from "cardworks";
import { parseCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import type { ImageFields } from "../../schemas/image.js";
import type { AudioFields } from "../../schemas/audio.js";
import { attachDirFor } from "../../shared/attach-path.js";

async function readImageCard(cardPath: string): Promise<ImageFields | null> {
  try {
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = parseCardText(content, {
      source: cardPath,
      schemas: await createCardSchemaMap(),
    });
    return parsed.fields as unknown as ImageFields;
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
    const parsed = parseCardText(content, {
      source: cardPath,
      schemas: await createCardSchemaMap(),
    });
    return parsed.fields as unknown as AudioFields;
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

type TimelineEvent =
  | { type: "word"; word: TimedWord }
  | { type: "image"; image: TimedImage };

const SILENCE_THRESHOLD_MS = 10_000;

/** Minimal subset of the command context used by the helpers here. */
export interface TimelineCtx {
  writeLine: (line: string) => void;
}

/**
 * Read the inbox directory entries. Returns null when the directory is missing
 * (treated as an empty inbox by the caller).
 */
export async function readInboxEntries(
  inboxDir: string
): Promise<Array<{ name: string; isDirectory: () => boolean }> | null> {
  try {
    return await fs.readdir(inboxDir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read inbox directory ${inboxDir}, assuming none:`, e);
    }
    return null;
  }
}

/**
 * Read a session's attach directory listing. Returns null when missing.
 */
async function readSessionAttachFiles(
  sessionAttachDir: string,
  sessionLabel: string
): Promise<string[] | null> {
  try {
    return await fs.readdir(sessionAttachDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`No attach dir for ${sessionLabel} (${sessionAttachDir}), skipping:`, e);
    }
    return null;
  }
}

/** True if every audio card in the session is transcribed. */
async function allAudioTranscribed(sessionAttachDir: string, audioCards: string[]): Promise<boolean> {
  for (const ac of audioCards) {
    const fields = await readAudioCard(path.join(sessionAttachDir, ac));
    if (!fields || fields.status !== "transcribed") return false;
  }
  return true;
}

/** True if every image card in the session is analyzed or invalid. */
async function allImagesAnalyzed(sessionAttachDir: string, imageCards: string[]): Promise<boolean> {
  for (const ic of imageCards) {
    const fields = await readImageCard(path.join(sessionAttachDir, ic));
    if (!fields || (fields.status !== "analyzed" && fields.status !== "invalid")) return false;
  }
  return true;
}

/** Load the timing words for a single audio card, or null when unavailable. */
async function loadTimingWords(params: {
  ctx: TimelineCtx;
  sessionAttachDir: string;
  ac: string;
}): Promise<TimedWord[] | null> {
  const { ctx, sessionAttachDir, ac } = params;
  const audioCardPath = path.join(sessionAttachDir, ac);
  const acFields = await readAudioCard(audioCardPath);
  if (!acFields) return null;
  const recordedMs = new Date(acFields.filename.recorded).getTime();

  // Load timing JSON from the audio card's own attach scope
  const audioBasename = ac.replace(/\.audio\.card$/, "");
  const timingPath = path.join(attachDirFor(audioCardPath), `${audioBasename}.timing.json`);
  let timingData: { words: Array<{ word: string; start: number; end: number }> };
  try {
    const raw = await fs.readFile(timingPath, "utf-8");
    timingData = JSON.parse(raw);
  } catch (e) {
    ctx.writeLine(`    Warning: no timing data for ${ac}`);
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
async function collectTimedWords(params: {
  ctx: TimelineCtx;
  sessionAttachDir: string;
  audioCards: string[];
}): Promise<TimedWord[]> {
  const { ctx, sessionAttachDir, audioCards } = params;
  const allWords: TimedWord[] = [];
  for (const ac of audioCards) {
    const words = await loadTimingWords({ ctx, sessionAttachDir, ac });
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
      // Session-scope ref points at the image card inside the session's attach
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
 * `{% silence %}` block tags, and photos as `{% image %}` block tags
 * (reference-only — description/filename come from the image card). Blocks
 * are blank-line separated so the Markdoc tags parse as block-level.
 */
function buildTranscriptMarkdown(events: TimelineEvent[], allImages: TimedImage[]): string {
  const parts: string[] = [];
  let currentWords: string[] = [];
  let lastWordEnd = 0;

  function flushText() {
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
 * Assemble the timeline for a single session card. Returns true if a transcript
 * was assembled and saved, false if the session was skipped.
 */
export async function assembleSession(params: {
  ctx: TimelineCtx;
  inboxDir: string;
  sessionCardName: string;
}): Promise<boolean> {
  const { ctx, inboxDir, sessionCardName } = params;
  const sessionPath = path.join(inboxDir, sessionCardName);
  const sessionAttachDir = attachDirFor(sessionPath);
  const sessionLabel = sessionCardName.replace(/\.capture-session\.card$/, "");

  const attachFiles = await readSessionAttachFiles(sessionAttachDir, sessionLabel);
  if (!attachFiles) return false;

  let content: string;
  try {
    content = await fs.readFile(sessionPath, "utf-8");
  } catch (e) {
    console.warn(`Could not read session card ${sessionPath}, skipping:`, e);
    return false;
  }
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    ctx.writeLine(`  Skipping ${sessionLabel}: not a frontmatter card`);
    return false;
  }
  // A non-empty body means the transcript is already assembled.
  if (split.body.trim().length > 0) return false;

  const audioCards = attachFiles.filter((f) => f.endsWith(".audio.card"));
  if (!(await allAudioTranscribed(sessionAttachDir, audioCards))) {
    ctx.writeLine(`  Skipping ${sessionLabel}: not all audio transcribed`);
    return false;
  }

  const imageCards = attachFiles.filter((f) => f.endsWith(".image.card"));
  if (!(await allImagesAnalyzed(sessionAttachDir, imageCards))) {
    ctx.writeLine(`  Skipping ${sessionLabel}: not all images analyzed`);
    return false;
  }

  ctx.writeLine(`  Assembling timeline for ${sessionLabel}...`);

  const allWords = await collectTimedWords({ ctx, sessionAttachDir, audioCards });
  const allImages = await collectTimedImages(sessionAttachDir, imageCards);
  const events = mergeTimelineEvents(allWords, allImages);
  const transcript = buildTranscriptMarkdown(events, allImages);

  await fs.writeFile(sessionPath, `---\n${split.frontmatterText}\n---\n${transcript}\n`, "utf-8");

  ctx.writeLine(
    `  Assembled ${sessionLabel}: ${allWords.length} words, ${allImages.length} images`
  );
  return true;
}
