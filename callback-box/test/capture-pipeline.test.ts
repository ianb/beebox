/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Integration test for the capture-through-intake pipeline.
 *
 * Starts from real capture session fixtures (audio + images) and runs
 * through transcription, image analysis, and timeline assembly.
 *
 * Modes:
 * - Default (replay): loads saved API responses from fixtures
 * - Record (CB_REGENERATE_FIXTURES=1): calls real APIs, saves responses
 *
 * Requires API keys when recording:
 * - MISTRAL_API_KEY or THINKING_OPENAI_API_KEY (transcription)
 * - GEMINI_KEY or SKE_GEMINI_API_KEY (image analysis)
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { test } from "tap";
import { runCommand, createCollectorContext } from "../src/core/command-runner.js";
import { parseCardText, serializeCardText } from "../src/core/card-io.js";
import { createCardSchemaMap } from "../src/schemas/registry.js";
import type { AudioFields } from "../src/schemas/audio.js";
import type { ImageFields } from "../src/schemas/image.js";
// Import commands to register them
import "../src/core/commands/assemble-timeline.js";
import {
  analyzeImagesWithGemini,
  extractExif,
  type ImageAnalysis,
} from "../src/core/commands/describe-images-helpers.js";
import { transcribeAudio, type DetailedTranscriptionResult } from "../src/core/transcription.js";
import { createFixtureReplay } from "./helpers/fixture-replay.js";

const FIXTURE_DIR = "test/fixtures/capture-session";
const OUTPUT_DIR = "test/fixtures/capture-session-outputs";
const CAPTURE_DIR_NAME = "capture-20260323T0004-1d088356";

test("capture pipeline: transcribe → describe → assemble", async (t) => {
  const replay = await createFixtureReplay({
    fixtureDir: FIXTURE_DIR,
    outputDir: OUTPUT_DIR,
  });

  const box = await replay.createBox();
  t.teardown(() => box.cleanup());

  // Session card lives at the inbox level; child cards and their media live
  // inside the session's attach scope (each child has its own attach scope).
  const sessionCardRel = join("box/inbox", `${CAPTURE_DIR_NAME}.capture-session.card`);
  const sessionAttachDir = join(box.root, "box/inbox", `${CAPTURE_DIR_NAME}.attach`);

  // ── Step 1: Transcription ──

  const audioCardPath = join(sessionAttachDir, "audio-001.audio.card");
  const audioFilePath = join(sessionAttachDir, "audio-001.attach", "audio-001.webm");

  const transcriptionResult = await replay.recordOrReplay(
    "transcription-audio-001",
    async () => {
      t.comment("Recording: calling transcription API...");
      const audioBuffer = await readFile(audioFilePath);
      return (await transcribeAudio({
        audioBuffer,
        filename: "audio-001.webm",
        options: { wordTimestamps: true },
        boxRoot: box.root,
      })) as DetailedTranscriptionResult;
    }
  );

  t.ok(transcriptionResult.text.length > 0, "transcription produced text");
  t.ok(transcriptionResult.words.length > 0, "transcription produced word timestamps");
  t.ok(transcriptionResult.duration > 0, "transcription has duration");

  // Apply transcription to card (same logic as transcribe-captures command)
  const attachRelDir = join("box/inbox", `${CAPTURE_DIR_NAME}.attach`);
  {
    const cardPath = box.path(join(attachRelDir, "audio-001.audio.card"));
    const content = await readFile(cardPath, "utf-8");
    const parsed = parseCardText(content, {
      source: cardPath,
      schemas: await createCardSchemaMap(),
    });
    const fields = parsed.fields as unknown as AudioFields;
    fields.transcript = transcriptionResult.text;
    fields.filename.duration = `${String(Math.round(transcriptionResult.duration))}s`;
    fields.status = "transcribed";
    await writeFile(cardPath, serializeCardText({
      schema: parsed.schema,
      fields: fields as unknown as Record<string, unknown>,
    }));
  }

  // Write timing JSON sidecar inside the audio card's own attach scope
  const audioCardAttachDir = join(sessionAttachDir, "audio-001.attach");
  const timingPath = join(audioCardAttachDir, "audio-001.timing.json");
  await writeFile(timingPath, JSON.stringify({
    words: transcriptionResult.words,
    duration: transcriptionResult.duration,
    language: transcriptionResult.language,
  }, null, 2) + "\n");

  // Verify card was updated
  const updatedAudioCard = await box.read(join(attachRelDir, "audio-001.audio.card"));
  t.ok(updatedAudioCard.includes("status: transcribed"), "audio card status is transcribed");
  t.ok(updatedAudioCard.includes("duration:"), "audio card has duration");

  // ── Step 2: Image Analysis ──

  // Each image lives inside its own attach scope (e.g. photo-001.attach/photo-001.jpg).
  const imageFiles = ["photo-001.jpg", "photo-002.jpg", "photo-003.jpg"];
  const imagePaths = imageFiles.map((f) => {
    const base = f.replace(/\.jpg$/, "");
    return join(sessionAttachDir, `${base}.attach`, f);
  });

  const geminiResult = await replay.recordOrReplay(
    "gemini-image-analysis",
    async () => {
      t.comment("Recording: calling Gemini API...");
      const apiKey = process.env["GEMINI_KEY"] || process.env["SKE_GEMINI_API_KEY"];
      if (!apiKey) throw new Error("GEMINI_KEY required for recording");
      return await analyzeImagesWithGemini(apiKey, { imagePaths });
    }
  );

  t.equal(geminiResult.analyses.length, 3, "got analysis for all 3 images");

  // Extract EXIF for each image (always runs locally, no API)
  const exifResults = await Promise.all(
    imagePaths.map((p) => extractExif(p))
  );

  // Apply analysis to image cards
  const imageCardFiles = ["photo-001.image.card", "photo-002.image.card", "photo-003.image.card"];

  for (let i = 0; i < imageCardFiles.length; i++) {
    const cardRelPath = join(attachRelDir, imageCardFiles[i]!);
    const cardPath = box.path(cardRelPath);
    const content = await readFile(cardPath, "utf-8");
    const parsed = parseCardText(content, {
      source: cardPath,
      schemas: await createCardSchemaMap(),
    });
    const fields = parsed.fields as unknown as ImageFields;
    const analysis = geminiResult.analyses.find((a: ImageAnalysis) => a.index === i);

    if (!analysis) {
      t.fail(`No analysis for image ${String(i)}`);
      continue;
    }

    fields.status = analysis.invalid ? "invalid" : "analyzed";
    fields["has-text"] = analysis.has_text;
    fields.description = analysis.description;

    const exif = exifResults[i];
    if (exif && exif.date) {
      fields.filename.captured = exif.date;
    }

    if (analysis.text_blocks.length > 0) {
      fields.text = analysis.text_blocks.map((b) => ({
        source: b.source,
        content: b.text,
      }));
    }

    if (exif) {
      const exifFields: NonNullable<ImageFields["exif"]> = {};
      if (exif.date) exifFields.date = exif.date;
      if (exif.camera) exifFields.camera = exif.camera;
      if (exif.gps) exifFields.gps = exif.gps;
      if (exif.width) exifFields.width = exif.width;
      if (exif.height) exifFields.height = exif.height;
      fields.exif = exifFields;
    }

    await writeFile(cardPath, `---\n${stringifyYaml(fields)}---\n`);
  }

  // Verify image cards were updated
  for (const cardFile of imageCardFiles) {
    const content = await box.read(join(attachRelDir, cardFile));
    t.ok(
      content.includes("status: analyzed") || content.includes("status: invalid"),
      `${cardFile} has analyzed/invalid status`
    );
  }

  // Commit the transcription + image analysis work
  box.commitAll("Transcribe audio and analyze images");

  // ── Step 3: Assemble Timeline ──

  const { ctx, getOutput } = createCollectorContext(box.root);
  const assembleResult = await runCommand({
    name: "assemble-timeline",
    args: {},
    ctx,
  });

  t.comment(getOutput());
  if (assembleResult.error) t.comment(`Error: ${assembleResult.error}`);
  t.ok(assembleResult.success, "assemble-timeline succeeded");

  // Verify the session card now has an assembled transcript body
  const sessionCard = await box.read(sessionCardRel);
  const transcriptBody = sessionCard.split(/\n---\n/).slice(1).join("\n---\n");
  t.ok(transcriptBody.trim().length > 0, "session card has an assembled transcript body");
  t.ok(sessionCard.includes("{% image "), "transcript has {% image %} markers");

  // ── Summary ──

  t.comment("Pipeline completed successfully:");
  t.comment(`  Transcription: ${transcriptionResult.words.length} words, ${Math.round(transcriptionResult.duration)}s`);
  t.comment(`  Images: ${geminiResult.analyses.length} analyzed`);
  t.comment(`  Timeline: assembled with text + image segments`);
});
