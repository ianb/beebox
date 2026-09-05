# Photo flow end-to-end — `runPhotoMode` over a fake ScanVision backend

The first test that drives `runPhotoMode` itself (older scan tests stop below
the model call): a fake `ScanVision` service stands in for Claude/Gemini, and
we assert on the cards, questions, and failure semantics the flow produces.
Design: `docs/plans/scan-vision-claude.md`.

```ts setup
import { runPhotoMode } from "../../../src/core/commands/scan-import.js";
import { createFakeScanVision } from "../../../src/services/scan-vision.js";
import { createCollectorContext } from "../../../src/core/commands/index.js";
import { parseCardText } from "../../../src/core/card-io.js";
import { createCardSchemaMap } from "../../../src/schemas/registry.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import Sharp from "sharp";

const schemas = await createCardSchemaMap();

// Seed page files OUTSIDE the box (originals stay untouched; the flow
// archives copies). The shared runner decodes and normalizes them before the
// fake backend sees them, so these are small but real JPEGs.
async function seedPages(box, count) {
  const paths = [];
  for (let i = 0; i < count; i++) {
    const p = join(box.root, `page-${i}.jpg`);
    await Sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: i * 20, g: 40, b: 80 } },
    }).jpeg().toFile(p);
    paths.push(p);
  }
  return paths;
}

async function importPhotos(box, vision, count) {
  const imagePaths = await seedPages(box, count);
  const { ctx } = createCollectorContext(box.root);
  return runPhotoMode(ctx, { vision, imagePaths, sourcePdfPath: null, extraContext: undefined, source: undefined });
}

async function sessionDir(box) {
  const entries = await readdir(join(box.root, "_content/inbox"));
  return entries.find((e) => e.endsWith(".attach"));
}

async function sessionFiles(box) {
  const dir = await sessionDir(box);
  const files = await readdir(join(box.root, "_content/inbox", dir), { recursive: true });
  return files.sort().join("\n");
}

async function questionFiles(box) {
  const entries = await readdir(join(box.root, "_bookkeeping/questions")).catch(() => []);
  return entries.sort().join("\n");
}
```

## Happy path: pairs land as image cards with back text

Four pages through the fake's default alternation (photo, back, photo, back).
The fake's `batchSize` is 3, so `planScanBatches` produces overlapping batches
`[0,1,2]` + `[2,3]` — page 2 is analyzed twice, and the reconciliation layer's
mutual-claim preference picks the batch-2 analysis whose pair claim page 3
reciprocates. Result: two photo bundles, each with its back.

```ts
const box = await makeTmpBox({ git: true, annex: true });
const vision = createFakeScanVision();
const result = await importPhotos(box, vision, 4);
result.success
=> true

`photos=${result.data.photoCount} paired=${result.data.pairedCount} orphans=${result.data.orphanBackCount} unsure=${result.data.unsureCount}`
=> photos=2 paired=2 orphans=0 unsure=0

vision.calls.map((c) => c.imagePaths.length).join(",")
=> 3,2

await sessionFiles(box)
=> photo-001.attach
photo-001.attach/photo-001-back.jpg
photo-001.attach/photo-001.jpg
photo-001.image.card
photo-002.attach
photo-002.attach/photo-002-back.jpg
photo-002.attach/photo-002.jpg
photo-002.image.card
```

The image card carries the analysis: description, back text, `analyzed` status.

```ts continue
const dir = await sessionDir(box);
const cardText = await box.read(`_content/inbox/${dir}/photo-001.image.card`);
const card = parseCardText(cardText, { source: "photo-001.image.card", schemas, type: "image" });
`${card.fields["status"]} | ${card.fields["description"]} | ${card.fields["text"]?.[0]?.content}`
=> analyzed | Fake photo 0 | Fake back caption 1
```

The seam page's two analyses disagreed on pairing (the fake generates
batch-relative claims), so the overlap-conflict path flags photo 2 for
review — the designed behavior when overlapping batches disagree.

```ts continue
await questionFiles(box)
=> «*»-photo-002.review.question.card
```

## Flagged pages produce review questions in `_bookkeeping/questions/`

A page flagged for review (the Claude backend does this for any
partial/illegible slot) emits a review question card alongside the image card.

```ts
const flaggedPage = (i, count) => ({ index: i, kind: i === 0 ? "photo" : "back", paired_with_index: i === 0 ? 1 : 0, description: i === 0 ? "A flagged photo" : "", title: i === 0 ? "Flagged" : "", rotation: 0, subject_bbox: null, has_text: i !== 0, text_blocks: i === 0 ? [] : [{ source: "back", text: "M?" }], date_hint: null, flag_for_review: i !== 0, flag_reason: i !== 0 ? "Slots needing review: 2 (partial)" : null });
const box2 = await makeTmpBox({ git: true, annex: true });
const vision2 = createFakeScanVision({ analyze: (paths) => paths.map((_, i) => flaggedPage(i, paths.length)) });
const result2 = await importPhotos(box2, vision2, 2);
`${result2.success} questions=${result2.data.reviewQuestions}`
=> true questions=1

await questionFiles(box2)
=> «*»-photo-001.review.question.card
```

## A `fatal` failure aborts the run cleanly

Broken provider/config (bad key, unauthed host, dead SDK binary): the command
fails with the classified message and stages nothing — no session dir, no
cards, no questions.

```ts
const box3 = await makeTmpBox({ git: true, annex: true });
const vision3 = createFakeScanVision({ alwaysFailRetry: "fatal" });
const result3 = await importPhotos(box3, vision3, 2);
`${result3.success} | ${result3.error}`
=> false | Scan analysis aborted: fake scan-vision failure (scripted)

(await readdir(join(box3.root, "_content/inbox"))).filter((name) => name.startsWith("scan-")).length
=> 0
```

## A `batch` failure degrades to flagged placeholder pages

Non-fatal, non-splittable failures keep today's semantics: the batch's pages
become `unsure` placeholders with questions, and the import still completes.

```ts
const box4 = await makeTmpBox({ git: true, annex: true });
const vision4 = createFakeScanVision({ alwaysFailRetry: "batch" });
const result4 = await importPhotos(box4, vision4, 2);
`${result4.success} unsure=${result4.data.unsureCount} photos=${result4.data.photoCount}`
=> true unsure=2 photos=0

await questionFiles(box4)
=> «*»-unsure-001.question.card
«*»-unsure-002.question.card
```

## Transient failures retry and recover

One transient failure, then success: the runner backs off, re-attempts the
same batch, and the import proceeds normally. The failed attempt's usage is
included in the run's accounting (visible in the command's token/cost lines).

```ts
const box5 = await makeTmpBox({ git: true, annex: true });
const vision5 = createFakeScanVision({ failTimes: 1, failRetry: "transient" });
const result5 = await importPhotos(box5, vision5, 2);
`${result5.success} photos=${result5.data.photoCount} calls=${vision5.calls.length}`
=> true photos=1 calls=2
```
