// # ClaudeScanVision — wire schema and the parse boundary
//
// The Claude scan backend's testable core, no SDK subprocess involved: the
// generated wire schema, and `parseClaudeScanBatch` — the boundary from a raw
// `structured_output` value to post-conditioned `RawScanAnalysis[]` (Zod
// validation, slot invariant, legibility→flag folding, batch alignment).
// Design: `docs/plans/scan-vision-claude.md`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, instanceOf } from "@ianbicking/tap-check/check";
import {
  claudeScanWireSchema,
  parseClaudeScanBatch,
} from "../../../src/services/scan-vision-claude/core.js";
import { ScanVisionBatchError } from "../../../src/services/scan-vision.js";

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
void test("Generated from the Zod schema", async (t) => {
  const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });
  const rotation = (const_: number) => ({ type: "number", const: const_ });
  const required = (...names: string[]) => names;
  t.check(claudeScanWireSchema(), {
    type: "object",
    properties: {
      pages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            kind: { type: "string", enum: ["photo", "back", "blank", "unsure"] },
            paired_with_index: nullable("integer"),
            description: { type: "string" },
            title: { type: "string" },
            rotation: { anyOf: [rotation(0), rotation(90), rotation(180), rotation(270)] },
            subject_bbox: { type: "null" },
            has_text: { type: "boolean" },
            text_blocks: {
              type: "array",
              items: {
                type: "object",
                properties: { source: { type: "string" }, text: { type: "string" } },
                required: required("source", "text"),
                additionalProperties: false,
              },
            },
            date_hint: nullable("string"),
            flag_for_review: { type: "boolean" },
            flag_reason: nullable("string"),
            slot_count: { type: "integer" },
            slots: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  slot: { type: "integer" },
                  label: { type: "string" },
                  text: { type: "string" },
                  legibility: { type: "string", enum: ["clear", "partial", "illegible"] },
                },
                required: required("slot", "label", "text", "legibility"),
                additionalProperties: false,
              },
            },
          },
          required: required(
            "index", "kind", "paired_with_index", "description", "title", "rotation", "subject_bbox",
            "has_text", "text_blocks", "date_hint", "flag_for_review", "flag_reason", "slot_count", "slots",
          ),
          additionalProperties: false,
        },
      },
    },
    required: ["pages"],
    additionalProperties: false,
  });
});

// ## Happy path: slots stripped, clear pages unflagged
void test("Happy path: slots stripped, clear pages unflagged", async (t) => {
  t.check(parseClaudeScanBatch({ pages: [page(0)] }, meta), [
    {
      index: 0,
      kind: "back" as const,
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
    },
  ]);
});

// ## Legibility folds into the review channel
//
// Any non-`clear` slot forces `flag_for_review` and names the slots — "these
// rows need review", through the existing question-card flow.
void test("Any non-clear slot forces flagforreview and names the slots — \"these rows nee...", async (t) => {
  const hardSlots = [{ slot: 1, label: "row 1", text: "Dana", legibility: "clear" }, { slot: 2, label: "row 2", text: "M?", legibility: "partial" }, { slot: 3, label: "row 3", text: "(7 letters, starts H)", legibility: "illegible" }];
  const flaggedPage = {
    index: 0,
    kind: "back" as const,
    paired_with_index: null,
    description: "",
    title: "",
    rotation: 0,
    subject_bbox: null,
    has_text: true,
    text_blocks: [{ source: "back", text: "May 1985" }],
    date_hint: "May 1985",
    flag_for_review: true,
  };
  const flagged = parseClaudeScanBatch({ pages: [page(0, { slot_count: 3, slots: hardSlots })] }, meta);
  t.check(flagged, [{ ...flaggedPage, flag_reason: "Slots needing review: 2 (partial), 3 (illegible)" }]);

  const withReason = parseClaudeScanBatch({ pages: [page(0, { slot_count: 3, slots: hardSlots, flag_for_review: true, flag_reason: "hard handwriting" })] }, meta);
  t.check(withReason, [{ ...flaggedPage, flag_reason: "hard handwriting; Slots needing review: 2 (partial), 3 (illegible)" }]);
});

// ## Post-conditions fail loudly, classified for the runner
//
// A non-null bbox never parses (we refuse Claude's boxes — measured systematic
// y-offset), a broken slot enumeration is a `"split"`-classified error, and a
// misaligned batch can never misattach cards. Every error carries the failed
// attempt's usage/cost for the runner's accounting.
void test("A non-null bbox never parses (we refuse Claude's boxes — measured systematic...", async (t) => {
  const accounting = { retry: "split" as const, usage: { prompt: 1000, output: 100, thinking: 0 }, costUsd: 0.05 };

  const badBbox = caught(() => parseClaudeScanBatch({ pages: [page(0, { subject_bbox: [1, 2, 3, 4] })] }, meta));
  t.check(badBbox, instanceOf(ScanVisionBatchError));
  t.check(badBbox, {
    name: "ClaudeScanSchemaError",
    message: any(String).startsWith("Claude scan output failed schema validation: "),
    ...accounting,
  });

  const slotInvariant = { name: "ScanSlotInvariantError", message: "page 0 broke the slot invariant (slot_count vs slots numbering)", ...accounting };
  const badSlots = caught(() => parseClaudeScanBatch({ pages: [page(0, { slot_count: 2 })] }, meta));
  t.check(badSlots, instanceOf(ScanVisionBatchError));
  t.check(badSlots, slotInvariant);

  const badNumbering = caught(() => parseClaudeScanBatch({ pages: [page(0, { slot_count: 2, slots: [{ slot: 1, label: "a", text: "x", legibility: "clear" }, { slot: 3, label: "b", text: "y", legibility: "clear" }] })] }, meta));
  t.check(badNumbering, instanceOf(ScanVisionBatchError));
  t.check(badNumbering, slotInvariant);

  const misaligned = caught(() => parseClaudeScanBatch({ pages: [page(1)] }, meta));
  t.check(misaligned, instanceOf(ScanVisionBatchError));
  t.check(misaligned, {
    name: "ScanVisionBatchError",
    message: "Scan batch response misaligned with input pages: expected 1 analyses indexed 0..0, got 1 with indices [1]",
    ...accounting,
  });

  const wrongCount = caught(() => parseClaudeScanBatch({ pages: [page(0), page(1)] }, meta));
  t.check(wrongCount, instanceOf(ScanVisionBatchError));
  t.check(wrongCount, {
    name: "ScanVisionBatchError",
    message: "Scan batch response misaligned with input pages: expected 1 analyses indexed 0..0, got 2 with indices [0, 1]",
    ...accounting,
  });
});

// A rotation outside 0/90/180/270 is a schema failure, not a card-corrupting
// value (the image card schema only accepts those four).
void test("A rotation outside 0/90/180/270 is a schema failure, not a card-corrupting va...", async (t) => {
  const badRotation = caught(() => parseClaudeScanBatch({ pages: [page(0, { rotation: 45 })] }, meta));
  t.check(badRotation, instanceOf(ScanVisionBatchError));
  t.check(badRotation, {
    name: "ClaudeScanSchemaError",
    message: any(String).startsWith("Claude scan output failed schema validation: "),
    retry: "split" as const,
    usage: { prompt: 1000, output: 100, thinking: 0 },
    costUsd: 0.05,
  });
});
