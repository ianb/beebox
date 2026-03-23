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
import { test } from "tap";
import type { ElementNode } from "cardworks";
import { createLoader } from "../src/cli/lib/loader.js";
import { runCommand, createCollectorContext } from "../src/core/command-runner.js";
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

  const captureDir = join(box.root, "box/inbox", CAPTURE_DIR_NAME);

  // ── Step 1: Transcription ──

  const audioCardPath = join(captureDir, "audio-001.audio.card");
  const audioFilePath = join(captureDir, "audio-001.webm");

  // Use whisper for recording — it reliably returns word timestamps
  // (Voxtral doesn't always return them)
  await box.write("config/transcription.json", JSON.stringify({ service: "whisper" }));

  const transcriptionResult = await replay.recordOrReplay(
    "transcription-audio-001",
    async () => {
      t.comment("Recording: calling transcription API (whisper)...");
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
  const loader = await createLoader(box.root);
  const cardDir = join("box/inbox", CAPTURE_DIR_NAME);
  const audioCard = await loader.load(box.path(join(cardDir, "audio-001.audio.card")));
  const audioEl = audioCard.element;
  const audioChildren = audioEl.children as ElementNode[];

  const transcriptEl = audioChildren.find((c) => c.tagName === "transcript");
  if (transcriptEl) {
    transcriptEl.text = transcriptionResult.text;
    transcriptEl.dirty = true;
  }

  const filenameEl = audioChildren.find((c) => c.tagName === "filename");
  if (filenameEl) {
    filenameEl.attrs["duration"] = `${Math.round(transcriptionResult.duration)}s`;
    filenameEl.dirty = true;
  }

  audioEl.attrs["status"] = "transcribed";
  audioEl.dirty = true;
  await loader.save(audioCard);

  // Write timing JSON sidecar
  const timingPath = join(captureDir, "audio-001.timing.json");
  await writeFile(timingPath, JSON.stringify({
    words: transcriptionResult.words,
    duration: transcriptionResult.duration,
    language: transcriptionResult.language,
  }, null, 2) + "\n");

  // Verify card was updated
  const updatedAudioCard = await box.read(join("box/inbox", CAPTURE_DIR_NAME, "audio-001.audio.card"));
  t.ok(updatedAudioCard.includes('status="transcribed"'), "audio card status is transcribed");
  t.ok(updatedAudioCard.includes("duration="), "audio card has duration");

  // ── Step 2: Image Analysis ──

  const imageFiles = ["photo-001.jpg", "photo-002.jpg", "photo-003.jpg"];
  const imagePaths = imageFiles.map((f) => join(captureDir, f));

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
    const cardRelPath = join(cardDir, imageCardFiles[i]);
    const card = await loader.load(box.path(cardRelPath));
    const el = card.element;
    const analysis = geminiResult.analyses.find((a: ImageAnalysis) => a.index === i);

    if (!analysis) {
      t.fail(`No analysis for image ${i}`);
      continue;
    }

    el.attrs["status"] = analysis.invalid ? "invalid" : "analyzed";
    el.attrs["has-text"] = analysis.has_text ? "true" : "false";

    const descChild = el.children.find((c: ElementNode) => c.tagName === "description");
    if (descChild) {
      descChild.text = analysis.description;
      descChild.dirty = true;
    }

    // Update captured date from EXIF
    const exif = exifResults[i];
    if (exif && exif.date) {
      const fnChild = el.children.find((c: ElementNode) => c.tagName === "filename");
      if (fnChild) {
        fnChild.attrs["captured"] = exif.date;
        fnChild.dirty = true;
      }
    }

    // Add text blocks
    el.children = el.children.filter((c: ElementNode) => c.tagName !== "text" && c.tagName !== "exif");
    for (const block of analysis.text_blocks) {
      el.children.push({
        tagName: "text",
        attrs: { source: block.source },
        text: block.text,
        children: [],
        comments: {},
        location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
        dirty: true,
      });
    }

    // Add EXIF element
    if (exif) {
      const exifAttrs: Record<string, string> = {};
      if (exif.date) exifAttrs["date"] = exif.date;
      if (exif.camera) exifAttrs["camera"] = exif.camera;
      if (exif.gps) exifAttrs["gps"] = exif.gps;
      if (exif.width) exifAttrs["width"] = exif.width;
      if (exif.height) exifAttrs["height"] = exif.height;
      el.children.push({
        tagName: "exif",
        attrs: exifAttrs,
        children: [],
        comments: {},
        location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
        dirty: true,
      });
    }

    el.dirty = true;
    await loader.save(card);
  }

  // Verify image cards were updated
  for (const cardFile of imageCardFiles) {
    const content = await box.read(join("box/inbox", CAPTURE_DIR_NAME, cardFile));
    t.ok(
      content.includes('status="analyzed"') || content.includes('status="invalid"'),
      `${cardFile} has analyzed/invalid status`
    );
  }

  // Commit the transcription + image analysis work
  box.commitAll("Transcribe audio and analyze images");

  // ── Step 3: Assemble Timeline ──

  // Commands assume CWD = boxRoot (as the CLI sets it)
  const savedCwd = process.cwd();
  process.chdir(box.root);

  const { ctx, getOutput } = createCollectorContext(box.root);
  const assembleResult = await runCommand({
    name: "assemble-timeline",
    args: {},
    ctx,
  });

  process.chdir(savedCwd);

  t.comment(getOutput());
  if (assembleResult.error) t.comment(`Error: ${assembleResult.error}`);
  t.ok(assembleResult.success, "assemble-timeline succeeded");

  // Verify the session card now has a structured transcript
  const sessionCard = await box.read(
    join("box/inbox", CAPTURE_DIR_NAME, `${CAPTURE_DIR_NAME}.capture-session.card`)
  );
  t.ok(sessionCard.includes("<text>"), "session card has <text> elements in transcript");
  t.ok(sessionCard.includes("<image "), "session card has <image> elements in transcript");
  t.notOk(
    sessionCard.includes("<transcript/>"),
    "session card no longer has empty <transcript/>"
  );

  // ── Summary ──

  t.comment("Pipeline completed successfully:");
  t.comment(`  Transcription: ${transcriptionResult.words.length} words, ${Math.round(transcriptionResult.duration)}s`);
  t.comment(`  Images: ${geminiResult.analyses.length} analyzed`);
  t.comment(`  Timeline: assembled with text + image segments`);
});
