/**
 * Assemble timeline — merges word-level timing data with image capture times
 * into a structured <transcript> on the session card.
 *
 * Prerequisites: all audio transcribed, all images analyzed/invalid.
 *
 * Algorithm:
 * 1. Load all .timing.json files, compute absolute word timestamps
 * 2. Load image cards for captured timestamps and descriptions
 * 3. Merge all events by absolute time
 * 4. Group consecutive words into <text> runs
 * 5. Insert <silence duration="Ns" /> for gaps > 10s
 * 6. Insert <image ref="..." description="..." filename="..." /> at capture time
 * 7. Write structured <transcript> to session card
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { registerCommand } from "../command-runner.js";
import { getBoxDir } from "../../cli/lib/paths.js";
import { createLoader } from "../../cli/lib/loader.js";
import type { ElementNode } from "cardworks";
import { parseCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import type { ImageFields } from "../../schemas/image.js";
import type { AudioFields } from "../../schemas/audio.js";
import { attachDirFor, resolveAttachRef } from "../../lib/attach-path.js";

async function readImageCard(cardPath: string): Promise<ImageFields | null> {
  try {
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = parseCardText(content, {
      source: cardPath,
      schemas: createCardSchemaMap(),
    });
    return parsed.fields as unknown as ImageFields;
  } catch {
    return null;
  }
}

async function readAudioCard(cardPath: string): Promise<AudioFields | null> {
  try {
    const content = await fs.readFile(cardPath, "utf-8");
    const parsed = parseCardText(content, {
      source: cardPath,
      schemas: createCardSchemaMap(),
    });
    return parsed.fields as unknown as AudioFields;
  } catch {
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

registerCommand({
  name: "assemble-timeline",
  description: "Assemble structured transcript from timing data and images",
  args: [],
  execute: async (ctx) => {
    const inboxDir = getBoxDir(ctx.boxRoot, "inbox");
    const loader = await createLoader(ctx.boxRoot);

    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(inboxDir, { withFileTypes: true });
    } catch {
      ctx.writeLine("No inbox directory found.");
      return { success: true, data: { assembled: 0 } };
    }

    const sessionCardNames = entries
      .filter((e) => !e.isDirectory() && e.name.endsWith(".capture-session.card"))
      .map((e) => e.name);

    let assembled = 0;

    for (const sessionCardName of sessionCardNames) {
      const sessionPath = path.join(inboxDir, sessionCardName);
      const sessionAttachDir = attachDirFor(sessionPath);
      const sessionLabel = sessionCardName.replace(/\.capture-session\.card$/, "");

      let attachFiles: string[];
      try {
        attachFiles = await fs.readdir(sessionAttachDir);
      } catch {
        continue;
      }

      const sessionCard = await loader.load(sessionPath);
      const sessionEl = sessionCard.element;

      // Check if already assembled (has structured transcript children)
      const existingTranscript = (sessionEl.children as ElementNode[]).find(
        (c) => c.tagName === "transcript"
      );
      if (
        existingTranscript &&
        Array.isArray(existingTranscript.children) &&
        existingTranscript.children.length > 0
      ) {
        continue; // Already assembled
      }

      // Check all audio is transcribed
      const audioCards = attachFiles.filter((f) => f.endsWith(".audio.card"));
      let allAudioReady = true;
      for (const ac of audioCards) {
        const fields = await readAudioCard(path.join(sessionAttachDir, ac));
        if (!fields || fields.status !== "transcribed") {
          allAudioReady = false;
          break;
        }
      }
      if (!allAudioReady) {
        ctx.writeLine(`  Skipping ${sessionLabel}: not all audio transcribed`);
        continue;
      }

      // Check all images are analyzed or invalid
      const imageCards = attachFiles.filter((f) => f.endsWith(".image.card"));
      let allImagesReady = true;
      for (const ic of imageCards) {
        const fields = await readImageCard(path.join(sessionAttachDir, ic));
        if (!fields || (fields.status !== "analyzed" && fields.status !== "invalid")) {
          allImagesReady = false;
          break;
        }
      }
      if (!allImagesReady) {
        ctx.writeLine(`  Skipping ${sessionLabel}: not all images analyzed`);
        continue;
      }

      ctx.writeLine(`  Assembling timeline for ${sessionLabel}...`);

      // Collect timed words from all audio clips
      const allWords: TimedWord[] = [];

      for (const ac of audioCards) {
        const audioCardPath = path.join(sessionAttachDir, ac);
        const acFields = await readAudioCard(audioCardPath);
        if (!acFields) continue;
        const recordedAt = acFields.filename.recorded;
        const recordedMs = new Date(recordedAt).getTime();

        // Load timing JSON from the audio card's own attach scope
        const audioBasename = ac.replace(/\.audio\.card$/, "");
        const timingPath = path.join(
          attachDirFor(audioCardPath),
          `${audioBasename}.timing.json`,
        );
        let timingData: { words: Array<{ word: string; start: number; end: number }> };
        try {
          const raw = await fs.readFile(timingPath, "utf-8");
          timingData = JSON.parse(raw);
        } catch {
          ctx.writeLine(`    Warning: no timing data for ${ac}`);
          continue;
        }

        for (const w of timingData.words) {
          allWords.push({
            word: w.word,
            absoluteStart: recordedMs + w.start * 1000,
            absoluteEnd: recordedMs + w.end * 1000,
          });
        }
      }

      // Collect timed images
      const allImages: TimedImage[] = [];

      for (const ic of imageCards) {
        const imageCardPath = path.join(sessionAttachDir, ic);
        const icFields = await readImageCard(imageCardPath);
        if (!icFields) continue;
        if (icFields.status === "invalid") continue;

        const capturedAt = icFields.filename.captured;
        const imageRef = icFields.filename.ref;
        const resolvedImagePath = resolveAttachRef(imageCardPath, imageRef);
        const imageFilename = resolvedImagePath
          ? path.basename(resolvedImagePath)
          : imageRef;

        allImages.push({
          // Session-scope ref points at the image card inside the session's attach
          ref: `attach/${ic}`,
          description: (icFields.description ?? "").trim(),
          filename: imageFilename,
          absoluteTime: new Date(capturedAt).getTime(),
        });
      }

      // Merge into timeline events sorted by time
      const events: TimelineEvent[] = [
        ...allWords.map((w): TimelineEvent => ({ type: "word", word: w })),
        ...allImages.map((img): TimelineEvent => ({ type: "image", image: img })),
      ];

      events.sort((a, b) => {
        const timeA = a.type === "word" ? a.word.absoluteStart : a.image.absoluteTime;
        const timeB = b.type === "word" ? b.word.absoluteStart : b.image.absoluteTime;
        return timeA - timeB;
      });

      // Build transcript children
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
          const img = event.image;
          transcriptChildren.push(
            makeImageElement({ ref: img.ref, description: img.description, filename: img.filename })
          );
        }
      }

      // Flush remaining text
      flushText();

      // Handle case with no audio (images only, or empty session)
      if (transcriptChildren.length === 0 && allImages.length > 0) {
        for (const img of allImages) {
          transcriptChildren.push(
            makeImageElement({ ref: img.ref, description: img.description, filename: img.filename })
          );
        }
      }

      // Update the session card's <transcript>
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
      await loader.save(sessionCard);

      ctx.writeLine(
        `  Assembled ${sessionLabel}: ${allWords.length} words, ${allImages.length} images, ${transcriptChildren.length} segments`
      );
      assembled++;
    }

    ctx.writeLine(`\nAssembly complete: ${assembled} sessions.`);
    return { success: true, data: { assembled } };
  },
});

function makeTextElement(text: string): ElementNode {
  return {
    tagName: "text",
    attrs: {},
    children: [],
    text,
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  };
}

function makeSilenceElement(duration: string): ElementNode {
  return {
    tagName: "silence",
    attrs: { duration },
    children: [],
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  };
}

/**
 * Parameters for makeImageElement
 */
interface MakeImageElementParams {
  ref: string;
  description: string;
  filename: string;
}

function makeImageElement(params: MakeImageElementParams): ElementNode {
  const { ref, description, filename } = params;
  const attrs: Record<string, string> = { ref };
  if (description) attrs["description"] = description;
  if (filename) attrs["filename"] = filename;

  return {
    tagName: "image",
    attrs,
    children: [],
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  };
}
