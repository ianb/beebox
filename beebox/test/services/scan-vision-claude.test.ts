// # ClaudeScanVision — wire schema and the parse boundary
//
// The Claude scan backend's testable core, no SDK subprocess involved: the
// generated wire schema, and `parseClaudeScanBatch` — the boundary from a raw
// `structured_output` value to post-conditioned `RawScanAnalysis[]` (Zod
// validation, slot invariant, legibility→flag folding, batch alignment).
// Design: `docs/plans/scan-vision-claude.md`.

import { test } from "tap";
import "agent-doctest/tap";
import {
  claudeScanWireSchema,
  parseClaudeScanBatch,
} from "../../src/services/scan-vision-claude.js";
import { ScanVisionBatchError } from "../../src/services/scan-vision.js";
import { z } from "zod";

/** The parts of the generated JSON Schema the checks below read. */
const WireSchema = z.object({
  properties: z.object({
    pages: z.object({
      items: z.object({
        properties: z.object({
          index: z.unknown(),
          subject_bbox: z.unknown(),
          rotation: z.object({ anyOf: z.array(z.object({ const: z.number() })) }),
        }),
        required: z.array(z.string()),
      }),
    }),
  }),
});

/** Run a parse that must throw a batch error; null when it did not throw. */
function caught(run: () => unknown): ScanVisionBatchError | null {
  try {
    run();
    return null;
  } catch (e) {
    if (e instanceof ScanVisionBatchError) return e;
    throw e;
  }
}

/** A well-formed Claude-shaped page with overridable fields. */
function page(index: number, overrides?: Record<string, unknown>) {
  return {
    index,
    kind: "back",
    paired_with_index: null,
    description: "",
    title: "",
    rotation: 0,
    subject_bbox: null,
    has_text: true,
    text_blocks: [{ source: "back", text: "May 1985" }],
    date_hint: "May 1985",
    flag_for_review: false,
    flag_reason: null,
    slot_count: 1,
    slots: [{ slot: 1, label: "line 1", text: "May 1985", legibility: "clear" }],
    ...overrides,
  };
}
const meta = { imageCount: 1, usage: { prompt: 1000, output: 100, thinking: 0 }, costUsd: 0.05 };

// ## The generated wire schema
//
// Generated from the Zod schema (`rawScanAnalysisSchema` extended + tightened) —
// no hand-written third schema. `z.int()`'s vacuous MAX_SAFE_INTEGER bounds are
// stripped, rotation is a four-value enum, and `subject_bbox` only admits null.
void test("Generated from the Zod schema (rawScanAnalysisSchema extended + tightened) —...", async (t) => {
  // doctest:L74
  const schema = claudeScanWireSchema();
  const pages = WireSchema.parse(schema).properties.pages;
  t.check(pages.items.properties.index, {
    type: "integer",
  });

  // doctest:L79
  t.check(pages.items.properties.subject_bbox, {
    type: "null",
  });

  // doctest:L82
  t.check(pages.items.properties.rotation.anyOf.map((v) => v.const).join(","), "0,90,180,270");

  // doctest:L85
  await t.checkText(pages.items.required.includes("slot_count") && pages.items.required.includes("slots"), "true");

  // doctest:L88
  await t.checkText(JSON.stringify(schema).includes("9007199254740991"), "false");

  // doctest:L91
  await t.checkText("$schema" in schema, "false");
});

// ## Happy path: slots stripped, clear pages unflagged
void test("Happy path: slots stripped, clear pages unflagged", async (t) => {
  // doctest:L98
  const ok = parseClaudeScanBatch({ pages: [page(0)] }, meta);
  await t.checkText(ok.length, "1");

  // doctest:L102
  t.check(Object.keys(ok[0] ?? {}).filter((k) => k.startsWith("slot")), []);

  // doctest:L105
  t.check(ok[0]?.flag_for_review, false);
});

// ## Legibility folds into the review channel
//
// Any non-`clear` slot forces `flag_for_review` and names the slots — "these
// rows need review", through the existing question-card flow.
void test("Any non-clear slot forces flagforreview and names the slots — \"these rows nee...", async (t) => {
  // doctest:L115
  const hardSlots = [{ slot: 1, label: "row 1", text: "Dana", legibility: "clear" }, { slot: 2, label: "row 2", text: "M?", legibility: "partial" }, { slot: 3, label: "row 3", text: "(7 letters, starts H)", legibility: "illegible" }];
  const flagged = parseClaudeScanBatch({ pages: [page(0, { slot_count: 3, slots: hardSlots })] }, meta);
  t.check(flagged[0]?.flag_for_review, true);

  // doctest:L120
  t.check(flagged[0]?.flag_reason, "Slots needing review: 2 (partial), 3 (illegible)");

  // doctest:L123
  const withReason = parseClaudeScanBatch({ pages: [page(0, { slot_count: 3, slots: hardSlots, flag_for_review: true, flag_reason: "hard handwriting" })] }, meta);
  t.check(withReason[0]?.flag_reason, "hard handwriting; Slots needing review: 2 (partial), 3 (illegible)");
});

// ## Post-conditions fail loudly, classified for the runner
//
// A non-null bbox never parses (we refuse Claude's boxes — measured systematic
// y-offset), a broken slot enumeration is a `"split"`-classified error, and a
// misaligned batch can never misattach cards. Every error carries the failed
// attempt's usage/cost for the runner's accounting.
void test("A non-null bbox never parses (we refuse Claude's boxes — measured systematic...", async (t) => {
  // doctest:L136
  const badBbox = caught(() => parseClaudeScanBatch({ pages: [page(0, { subject_bbox: [1, 2, 3, 4] })] }, meta));
  t.check(`${badBbox?.name}: retry=${badBbox?.retry}`, "ClaudeScanSchemaError: retry=split");

  // doctest:L140
  const badSlots = caught(() => parseClaudeScanBatch({ pages: [page(0, { slot_count: 2 })] }, meta));
  t.check(`${badSlots?.name}: retry=${badSlots?.retry} usage=${badSlots?.usage?.prompt}`, "ScanSlotInvariantError: retry=split usage=1000");

  // doctest:L144
  const badNumbering = caught(() => parseClaudeScanBatch({ pages: [page(0, { slot_count: 2, slots: [{ slot: 1, label: "a", text: "x", legibility: "clear" }, { slot: 3, label: "b", text: "y", legibility: "clear" }] })] }, meta));
  t.check(badNumbering?.name, "ScanSlotInvariantError");

  // doctest:L148
  const misaligned = caught(() => parseClaudeScanBatch({ pages: [page(1)] }, meta));
  t.check(`${misaligned?.name}: retry=${misaligned?.retry}`, "ScanVisionBatchError: retry=split");

  // doctest:L152
  const wrongCount = caught(() => parseClaudeScanBatch({ pages: [page(0), page(1)] }, meta));
  t.check(wrongCount?.retry, "split");
});

// A rotation outside 0/90/180/270 is a schema failure, not a card-corrupting
// value (the image card schema only accepts those four).
void test("A rotation outside 0/90/180/270 is a schema failure, not a card-corrupting va...", async (t) => {
  // doctest:L161
  const badRotation = caught(() => parseClaudeScanBatch({ pages: [page(0, { rotation: 45 })] }, meta));
  t.check(badRotation?.name, "ClaudeScanSchemaError");
});
