/**
 * Transcribe capture audio — finds capture sessions with untranscribed audio
 * and runs Whisper with word-level timestamps.
 *
 * For each audio card with status="new":
 * 1. Read the audio file
 * 2. Call transcribeAudio() with word timestamps
 * 3. Write transcript text to <transcript>
 * 4. Write timing JSON to .timing.json sidecar
 * 5. Set duration on <filename>
 * 6. Set status="transcribed"
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { registerCommand } from "../command-runner.js";
import { getBoxDir } from "../../cli/lib/paths.js";
import { createLoader } from "../../cli/lib/loader.js";
import {
  transcribeAudio,
  type DetailedTranscriptionResult,
  type TranscriptionError,
} from "../transcription.js";
import type { ElementNode } from "cardworks";

registerCommand({
  name: "transcribe-captures",
  description: "Transcribe audio in capture sessions with word-level timestamps",
  args: [],
  execute: async (ctx) => {
    const inboxDir = getBoxDir(ctx.boxRoot, "inbox");
    const loader = createLoader(ctx.boxRoot);

    // Find capture directories
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(inboxDir, { withFileTypes: true });
    } catch {
      ctx.writeLine("No inbox directory found.");
      return { success: true, data: { transcribed: 0 } };
    }

    const captureDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("capture-"))
      .map((e) => e.name);

    if (captureDirs.length === 0) {
      ctx.writeLine("No capture sessions found.");
      return { success: true, data: { transcribed: 0 } };
    }

    let transcribed = 0;
    let errors = 0;

    for (const dir of captureDirs) {
      const dirPath = path.join(inboxDir, dir);
      const files = await fs.readdir(dirPath);
      const audioCards = files.filter((f) => f.endsWith(".audio.card"));

      for (const cardFile of audioCards) {
        const cardRelPath = path.join("box/inbox", dir, cardFile);

        // Load the card
        const card = await loader.load(cardRelPath);
        const element = card.element;

        // Skip if not status="new"
        if (element.attrs["status"] !== "new") {
          continue;
        }

        // Get the audio filename from <filename name="...">
        const children = element.children as ElementNode[];
        const filenameEl = children.find((c) => c.tagName === "filename");
        if (!filenameEl) {
          ctx.writeLine(`  Skipping ${cardFile}: no <filename> element`);
          continue;
        }

        const audioFilename = filenameEl.attrs["name"] as string;
        const audioPath = path.join(dirPath, audioFilename);

        // Check audio file exists
        try {
          await fs.access(audioPath);
        } catch {
          ctx.writeLine(`  Skipping ${cardFile}: audio file ${audioFilename} not found`);
          continue;
        }

        ctx.writeLine(`  Transcribing ${dir}/${audioFilename}...`);

        try {
          // Read audio and transcribe with word timestamps
          const audioBuffer = await fs.readFile(audioPath);
          const result = (await transcribeAudio(
            audioBuffer,
            audioFilename,
            undefined,
            { wordTimestamps: true }
          )) as DetailedTranscriptionResult;

          // Write transcript text to <transcript> element
          const transcriptEl = children.find((c) => c.tagName === "transcript");
          if (transcriptEl) {
            transcriptEl.text = result.text;
            transcriptEl.dirty = true;
          }

          // Set duration on <filename>
          filenameEl.attrs["duration"] = `${Math.round(result.duration)}s`;
          filenameEl.dirty = true;

          // Set status to transcribed
          element.attrs["status"] = "transcribed";
          element.dirty = true;

          // Save the card
          await loader.save(card);

          // Write timing JSON sidecar
          // audio-000.audio.card -> audio-000.timing.json
          const basename = cardFile.replace(/\.audio\.card$/, "");
          const timingPath = path.join(dirPath, `${basename}.timing.json`);
          const timingData = {
            words: result.words,
            duration: result.duration,
            language: result.language,
          };
          await fs.writeFile(timingPath, JSON.stringify(timingData, null, 2) + "\n");

          ctx.writeLine(
            `  Transcribed ${dir}/${audioFilename}: ${Math.round(result.duration)}s, ${result.words.length} words`
          );
          transcribed++;
        } catch (error) {
          const err = error as TranscriptionError;
          ctx.writeLine(`  Error transcribing ${dir}/${audioFilename}: ${err.message}`);
          errors++;
        }
      }
    }

    ctx.writeLine(`\nTranscription complete: ${transcribed} transcribed, ${errors} errors.`);

    if (errors > 0) {
      return {
        success: false,
        data: { transcribed, errors },
        error: `${errors} transcription error(s)`,
      };
    }

    return {
      success: true,
      data: { transcribed, errors },
    };
  },
});
