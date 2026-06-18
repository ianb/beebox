/**
 * Transcribe capture audio — finds capture sessions with untranscribed audio
 * and runs Whisper with word-level timestamps.
 *
 * For each audio card with status="new":
 * 1. Read the audio file (from the audio card's attach scope)
 * 2. Call transcribeAudio() with word timestamps
 * 3. Write transcript text to the card's `transcript` field
 * 4. Write timing JSON to .timing.json inside the audio card's attach scope
 * 5. Set duration on `filename.duration`
 * 6. Set status="transcribed"
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { registerCommand } from "../command-runner.js";
import { getBoxDir } from "../../cli/lib/paths.js";
import { parseCardText, serializeCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { type AudioFields } from "../../schemas/audio.js";
import {
  transcribeAudio,
  type DetailedTranscriptionResult,
  type TranscriptionError,
} from "../transcription.js";
import {
  attachDirFor,
  resolveAttachRef,
} from "../../shared/attach-path.js";

async function loadAudioCard(cardPath: string): Promise<AudioFields> {
  const content = await fs.readFile(cardPath, "utf-8");
  const parsed = parseCardText(content, {
    source: cardPath,
    schemas: await createCardSchemaMap(),
  });
  return parsed.fields as unknown as AudioFields;
}

async function saveAudioCard(cardPath: string, fields: AudioFields): Promise<void> {
  const parsed = parseCardText(`---\n${stringifyYaml(fields)}---\n`, {
    source: cardPath,
    schemas: await createCardSchemaMap(),
  });
  await fs.writeFile(cardPath, serializeCardText({
    schema: parsed.schema,
    fields: fields as unknown as Record<string, unknown>,
  }));
}

registerCommand({
  name: "transcribe-captures",
  description: "Transcribe audio in capture sessions with word-level timestamps",
  args: [],
  execute: async (ctx) => {
    const inboxDir = getBoxDir(ctx.boxRoot, "inbox");

    // Find capture-session cards at the inbox level
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(inboxDir, { withFileTypes: true });
    } catch (e) {
      ctx.writeLine(`No inbox directory found (or unreadable): ${e instanceof Error ? e.message : String(e)}`);
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
      } catch (_e) {
        // No attach directory for this session means it has no audio cards to
        // transcribe — a normal, expected state, so skip it silently.
        continue;
      }

      const audioCards = attachEntries.filter((f) => f.endsWith(".audio.card"));
      const sessionLabel = sessionCardName.replace(/\.capture-session\.card$/, "");

      for (const cardFile of audioCards) {
        const cardPath = path.join(sessionAttachDir, cardFile);

        let fields: AudioFields;
        try {
          fields = await loadAudioCard(cardPath);
        } catch (e) {
          ctx.writeLine(`  Skipping ${cardFile}: ${(e as Error).message}`);
          continue;
        }

        if (fields.status !== "new") continue;

        const audioRef = fields.filename.ref;
        const audioPath = resolveAttachRef(cardPath, audioRef);
        if (audioPath === null) {
          ctx.writeLine(`  Skipping ${cardFile}: ref does not use attach/ prefix: ${audioRef}`);
          continue;
        }

        try {
          await fs.access(audioPath);
        } catch (_e) {
          // Referenced audio file is missing/inaccessible — nothing to
          // transcribe; the writeLine below surfaces the skip to the user.
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

          fields.transcript = result.text;
          if (fields.summary === undefined) fields.summary = "";
          fields.filename.duration = `${String(Math.round(result.duration))}s`;
          fields.status = "transcribed";

          await saveAudioCard(cardPath, fields);

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
            `  Transcribed ${sessionLabel}/${audioRef}: ${String(Math.round(result.duration))}s, ${String(result.words.length)} words`
          );
          transcribed++;
        } catch (error) {
          const err = error as TranscriptionError;
          ctx.writeLine(`  Error transcribing ${sessionLabel}/${audioRef}: ${err.message}`);
          errors++;
        }
      }
    }

    ctx.writeLine(`\nTranscription complete: ${String(transcribed)} transcribed, ${String(errors)} errors.`);

    if (errors > 0) {
      return {
        success: false,
        data: { transcribed, errors },
        error: `${String(errors)} transcription error(s)`,
      };
    }

    return {
      success: true,
      data: { transcribed, errors },
    };
  },
});
