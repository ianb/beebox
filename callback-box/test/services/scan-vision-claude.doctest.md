# ClaudeScanVision — wire schema and the parse boundary

The Claude scan backend's testable core, no SDK subprocess involved: the
generated wire schema, and `parseClaudeScanBatch` — the boundary from a raw
`structured_output` value to post-conditioned `RawScanAnalysis[]` (Zod
validation, slot invariant, legibility→flag folding, batch alignment).
Design: `docs/plans/scan-vision-claude.md`.

```ts setup
import {
  claudeScanWireSchema,
  parseClaudeScanBatch,
  foldSlotsIntoReviewFlags,
  CLAUDE_SCAN_NOTE,
} from "../../src/services/scan-vision-claude.js";

/** A well-formed Claude-shaped page with overridable fields. */
function page(index, overrides = {}) {
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
```

## The generated wire schema

Generated from the Zod schema (`rawScanAnalysisSchema` extended + tightened) —
no hand-written third schema. `z.int()`'s vacuous MAX_SAFE_INTEGER bounds are
stripped, rotation is a four-value enum, and `subject_bbox` only admits null.

```ts
const schema = claudeScanWireSchema();
const pages = schema.properties.pages;
pages.type
=> array

JSON.stringify(pages.items.properties.index)
=> {"type":"integer"}

JSON.stringify(pages.items.properties.subject_bbox)
=> {"type":"null"}

pages.items.properties.rotation.anyOf.map((v) => v.const).join(",")
=> 0,90,180,270

pages.items.required.includes("slot_count") && pages.items.required.includes("slots")
=> true

JSON.stringify(schema).includes("9007199254740991")
=> false
```

The prompt suffix carries the two-phase outline procedure and the bbox refusal.

```ts
CLAUDE_SCAN_NOTE.includes("PHASE 1 — ENUMERATE") && CLAUDE_SCAN_NOTE.includes("Always set subject_bbox to null.")
=> true
```

## Happy path: slots stripped, clear pages unflagged

```ts
const ok = parseClaudeScanBatch({ pages: [page(0)] }, meta);
ok.length
=> 1

JSON.stringify(Object.keys(ok[0] ?? {}).filter((k) => k.startsWith("slot")))
=> []

ok[0]?.flag_for_review
=> false
```

## Legibility folds into the review channel

Any non-`clear` slot forces `flag_for_review` and names the slots — "these
rows need review", through the existing question-card flow.

```ts
const hardSlots = [{ slot: 1, label: "row 1", text: "Dana", legibility: "clear" }, { slot: 2, label: "row 2", text: "M?", legibility: "partial" }, { slot: 3, label: "row 3", text: "(7 letters, starts H)", legibility: "illegible" }];
const flagged = parseClaudeScanBatch({ pages: [page(0, { slot_count: 3, slots: hardSlots })] }, meta);
flagged[0]?.flag_for_review
=> true

flagged[0]?.flag_reason
=> Slots needing review: 2 (partial), 3 (illegible)

const withReason = parseClaudeScanBatch({ pages: [page(0, { slot_count: 3, slots: hardSlots, flag_for_review: true, flag_reason: "hard handwriting" })] }, meta);
withReason[0]?.flag_reason
=> hard handwriting; Slots needing review: 2 (partial), 3 (illegible)
```

`foldSlotsIntoReviewFlags` is the same operation exposed directly:

```ts
const folded = foldSlotsIntoReviewFlags(page(4, { slot_count: 2, slots: [{ slot: 1, label: "a", text: "x", legibility: "clear" }, { slot: 2, label: "b", text: "y?", legibility: "partial" }] }));
`${folded.flag_for_review} ${folded.flag_reason}`
=> true Slots needing review: 2 (partial)
```

## Post-conditions fail loudly, classified for the runner

A non-null bbox never parses (we refuse Claude's boxes — measured systematic
y-offset), a broken slot enumeration is a `"split"`-classified error, and a
misaligned batch can never misattach cards. Every error carries the failed
attempt's usage/cost for the runner's accounting.

```ts
const badBbox = (() => { try { parseClaudeScanBatch({ pages: [page(0, { subject_bbox: [1, 2, 3, 4] })] }, meta); return null; } catch (e) { return e; } })();
`${badBbox.name}: retry=${badBbox.retry}`
=> ClaudeScanSchemaError: retry=split

const badSlots = (() => { try { parseClaudeScanBatch({ pages: [page(0, { slot_count: 2 })] }, meta); return null; } catch (e) { return e; } })();
`${badSlots.name}: retry=${badSlots.retry} usage=${badSlots.usage?.prompt}`
=> ScanSlotInvariantError: retry=split usage=1000

const badNumbering = (() => { try { parseClaudeScanBatch({ pages: [page(0, { slot_count: 2, slots: [{ slot: 1, label: "a", text: "x", legibility: "clear" }, { slot: 3, label: "b", text: "y", legibility: "clear" }] })] }, meta); return null; } catch (e) { return e; } })();
badNumbering.name
=> ScanSlotInvariantError

const misaligned = (() => { try { parseClaudeScanBatch({ pages: [page(1)] }, meta); return null; } catch (e) { return e; } })();
`${misaligned.name}: retry=${misaligned.retry}`
=> ScanVisionBatchError: retry=split

const wrongCount = (() => { try { parseClaudeScanBatch({ pages: [page(0), page(1)] }, meta); return null; } catch (e) { return e; } })();
wrongCount.retry
=> split
```

A rotation outside 0/90/180/270 is a schema failure, not a card-corrupting
value (the image card schema only accepts those four).

```ts
const badRotation = (() => { try { parseClaudeScanBatch({ pages: [page(0, { rotation: 45 })] }, meta); return null; } catch (e) { return e; } })();
badRotation.name
=> ClaudeScanSchemaError
```
