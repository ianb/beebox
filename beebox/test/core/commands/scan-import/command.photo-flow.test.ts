// # Photo flow end-to-end — `runPhotoMode` over a fake ScanVision backend
//
// The first test that drives `runPhotoMode` itself (older scan tests stop below
// the model call): a fake `ScanVision` service stands in for Claude/Gemini, and
// we assert on the cards, questions, and failure semantics the flow produces.
// Design: `docs/plans/scan-vision-claude.md`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { runPhotoMode } from "../../../../src/core/commands/scan-import/command.js";
import { createFakeScanVision } from "../../../../src/services/scan-vision.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { parseCardText } from "../../../../src/core/card-io.js";
import { createCardSchemaMap } from "../../../../src/schemas.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import Sharp from "sharp";
import type { ScanPageAnalysis } from "../../../../src/core/describe-images/gemini.js";
import type { TmpBox } from "../../../helpers/test-helpers.js";
import type { FakeScanVisionService } from "../../../../src/services/scan-vision.js";
import { isRecord } from "../../../../src/shared/is-record.js";

const schemas = await createCardSchemaMap();

// Seed page files OUTSIDE the box (originals stay untouched; the flow
// archives copies). The shared runner decodes and normalizes them before the
// fake backend sees them, so these are small but real JPEGs.
async function seedPages(box: TmpBox, count: number) {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = join(box.root, `page-${i}.jpg`);
    await Sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: i * 20, g: 40, b: 80 } },
    }).jpeg().toFile(p);
    paths.push(p);
  }
  return paths;
}

async function importPhotos({ box, vision, count }: { box: TmpBox; vision: FakeScanVisionService; count: number }) {
  const imagePaths = await seedPages(box, count);
  const { ctx } = createCollectorContext(box.root);
  const result = await runPhotoMode(ctx, { vision, imagePaths, sourcePdfPath: null, extraContext: undefined, source: undefined });
  // `data` is `unknown` on a CommandResult; the checks below read named counters off it.
  return { ...result, data: isRecord(result.data) ? result.data : {} };
}

/** A completed photo import: the session paths vary (timestamp and random suffix); the counts do not. */
function imported(counts: { photoCount: number; pairedCount: number; unsureCount: number; reviewQuestions: number }) {
  return {
    success: true,
    data: {
      mode: "photo",
      sessionRelDir: str`_content/inbox/scan-${any(String)}.attach`,
      sessionCardPath: str`_content/inbox/scan-${any(String)}.capture-session.card`,
      orphanBackCount: 0,
      blankCount: 0,
      intakeJobPaths: [any(String).matches(/^_bookkeeping\/jobs\/.+-inbox-[\da-f]{8}\.intake\.job\.card$/)],
      ...counts,
    },
  };
}

async function sessionDir(box: TmpBox) {
  const entries = await readdir(join(box.root, "_content/inbox"));
  return entries.find((e) => e.endsWith(".attach"));
}

async function sessionFiles(box: TmpBox) {
  const dir = await sessionDir(box);
  assert.ok(dir !== undefined);
  const files = await readdir(join(box.root, "_content/inbox", dir), { recursive: true });
  return files.toSorted().join("\n");
}

async function questionFiles(box: TmpBox) {
  const entries = await readdir(join(box.root, "_bookkeeping/questions")).catch(() => []);
  return entries.toSorted().join("\n");
}

// ## Happy path: pairs land as image cards with back text
//
// Four pages through the fake's default alternation (photo, back, photo, back).
// The fake's `batchSize` is 3, so `planScanBatches` produces overlapping batches
// `[0,1,2]` + `[2,3]` — page 2 is analyzed twice, and the reconciliation layer's
// mutual-claim preference picks the batch-2 analysis whose pair claim page 3
// reciprocates. Result: two photo bundles, each with its back.
void test("Four pages through the fake's default alternation (photo, back, photo, back).", async (t) => {
  const box = await makeTmpBox({ git: true });
  const vision = createFakeScanVision();
  const result = await importPhotos({ box, vision, count: 4 });
  t.check(result, imported({ photoCount: 2, pairedCount: 2, unsureCount: 0, reviewQuestions: 1 }));

  t.check(vision.calls.map((c) => c.imagePaths.length), [3, 2]);

  await t.checkText(await sessionFiles(box), `photo-001.attach
photo-001.attach/photo-001-back.jpg
photo-001.attach/photo-001.jpg
photo-001.image.card
photo-002.attach
photo-002.attach/photo-002-back.jpg
photo-002.attach/photo-002.jpg
photo-002.image.card`);

  // The image card carries the analysis: description and back text.

  const dir = await sessionDir(box);
  const cardText = await box.read(`_content/inbox/${dir}/photo-001.image.card`);
  const card = parseCardText(cardText, { source: "photo-001.image.card", schemas, type: "image" });
  t.check(card.fields, {
    type: "image",
    "has-text": true,
    filename: { ref: "attach/photo-001.jpg", via: { channel: "gallery", at: isoDate() } },
    description: "Fake photo 0",
    text: [{ surface: "back", content: "Fake back caption 1" }],
  });

  // The seam page's two analyses disagreed on pairing (the fake generates
  // batch-relative claims), so the overlap-conflict path flags photo 2 for
  // review — the designed behavior when overlapping batches disagree.

  t.check(await questionFiles(box), str`${any(String)}-photo-002.review.question.card`);
});

// ## Flagged pages produce review questions in `_bookkeeping/questions/`
//
// A page flagged for review (the Claude backend does this for any
// partial/illegible slot) emits a review question card alongside the image card.
void test("A page flagged for review (the Claude backend does this for any partial/illeg...", async (t) => {
  const flaggedPage = (i: number): ScanPageAnalysis => ({ index: i, kind: i === 0 ? "photo" : "back", paired_with_index: i === 0 ? 1 : 0, description: i === 0 ? "A flagged photo" : "", title: i === 0 ? "Flagged" : "", rotation: 0, subject_bbox: null, has_text: i !== 0, text_blocks: i === 0 ? [] : [{ source: "back", text: "M?" }], date_hint: null, flag_for_review: i !== 0, flag_reason: i !== 0 ? "Slots needing review: 2 (partial)" : null });
  const box2 = await makeTmpBox({ git: true });
  const vision2 = createFakeScanVision({ analyze: (paths) => paths.map((_, i) => flaggedPage(i)) });
  const result2 = await importPhotos({ box: box2, vision: vision2, count: 2 });
  t.check(result2, imported({ photoCount: 1, pairedCount: 1, unsureCount: 0, reviewQuestions: 1 }));

  t.check(await questionFiles(box2), str`${any(String)}-photo-001.review.question.card`);
});

// ## A `fatal` failure aborts the run cleanly
//
// Broken provider/config (bad key, unauthed host, dead SDK binary): the command
// fails with the classified message and stages nothing — no session dir, no
// cards, no questions.
void test("Broken provider/config (bad key, unauthed host, dead SDK binary):", async (t) => {
  const box3 = await makeTmpBox({ git: true });
  const vision3 = createFakeScanVision({ alwaysFailRetry: "fatal" });
  const result3 = await importPhotos({ box: box3, vision: vision3, count: 2 });
  t.check(result3, { success: false, error: "Scan analysis aborted: fake scan-vision failure (scripted)", data: {} });

  t.check((await readdir(join(box3.root, "_content/inbox"))).filter((name) => name.startsWith("scan-")), []);
});

// ## A `batch` failure degrades to flagged placeholder pages
//
// Non-fatal, non-splittable failures keep today's semantics: the batch's pages
// become `unsure` placeholders with questions, and the import still completes.
void test("Non-fatal, non-splittable failures keep today's semantics:", async (t) => {
  const box4 = await makeTmpBox({ git: true });
  const vision4 = createFakeScanVision({ alwaysFailRetry: "batch" });
  const result4 = await importPhotos({ box: box4, vision: vision4, count: 2 });
  t.check(result4, imported({ photoCount: 0, pairedCount: 0, unsureCount: 2, reviewQuestions: 2 }));

  await t.checkText(await questionFiles(box4), `«*»-unsure-001.question.card
«*»-unsure-002.question.card`);
});

// ## Transient failures retry and recover
//
// One transient failure, then success: the runner backs off, re-attempts the
// same batch, and the import proceeds normally. The failed attempt's usage is
// included in the run's accounting (visible in the command's token/cost lines).
void test("One transient failure, then success:", async (t) => {
  const box5 = await makeTmpBox({ git: true });
  const vision5 = createFakeScanVision({ failTimes: 1, failRetry: "transient" });
  const result5 = await importPhotos({ box: box5, vision: vision5, count: 2 });
  t.check(result5, imported({ photoCount: 1, pairedCount: 1, unsureCount: 0, reviewQuestions: 0 }));
  t.check(vision5.calls.map((c) => c.imagePaths.length), [2, 2]);
});
