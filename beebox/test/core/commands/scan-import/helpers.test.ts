// # Scan Import Helpers
//
// Helpers for the `scan-import` command: sliding-overlap batch planning, pair reconciliation across overlapping batches, and bundling resolved pages into photo/back groups.

import { test } from "tap";
import "agent-doctest/tap";
import { any, not, str } from "agent-doctest/check";
import {
  planScanBatches,
  runScanBatches,
  resolveScanPages,
  bundleResolvedPages,
  buildScanPrompt,
  type ScanPageAnalysis,
} from "../../../../src/core/commands/scan-import/helpers.js";
import type { ScanVisionService } from "../../../../src/services/scan-vision.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import Sharp from "sharp";

function photo(index: number, paired?: number | null): ScanPageAnalysis {
  return {
    index,
    kind: "photo",
    paired_with_index: paired ?? null,
    description: `Photo ${index}`,
    title: `Photo_${index}`,
    rotation: 0,
    subject_bbox: null,
    has_text: false,
    text_blocks: [],
    date_hint: null,
    flag_for_review: false,
    flag_reason: null,
  };
}

// `claim` names the partner page and the back's text; a bare `back(i)` is a textless back with no partner.
function back(index: number, claim?: { paired?: number | null; text?: string }): ScanPageAnalysis {
  const text = claim?.text ?? "";
  return {
    index,
    kind: "back",
    paired_with_index: claim?.paired ?? null,
    description: "",
    title: "",
    rotation: 0,
    subject_bbox: null,
    has_text: text.length > 0,
    text_blocks: text ? [{ source: "back", text }] : [],
    date_hint: null,
    flag_for_review: false,
    flag_reason: null,
  };
}

// ## Every backend receives the same bounded JPEG
//
// The archive may contain a TIFF, WebP, AVIF, or a very large phone original. The shared
// runner applies the former Claude recipe once—EXIF rotation, 2000px long edge,
// JPEG quality 88—before either backend sees a path. Thus Gemini never inlines
// the raw TIFF, while Claude receives the same bytes it did before the hoist.
void test("The archive may contain a TIFF, WebP, AVIF, or a very large phone original.", async (t) => {
  t.teardown(async () => {
    try {
      await normalizeBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const normalizeBox = await makeTmpBox();
  const originalPath = join(normalizeBox.root, "oversized-original.tiff");
  await Sharp({
    create: { width: 3200, height: 1200, channels: 3, background: { r: 30, g: 80, b: 120 } },
  }).tiff({ compression: "none" }).toFile(originalPath);

  const expectedBytes = await Sharp(originalPath)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const observations: Array<{ backend: "claude" | "gemini"; imagePath: string; bytes: Buffer; metadata: Awaited<ReturnType<ReturnType<typeof Sharp>["metadata"]>> }> = [];
  function recordingVision(backend: "claude" | "gemini"): ScanVisionService {
    return {
      backend,
      batchSize: 8,
      async analyzeBatch({ imagePaths }) {
        const imagePath = imagePaths[0];
        assert.ok(imagePath !== undefined);
        const bytes = await readFile(imagePath);
        const metadata = await Sharp(bytes).metadata();
        observations.push({ backend, imagePath, bytes, metadata });
        return { analyses: [photo(0)], usage: null, costUsd: null };
      },
    };
  }

  await runScanBatches({ vision: recordingVision("claude"), imagePaths: [originalPath] });
  await runScanBatches({ vision: recordingVision("gemini"), imagePaths: [originalPath] });
  const originalBytes = (await stat(originalPath)).size;
  t.check(
    {
      originalBytes,
      backends: observations.map((item) => item.backend),
      extensions: observations.map((item) => extname(item.imagePath)),
      formats: observations.map((item) => item.metadata.format),
      dimensions: observations.map((item) => [item.metadata.width, item.metadata.height]),
      // Buffers cannot be compared by value; byte equality with the recipe's output is the check.
      bytesEqualRecipe: observations.map((item) => item.bytes.equals(expectedBytes)),
      sizes: observations.map((item) => item.bytes.length),
    },
    {
      originalBytes: any(Number).above(8 * 1024 * 1024),
      backends: ["claude", "gemini"],
      extensions: [".jpg", ".jpg"],
      formats: ["jpeg", "jpeg"],
      dimensions: [[2000, 750], [2000, 750]],
      bytesEqualRecipe: [true, true],
      sizes: [any(Number).below(originalBytes), any(Number).below(originalBytes)],
    },
  );
});

// ## New WebP and retained AVIF inputs still reach providers as JPEG scratch files
//
// The archive remains byte-for-byte intact; provider compatibility applies only
// to temporary scan-analysis files.
void test("The archive remains byte-for-byte intact; provider compatibility applies only...", async (t) => {
  t.teardown(async () => {
    try {
      await formatBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const formatBox = await makeTmpBox();
  const formatInputs = [];
  for (const format of ["webp", "avif"] as const) {
    const path = join(formatBox.root, `source.${format}`);
    const pipeline = Sharp({ create: { width: 12, height: 8, channels: 3, background: { r: 20, g: 90, b: 140 } } });
    await (format === "webp" ? pipeline.webp() : pipeline.avif()).toFile(path);
    formatInputs.push({ path, original: await readFile(path) });
  }
  const formatsSeen: Array<{ extension: string; format: string | undefined }> = [];
  await runScanBatches({
    vision: {
      backend: "claude",
      batchSize: 8,
      async analyzeBatch({ imagePaths }) {
        for (const imagePath of imagePaths) formatsSeen.push({ extension: extname(imagePath), format: (await Sharp(imagePath).metadata()).format });
        return { analyses: imagePaths.map((_path, index) => photo(index)), usage: null, costUsd: null };
      },
    },
    imagePaths: formatInputs.map((item) => item.path),
  });
  t.check(
    {
      formats: formatsSeen,
      originalsUnchanged: await Promise.all(formatInputs.map(async (item) => (await readFile(item.path)).equals(item.original))),
    },
    {
    formats: [
      {
        extension: ".jpg",
        format: "jpeg",
      },
      {
        extension: ".jpg",
        format: "jpeg",
      },
    ],
    originalsUnchanged: [
      true,
      true,
    ],
  },
  );
});

// ## Sliding-overlap batch planning
//
// A larger PDF gets split with one-page overlap so any pair straddling a seam still appears in some batch together:
void test("A larger PDF gets split with one-page overlap so any pair straddling a seam s...", async (t) => {
  t.check(planScanBatches(20, 8).map(p => p.globalIndices), [
    [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
    ],
    [
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
    ],
    [
      14,
      15,
      16,
      17,
      18,
      19,
    ],
  ]);
});

// Exactly batch-size yields one batch:
void test("Exactly batch-size yields one batch:", async (t) => {
  t.check(planScanBatches(8, 8).map(p => p.globalIndices), [
    [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
    ],
  ]);
});

// Empty PDF yields no batches:
void test("Empty PDF yields no batches:", async (t) => {
  t.check(planScanBatches(0, 8), []);
});

// ## Pair reconciliation: mutual claims survive
//
// When both pages in a pair name each other, the pair is finalized:
void test("When both pages in a pair name each other, the pair is finalized:", async (t) => {
  const pages = new Map<number, ScanPageAnalysis[]>();
  pages.set(0, [photo(0, 1)]);
  pages.set(1, [back(1, { paired: 0, text: "Mom, 1985" })]);
  const resolved = resolveScanPages(pages, 2);
  t.check(resolved.map(r => ({ index: r.index, kind: r.analysis.kind, pairedWith: r.pairedWith })), [
    { index: 0, kind: "photo", pairedWith: 1 },
    { index: 1, kind: "back", pairedWith: 0 },
  ]);
});

// When only one side names a partner, the pair does NOT survive — the partner has to reciprocate:
void test("When only one side names a partner, the pair does NOT survive — the partner h...", async (t) => {
  const pages2 = new Map<number, ScanPageAnalysis[]>();
  pages2.set(0, [photo(0, 1)]);
  pages2.set(1, [back(1, { text: "Mom" })]);  // back didn't name page 0
  const resolved2 = resolveScanPages(pages2, 2);
  t.check(resolved2.map(r => ({ index: r.index, pairedWith: r.pairedWith, conflict: r.conflict })), [
    { index: 0, pairedWith: null, conflict: true },
    { index: 1, pairedWith: null, conflict: false },
  ]);
});

// ## Pair reconciliation: overlap dedup
//
// A page that appears in two batches with consistent claims gets the pair resolved cleanly:
void test("A page that appears in two batches with consistent claims gets the pair resol...", async (t) => {
  const pages3 = new Map<number, ScanPageAnalysis[]>();
  // Page 7 appears in batch [0..7] paired with 6, AND in batch [7..14] paired with 6 (impossible — 6 not in second batch).
  // More realistic: batch A pairs 6↔7, batch B sees 7 as singleton (since its partner 6 is in batch A only).
  pages3.set(6, [photo(6, 7)]);
  pages3.set(7, [back(7, { paired: 6, text: "Beach" }), back(7, { text: "Beach" })]);
  const resolved3 = resolveScanPages(pages3, 8);
  t.check(resolved3[7], { index: 7, analysis: back(7, { paired: 6, text: "Beach" }), pairedWith: 6, conflict: true });
});

// The analyzer that named a partner wins over the one that didn't.
//
// ## Pair reconciliation: mutual claims beat unreciprocated ones
//
// When both overlapping batches named a partner for the same page, the claim
// the partner actually reciprocates wins — even when it came from the first
// batch (the old rule arbitrarily took the second):
void test("The analyzer that named a partner wins over the one that didn't.", async (t) => {
  const pages4 = new Map<number, ScanPageAnalysis[]>();
  // Batch A saw 4↔5 mutually; batch B misread page 5 as paired forward with 6.
  pages4.set(4, [photo(4, 5)]);
  pages4.set(5, [back(5, { paired: 4, text: "Lake" }), back(5, { paired: 6, text: "Lake" })]);
  pages4.set(6, [photo(6, null)]);
  const resolved4 = resolveScanPages(pages4, 8);
  t.check([resolved4[4], resolved4[5]], [
    { index: 4, analysis: photo(4, 5), pairedWith: 5, conflict: false },
    { index: 5, analysis: back(5, { paired: 4, text: "Lake" }), pairedWith: 4, conflict: true },
  ]);
});

// ## Bundling: photo + back
//
// Photos with mutual back partners become bundles:
void test("Photos with mutual back partners become bundles:", async (t) => {
  const pages4 = new Map<number, ScanPageAnalysis[]>();
  pages4.set(0, [photo(0, 1)]);
  pages4.set(1, [back(1, { paired: 0, text: "Family reunion 1985" })]);
  const resolved4 = resolveScanPages(pages4, 2);
  const result = bundleResolvedPages(resolved4);
  t.check(result, {
    bundles: [
      {
        photoIndex: 0,
        backIndex: 1,
        photo: photo(0, 1),
        back: back(1, { paired: 0, text: "Family reunion 1985" }),
        flagForReview: false,
        flagReasons: [],
      },
    ],
    orphanBacks: [],
    unsurePages: [],
    blankPages: [],
  });
});

// ## Bundling: orphan back
//
// A text-bearing back page that nobody paired with becomes an orphan:
void test("A text-bearing back page that nobody paired with becomes an orphan:", async (t) => {
  const pages5 = new Map<number, ScanPageAnalysis[]>();
  pages5.set(0, [photo(0, null)]);
  pages5.set(1, [back(1, { text: "Cousin Bill" })]);
  const result5 = bundleResolvedPages(resolveScanPages(pages5, 2));
  t.check(result5, {
    bundles: [{ photoIndex: 0, backIndex: null, photo: photo(0, null), back: null, flagForReview: false, flagReasons: [] }],
    orphanBacks: [{ index: 1, analysis: back(1, { text: "Cousin Bill" }) }],
    unsurePages: [],
    blankPages: [],
  });
});

// The unpartnered photo still becomes a singleton bundle (no back).
//
// ## Bundling: blank pages dropped
void test("The unpartnered photo still becomes a singleton bundle (no back).", async (t) => {
  const pages6 = new Map<number, ScanPageAnalysis[]>();
  pages6.set(0, [photo(0, null)]);
  pages6.set(1, [{ ...back(1), kind: "blank", has_text: false, text_blocks: [] }]);
  const result6 = bundleResolvedPages(resolveScanPages(pages6, 2));
  t.check(result6, {
    bundles: [{ photoIndex: 0, backIndex: null, photo: photo(0, null), back: null, flagForReview: false, flagReasons: [] }],
    orphanBacks: [],
    unsurePages: [],
    blankPages: [1],
  });
});

// ## Boxholder context wrapping
//
// With no context, the prompt is unchanged from the base instructions:
void test("With no context, the prompt is unchanged from the base instructions:", async (t) => {
  const base = buildScanPrompt(null);
  const withContext = buildScanPrompt("Tomas, Noor, Delia are recurring people. Photos from 1965-1985.");
  // `base` is the large generated instruction text; the check is that it has no boxholder section, and that the context wraps it.
  t.check(base, not(any(String).includes("boxholder")));
  t.check(withContext, str`# Context from the boxholder

${any(String)}

---

Tomas, Noor, Delia are recurring people. Photos from 1965-1985.

---

${base}`);
});

// Empty/whitespace context is treated as no context:
void test("Empty/whitespace context is treated as no context:", async (t) => {
  const blank = buildScanPrompt("   \n\n  ");
  t.check(blank, buildScanPrompt(null));
});

// ## Flag propagation
//
// A flagged photo or back surfaces in the bundle's flagReasons:
void test("A flagged photo or back surfaces in the bundle's flagReasons:", async (t) => {
  const pages7 = new Map<number, ScanPageAnalysis[]>();
  pages7.set(0, [photo(0, 1)]);
  pages7.set(1, [{ ...back(1, { paired: 0, text: "?? hard to read" }), flag_for_review: true, flag_reason: "Handwriting unclear" }]);
  const result7 = bundleResolvedPages(resolveScanPages(pages7, 2));
  t.check(result7.bundles, [
    {
      photoIndex: 0,
      backIndex: 1,
      photo: photo(0, 1),
      back: { ...back(1, { paired: 0, text: "?? hard to read" }), flag_for_review: true, flag_reason: "Handwriting unclear" },
      flagForReview: true,
      flagReasons: ["Back: Handwriting unclear"],
    },
  ]);
});
