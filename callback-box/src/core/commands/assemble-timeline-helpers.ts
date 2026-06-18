/** Helpers for assemble-timeline; in a sibling file to keep the command under 300 lines. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { createLoader } from "../../cli/lib/loader.js";
import type { ElementNode } from "cardworks";
import { parseCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import type { ImageFields } from "../../schemas/image.js";
import type { AudioFields } from "../../schemas/audio.js";
import { attachDirFor, resolveAttachRef } from "../../shared/attach-path.js";

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
  ref: string; // card filename
  description: string;
  filename: string; // image filename
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

/** True if the session card already has a populated <transcript>. */
function isAlreadyAssembled(sessionEl: ElementNode): boolean {
  const existingTranscript = (sessionEl.children as ElementNode[]).find(
    (c) => c.tagName === "transcript"
  );
  return Boolean(
    existingTranscript &&
      Array.isArray(existingTranscript.children) &&
      existingTranscript.children.length > 0
  );
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
    const imageCardPath = path.join(sessionAttachDir, ic);
    const icFields = await readImageCard(imageCardPath);
    if (!icFields) continue;
    if (icFields.status === "invalid") continue;

    const imageRef = icFields.filename.ref;
    const resolvedImagePath = resolveAttachRef(imageCardPath, imageRef);
    const imageFilename = resolvedImagePath ? path.basename(resolvedImagePath) : imageRef;

    allImages.push({
      // Session-scope ref points at the image card inside the session's attach
      ref: `attach/${ic}`,
      description: (icFields.description ?? "").trim(),
      filename: imageFilename,
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

function imageElementFor(img: TimedImage): ElementNode {
  return makeImageElement({ ref: img.ref, description: img.description, filename: img.filename });
}

/** Build the <transcript> children: <text> runs, <silence> gaps, and <image> events. */
function buildTranscriptChildren(events: TimelineEvent[], allImages: TimedImage[]): ElementNode[] {
  const transcriptChildren: ElementNode[] = [];
  let currentWords: string[] = [];
  let lastWordEnd = 0;

  function flushText() {
    if (currentWords.length > 0) {
      transcriptChildren.push(makeTextElement(currentWords.join(" ")));
      currentWords = [];
    }
  }

  for (const event of events) {
    if (event.type === "word") {
      const w = event.word;
      // Check for silence gap
      if (lastWordEnd > 0 && w.absoluteStart - lastWordEnd > SILENCE_THRESHOLD_MS) {
        flushText();
        const gapSeconds = Math.round((w.absoluteStart - lastWordEnd) / 1000);
        transcriptChildren.push(makeSilenceElement(`${gapSeconds}s`));
      }
      currentWords.push(w.word);
      lastWordEnd = w.absoluteEnd;
    } else {
      // Image — flush current text first
      flushText();
      transcriptChildren.push(imageElementFor(event.image));
    }
  }

  // Flush remaining text
  flushText();

  // Handle case with no audio (images only, or empty session)
  if (transcriptChildren.length === 0 && allImages.length > 0) {
    for (const img of allImages) {
      transcriptChildren.push(imageElementFor(img));
    }
  }

  return transcriptChildren;
}

/** Replace (or append) the session card's <transcript> element. */
function setSessionTranscript(sessionEl: ElementNode, transcriptChildren: ElementNode[]): void {
  const sessionChildren = sessionEl.children as ElementNode[];
  const transcriptIdx = sessionChildren.findIndex((c) => c.tagName === "transcript");

  const newTranscript: ElementNode = {
    tagName: "transcript",
    attrs: {},
    children: transcriptChildren,
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  };

  if (transcriptIdx !== -1) {
    sessionChildren[transcriptIdx] = newTranscript;
  } else {
    sessionChildren.push(newTranscript);
  }

  sessionEl.dirty = true;
}

/**
 * Assemble the timeline for a single session card. Returns true if a transcript
 * was assembled and saved, false if the session was skipped.
 */
export async function assembleSession(params: {
  ctx: TimelineCtx;
  loader: Awaited<ReturnType<typeof createLoader>>;
  inboxDir: string;
  sessionCardName: string;
}): Promise<boolean> {
  const { ctx, loader, inboxDir, sessionCardName } = params;
  const sessionPath = path.join(inboxDir, sessionCardName);
  const sessionAttachDir = attachDirFor(sessionPath);
  const sessionLabel = sessionCardName.replace(/\.capture-session\.card$/, "");

  const attachFiles = await readSessionAttachFiles(sessionAttachDir, sessionLabel);
  if (!attachFiles) return false;

  const sessionCard = await loader.load(sessionPath);
  const sessionEl = sessionCard.element;

  if (isAlreadyAssembled(sessionEl)) return false;

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
  const transcriptChildren = buildTranscriptChildren(events, allImages);

  setSessionTranscript(sessionEl, transcriptChildren);
  await loader.save(sessionCard);

  ctx.writeLine(
    `  Assembled ${sessionLabel}: ${allWords.length} words, ${allImages.length} images, ${transcriptChildren.length} segments`
  );
  return true;
}

function makeElement(params: {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
}): ElementNode {
  const { tagName, attrs, text } = params;
  return {
    tagName,
    attrs,
    children: [],
    ...(text === undefined ? {} : { text }),
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  };
}

function makeTextElement(text: string): ElementNode {
  return makeElement({ tagName: "text", attrs: {}, text });
}

function makeSilenceElement(duration: string): ElementNode {
  return makeElement({ tagName: "silence", attrs: { duration } });
}

function makeImageElement(params: { ref: string; description: string; filename: string }): ElementNode {
  const { ref, description, filename } = params;
  const attrs: Record<string, string> = { ref };
  if (description) attrs["description"] = description;
  if (filename) attrs["filename"] = filename;
  return makeElement({ tagName: "image", attrs });
}
