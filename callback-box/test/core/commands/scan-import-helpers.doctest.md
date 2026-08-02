# Scan Import Helpers

Helpers for the `scan-import` command: sliding-overlap batch planning, pair reconciliation across overlapping batches, and bundling resolved pages into photo/back groups.

```ts setup
import {
  planScanBatches,
  resolveScanPages,
  bundleResolvedPages,
  buildScanPrompt,
  type ScanPageAnalysis,
} from "../../../src/core/commands/scan-import-helpers.js";

function photo(index: number, paired: number | null = null, opts: Partial<ScanPageAnalysis> = {}): ScanPageAnalysis {
  return {
    index,
    kind: "photo",
    paired_with_index: paired,
    description: `Photo ${index}`,
    title: `Photo_${index}`,
    rotation: 0,
    subject_bbox: null,
    has_text: false,
    text_blocks: [],
    date_hint: null,
    flag_for_review: false,
    flag_reason: null,
    ...opts,
  };
}

function back(index: number, paired: number | null = null, text = "", opts: Partial<ScanPageAnalysis> = {}): ScanPageAnalysis {
  return {
    index,
    kind: "back",
    paired_with_index: paired,
    description: "",
    title: "",
    rotation: 0,
    subject_bbox: null,
    has_text: text.length > 0,
    text_blocks: text ? [{ source: "back", text }] : [],
    date_hint: null,
    flag_for_review: false,
    flag_reason: null,
    ...opts,
  };
}
```

## Sliding-overlap batch planning

A small PDF fits in one batch:

```ts
JSON.stringify(planScanBatches(4, 8).map(p => p.globalIndices))
=> [[0,1,2,3]]
```

A larger PDF gets split with one-page overlap so any pair straddling a seam still appears in some batch together:

```ts
JSON.stringify(planScanBatches(20, 8).map(p => p.globalIndices))
=> [[0,1,2,3,4,5,6,7],[7,8,9,10,11,12,13,14],[14,15,16,17,18,19]]
```

Exactly batch-size yields one batch:

```ts
JSON.stringify(planScanBatches(8, 8).map(p => p.globalIndices))
=> [[0,1,2,3,4,5,6,7]]
```

Empty PDF yields no batches:

```ts
JSON.stringify(planScanBatches(0, 8))
=> []
```

## Pair reconciliation: mutual claims survive

When both pages in a pair name each other, the pair is finalized:

```ts
const pages = new Map<number, ScanPageAnalysis[]>();
pages.set(0, [photo(0, 1)]);
pages.set(1, [back(1, 0, "Mom, 1985")]);
const resolved = resolveScanPages(pages, 2);
resolved.map(r => `${r.index}:${r.analysis.kind} pair=${r.pairedWith}`).join(" | ")
=> 0:photo pair=1 | 1:back pair=0
```

When only one side names a partner, the pair does NOT survive — the partner has to reciprocate:

```ts
const pages2 = new Map<number, ScanPageAnalysis[]>();
pages2.set(0, [photo(0, 1)]);
pages2.set(1, [back(1, null, "Mom")]);  // back didn't name page 0
const resolved2 = resolveScanPages(pages2, 2);
resolved2.map(r => `${r.index}:pair=${r.pairedWith} conflict=${r.conflict}`).join(" | ")
=> 0:pair=null conflict=true | 1:pair=null conflict=false
```

## Pair reconciliation: overlap dedup

A page that appears in two batches with consistent claims gets the pair resolved cleanly:

```ts
const pages3 = new Map<number, ScanPageAnalysis[]>();
// Page 7 appears in batch [0..7] paired with 6, AND in batch [7..14] paired with 6 (impossible — 6 not in second batch).
// More realistic: batch A pairs 6↔7, batch B sees 7 as singleton (since its partner 6 is in batch A only).
pages3.set(6, [photo(6, 7)]);
pages3.set(7, [back(7, 6, "Beach"), back(7, null, "Beach")]);
const resolved3 = resolveScanPages(pages3, 8);
resolved3[7].pairedWith
=> 6
```

The analyzer that named a partner wins over the one that didn't.

## Pair reconciliation: mutual claims beat unreciprocated ones

When both overlapping batches named a partner for the same page, the claim
the partner actually reciprocates wins — even when it came from the first
batch (the old rule arbitrarily took the second):

```ts
const pages4 = new Map<number, ScanPageAnalysis[]>();
// Batch A saw 4↔5 mutually; batch B misread page 5 as paired forward with 6.
pages4.set(4, [photo(4, 5)]);
pages4.set(5, [back(5, 4, "Lake"), back(5, 6, "Lake")]);
pages4.set(6, [photo(6, null)]);
const resolved4 = resolveScanPages(pages4, 8);
`${resolved4[4].pairedWith}<->${resolved4[5].pairedWith} conflict=${resolved4[5].conflict}`
=> 5<->4 conflict=true
```

## Bundling: photo + back

Photos with mutual back partners become bundles:

```ts
const pages4 = new Map<number, ScanPageAnalysis[]>();
pages4.set(0, [photo(0, 1)]);
pages4.set(1, [back(1, 0, "Family reunion 1985")]);
const resolved4 = resolveScanPages(pages4, 2);
const result = bundleResolvedPages(resolved4);
print(`bundles=${result.bundles.length} orphans=${result.orphanBacks.length} unsure=${result.unsurePages.length}`);
print(`bundle0: photo=${result.bundles[0].photoIndex} back=${result.bundles[0].backIndex}`);
print(`back text: ${result.bundles[0].back!.text_blocks[0].text}`)
=>
bundles=1 orphans=0 unsure=0
bundle0: photo=0 back=1
back text: Family reunion 1985
```

## Bundling: orphan back

A text-bearing back page that nobody paired with becomes an orphan:

```ts
const pages5 = new Map<number, ScanPageAnalysis[]>();
pages5.set(0, [photo(0, null)]);
pages5.set(1, [back(1, null, "Cousin Bill")]);
const result5 = bundleResolvedPages(resolveScanPages(pages5, 2));
print(`bundles=${result5.bundles.length} orphans=${result5.orphanBacks.length}`);
print(`orphan text: ${result5.orphanBacks[0].analysis.text_blocks[0].text}`)
=>
bundles=1 orphans=1
orphan text: Cousin Bill
```

The unpartnered photo still becomes a singleton bundle (no back).

## Bundling: blank pages dropped

```ts
const pages6 = new Map<number, ScanPageAnalysis[]>();
pages6.set(0, [photo(0, null)]);
pages6.set(1, [{ ...back(1), kind: "blank", has_text: false, text_blocks: [] }]);
const result6 = bundleResolvedPages(resolveScanPages(pages6, 2));
`bundles=${result6.bundles.length} blanks=${result6.blankPages.length}`
=> bundles=1 blanks=1
```

## Boxholder context wrapping

With no context, the prompt is unchanged from the base instructions:

```ts
const base = buildScanPrompt(null);
const withContext = buildScanPrompt("Tomas, Noor, Delia are recurring people. Photos from 1965-1985.");
print(`base contains user context: ${base.includes("boxholder")}`);
print(`with-context contains people: ${withContext.includes("Tomas, Noor, Delia")}`);
print(`with-context warns against invention: ${withContext.includes("DO NOT invent")}`);
print(`with-context still has page instructions: ${withContext.includes("paired_with_index")}`)
=>
base contains user context: false
with-context contains people: true
with-context warns against invention: true
with-context still has page instructions: true
```

Empty/whitespace context is treated as no context:

```ts
const blank = buildScanPrompt("   \n\n  ");
blank === buildScanPrompt(null)
=> true
```

## Flag propagation

A flagged photo or back surfaces in the bundle's flagReasons:

```ts
const pages7 = new Map<number, ScanPageAnalysis[]>();
pages7.set(0, [photo(0, 1)]);
pages7.set(1, [back(1, 0, "?? hard to read", { flag_for_review: true, flag_reason: "Handwriting unclear" })]);
const result7 = bundleResolvedPages(resolveScanPages(pages7, 2));
print(`flag=${result7.bundles[0].flagForReview}`);
print(result7.bundles[0].flagReasons.join("; "))
=>
flag=true
Back: Handwriting unclear
```
