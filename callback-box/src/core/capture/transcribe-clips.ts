/**
 * Transcription step of the capture preparation worker.
 *
 * For each audio card in the capture's attach scope with `status: new`, run the
 * configured transcription service with word timestamps, write the transcript +
 * duration back onto the card (status → transcribed), and drop a
 * `<basename>.timing.json` sidecar in the clip's attach scope (the timeline
 * assembler reads it). Per-clip failures are collected, never aborting the
 * batch (pattern from the retired `cb transcribe-captures`); the worker decides
 * what to do when every clip fails.
 *
 * Idempotent: a clip already `transcribed` (with its sidecar present) is
 * skipped, so a re-run after a crash resumes without re-billing the service.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { renderFrontmatterBlock } from "../../cards/index.js";
import { cardFields, parseCardText, serializeCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { type AudioFields, AudioSchema } from "../../schemas/audio.js";
import { transcribeAudio, type DetailedTranscriptionResult } from "../transcription/index.js";
import { attachDirFor, resolveAttachRef } from "../../shared/attach-path.js";

async function loadAudioCard(cardPath: string): Promise<AudioFields> {
  const content = await fs.readFile(cardPath, "utf-8");
  const parsed = parseCardText(content, { source: cardPath, schemas: await createCardSchemaMap() });
  return cardFields(parsed, AudioSchema);
}

async function saveAudioCard(cardPath: string, fields: AudioFields): Promise<void> {
  const parsed = parseCardText(renderFrontmatterBlock(fields), {
    source: cardPath,
    schemas: await createCardSchemaMap(),
  });
  await fs.writeFile(cardPath, serializeCardText({ schema: parsed.schema, fields: parsed.fields }));
}

export interface TranscribeClipsResult {
  /** Number of audio cards in the capture. */
  total: number;
  /** Clips now `transcribed` (this run plus any already done). */
  transcribed: number;
  /** Per-clip failures this run (message per clip). */
  errors: string[];
  /** Summed duration (seconds) across transcribed clips. */
  durationSeconds: number;
  /** Transcript of the first clip (for the capture summary), if transcribed. */
  firstTranscript: string | undefined;
}

/**
 * Transcribe every untranscribed audio clip in the capture's attach scope.
 */
export async function transcribeCaptureClips(opts: {
  boxRoot: string;
  captureAttachDir: string;
}): Promise<TranscribeClipsResult> {
  const { boxRoot, captureAttachDir } = opts;
  const entries = await fs.readdir(captureAttachDir);
  const audioCards = entries.filter((f) => f.endsWith(".audio.card")).toSorted();

  const errors: string[] = [];
  let transcribed = 0;
  let durationSeconds = 0;
  let firstTranscript: string | undefined;

  for (const cardFile of audioCards) {
    const cardPath = path.join(captureAttachDir, cardFile);
    let fields: AudioFields;
    try {
      fields = await loadAudioCard(cardPath);
    } catch (e) {
      errors.push(`${cardFile}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const durationOf = (f: AudioFields): number => parseDurationSeconds(f.filename.duration);
    if (fields.status === "transcribed") {
      transcribed += 1;
      durationSeconds += durationOf(fields);
      // Summary comes from the first SUCCEEDED clip, not clip 0 — a partial
      // failure where clip 0 failed must still yield a meaningful summary.
      if (firstTranscript === undefined) firstTranscript = fields.transcript;
      continue;
    }

    const audioPath = resolveAttachRef(cardPath, fields.filename.ref);
    if (audioPath === null) {
      errors.push(`${cardFile}: ref does not use attach/ prefix: ${fields.filename.ref}`);
      continue;
    }

    try {
      const audioBuffer = await fs.readFile(audioPath);
      const result = (await transcribeAudio({
        audioBuffer,
        filename: path.basename(audioPath),
        options: { wordTimestamps: true },
        boxRoot,
      })) as DetailedTranscriptionResult;

      fields.transcript = result.text;
      if (fields.summary === undefined) fields.summary = "";
      fields.filename.duration = `${String(Math.round(result.duration))}s`;
      fields.status = "transcribed";
      await saveAudioCard(cardPath, fields);
      if (firstTranscript === undefined) firstTranscript = result.text;

      const audioBasename = cardFile.replace(/\.audio\.card$/, "");
      const audioCardAttachDir = attachDirFor(cardPath);
      await fs.mkdir(audioCardAttachDir, { recursive: true });
      const timingPath = path.join(audioCardAttachDir, `${audioBasename}.timing.json`);
      const timingData = { words: result.words, duration: result.duration, language: result.language };
      await fs.writeFile(timingPath, JSON.stringify(timingData, null, 2) + "\n");

      transcribed += 1;
      durationSeconds += result.duration;
    } catch (e) {
      errors.push(`${cardFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { total: audioCards.length, transcribed, errors, durationSeconds, firstTranscript };
}

/** Parse an audio card's `filename.duration` ("42s") back to seconds. */
function parseDurationSeconds(duration: string | undefined): number {
  if (duration === undefined) return 0;
  const match = /^(\d+)s$/.exec(duration);
  return match ? Number(match[1]) : 0;
}
