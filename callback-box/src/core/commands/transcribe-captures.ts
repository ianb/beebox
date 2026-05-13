/**
 * Transcribe capture audio — finds capture sessions with untranscribed audio
 * and runs Whisper with word-level timestamps.
 *
 * For each audio card with status="new":
 * 1. Read the audio file (from the audio card's attach scope)
 * 2. Call transcribeAudio() with word timestamps
 * 3. Write transcript text to <transcript>
 * 4. Write timing JSON to .timing.json inside the audio card's attach scope
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
import {
  attachDirFor,
  resolveAttachRef,
} from "../../lib/attach-path.js";

registerCommand({
  name: "transcribe-captures",
  description: "Transcribe audio in capture sessions with word-level timestamps",
  args: [],
  execute: async (ctx) => {
    const inboxDir = getBoxDir(ctx.boxRoot, "inbox");
    const loader = await createLoader(ctx.boxRoot);

    // Find capture-session cards at the inbox level
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(inboxDir, { withFileTypes: true });
    } catch {
      ctx.writeLine("No inbox directory found.");
      return { success: true, data: { transcribed: 0 } };
    }

    const sessionCards = entries
      .filter((e) => !e.isDirectory() && e.name.endsWith(".capture-session.card"))
      .map((e) => e.name);

    if (sessionCards.length === 0) {
      ctx.writeLine("No capture sessions found.");
      return { success: true, data: { transcribed: 0 } };
    }

    let transcribed = 0;
    let errors = 0;

    for (const sessionCardName of sessionCards) {
      const sessionCardPath = path.join(inboxDir, sessionCardName);
      const sessionAttachDir = attachDirFor(sessionCardPath);

      let attachEntries: string[];
      try {
        attachEntries = await fs.readdir(sessionAttachDir);
      } catch {
        // Empty or missing attach dir — skip
        continue;
      }

      const audioCards = attachEntries.filter((f) => f.endsWith(".audio.card"));
      const sessionLabel = sessionCardName.replace(/\.capture-session\.card$/, "");

      for (const cardFile of audioCards) {
        const cardPath = path.join(sessionAttachDir, cardFile);

        const card = await loader.load(cardPath);
        const element = card.element;

        if (element.attrs["status"] !== "new") {
          continue;
        }

        const children = element.children as ElementNode[];
        const filenameEl = children.find((c) => c.tagName === "filename");
        if (!filenameEl) {
          ctx.writeLine(`  Skipping ${cardFile}: no <filename> element`);
          continue;
        }

        const audioRef = filenameEl.attrs["ref"] as string;
        const audioPath = resolveAttachRef(cardPath, audioRef);
        if (audioPath === null) {
          ctx.writeLine(`  Skipping ${cardFile}: ref does not use attach/ prefix: ${audioRef}`);
          continue;
        }

        try {
          await fs.access(audioPath);
        } catch {
          ctx.writeLine(`  Skipping ${cardFile}: audio file ${audioRef} not found`);
          continue;
        }

        ctx.writeLine(`  Transcribing ${sessionLabel}/${audioRef}...`);

        try {
          const audioBuffer = await fs.readFile(audioPath);
          const audioFilename = path.basename(audioPath);
          const result = (await transcribeAudio({
            audioBuffer,
            filename: audioFilename,
            options: { wordTimestamps: true },
            boxRoot: ctx.boxRoot,
          })) as DetailedTranscriptionResult;

          // Write transcript text to <transcript> element (create if missing)
          const transcriptEl = children.find((c) => c.tagName === "transcript");
          if (transcriptEl) {
            transcriptEl.text = result.text;
            transcriptEl.dirty = true;
          } else {
            const newTranscript: ElementNode = {
              tagName: "transcript",
              attrs: {},
              children: [],
              text: result.text,
              dirty: true,
              comments: {},
              location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            };
            children.push(newTranscript);
            element.dirty = true;
          }

          // Ensure <summary/> placeholder exists for the summarize step
          const summaryEl = children.find((c) => c.tagName === "summary");
          if (!summaryEl) {
            const newSummary: ElementNode = {
              tagName: "summary",
              attrs: {},
              children: [],
              text: "",
              dirty: true,
              comments: {},
              location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            };
            children.push(newSummary);
            element.dirty = true;
          }

          // Set duration on <filename>
          filenameEl.attrs["duration"] = `${Math.round(result.duration)}s`;
          filenameEl.dirty = true;

          // Set status to transcribed
          element.attrs["status"] = "transcribed";
          element.dirty = true;

          await loader.save(card);

          // Write timing JSON sidecar inside this audio card's own attach scope
          const audioBasename = cardFile.replace(/\.audio\.card$/, "");
          const audioCardAttachDir = attachDirFor(cardPath);
          await fs.mkdir(audioCardAttachDir, { recursive: true });
          const timingPath = path.join(audioCardAttachDir, `${audioBasename}.timing.json`);
          const timingData = {
            words: result.words,
            duration: result.duration,
            language: result.language,
          };
          await fs.writeFile(timingPath, JSON.stringify(timingData, null, 2) + "\n");

          ctx.writeLine(
            `  Transcribed ${sessionLabel}/${audioRef}: ${Math.round(result.duration)}s, ${result.words.length} words`
          );
          transcribed++;
        } catch (error) {
          const err = error as TranscriptionError;
          ctx.writeLine(`  Error transcribing ${sessionLabel}/${audioRef}: ${err.message}`);
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
