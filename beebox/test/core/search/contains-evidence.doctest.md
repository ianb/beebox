# `contains-evidence`: the derived detail behind a `contains`

`contains-evidence` is an optional global card field holding the accumulated
material a card's one-sentence `contains` was derived from — so a summary can
show its work. Most cards never set it; the nightly chat review is its first
consumer.

It exists because `contains` cannot accumulate: `card-lint.ts` budgets it at one
sentence, and it is the embedded retrieval field whose scoring was fitted against
one-sentence text.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { setDerivedContains } from "../../../src/core/search/contains-update.js";
import { lintCardsDispatch } from "../../../src/core/card-lint.js";
import { buildLoadContext } from "../../../src/core/load-context.js";
import { computeContainsBasis } from "../../../src/core/search/contains-state.js";
import { GLOBAL_CARD_FIELDS } from "../../../src/cards/schema.js";
import { readFile } from "node:fs/promises";

const CARD = "store/notes/Trip.memo.card";

function memo(fields: string) {
  return `---\nstatus: new\ncreated: 2026-07-28T03:00:00Z\n${fields}\n---\nBody text.\n`;
}
```

## It is a global field, so no schema declares it

```ts
Object.keys(GLOBAL_CARD_FIELDS).join(",")
=> title,contains,contains-evidence,todos

GLOBAL_CARD_FIELDS["contains-evidence"].isOptional()
=> true
```

## An evidence-only write persists

This is the regression anchor for a real bug: the original `contains` writer
returned early without touching the card whenever `contains` itself was
unchanged. Since an accumulating account grows on passes where the one-sentence
summary stays accurate, evidence-only updates are the *common* case — they would
have been silently dropped.

```ts
const box = await makeTmpBox();
await box.write(CARD, memo("contains: A trip to the coast."));

const first = await setDerivedContains(box.root, {
  relPath: CARD,
  evidence: "- decision: booked the coast cottage",
});
first.unchanged
=> false

const after = await readFile(box.path(CARD), "utf8");
after.includes("contains-evidence:") && after.includes("booked the coast cottage")
=> true
```

The `contains` sentence is left exactly as it was.

```ts continue
after.includes("contains: A trip to the coast.")
=> true
```

Writing the same evidence again is a no-op, so a nightly pass that finds nothing
new doesn't churn the card or its git history.

```ts continue
const second = await setDerivedContains(box.root, {
  relPath: CARD,
  evidence: "- decision: booked the coast cottage",
});
second.unchanged
=> true
```

Both fields move together when both are supplied.

```ts continue
await setDerivedContains(box.root, {
  relPath: CARD,
  contains: "Planning a coast trip, now booked.",
  evidence: "- decision: booked the coast cottage\n- follow-up: pack the tide table",
});
const both = await readFile(box.path(CARD), "utf8");
both.includes("Planning a coast trip, now booked.") && both.includes("tide table")
=> true
```

```ts cleanup
await box.cleanup();
```

## Writing evidence never moves the contains basis

The staleness sidecar decides whether a card's `contains` still describes its
content, by hashing a "basis". `contains-evidence` is derived *alongside*
`contains`, so it is excluded from that basis — otherwise every pass that
extended the evidence would flag the summary it was just written with as out of
date.

Note the basis only reaches frontmatter at all for card types with **no body**:
a bodied card hashes its body. So for chat husks this exclusion is policy rather
than a live bug, and the case that actually needs it is the frontmatter-only one.

```ts
const bodied = (fields: Record<string, unknown>) => ({
  schema: { bodyFieldName: "body" },
  fields: { body: "Body text.", ...fields },
});
const flat = (fields: Record<string, unknown>) => ({
  schema: { bodyFieldName: null },
  fields,
});

// Bodied card: frontmatter is not in the basis at all.
computeContainsBasis({ card: bodied({ contains: "A trip." }) })
  === computeContainsBasis({ card: bodied({ contains: "A trip.", "contains-evidence": "- learned: trains" }) })
=> true

// Frontmatter-only card: the exclusion is what keeps the basis stable.
computeContainsBasis({ card: flat({ source: "voice", contains: "A trip." }) })
  === computeContainsBasis({ card: flat({ source: "voice", contains: "A trip.", "contains-evidence": "- learned: trains" }) })
=> true
```

A field that is *not* excluded still moves the basis, so the check above is
testing the exclusion rather than a basis that ignores everything. (`status` is
itself basis-excluded, so it makes a poor control — use a content field.)

```ts continue
computeContainsBasis({ card: flat({ source: "voice" }) })
  === computeContainsBasis({ card: flat({ source: "email" }) })
=> false
```

## The one-sentence budget applies to `contains` only

An evidence field is *expected* to be long, so the lint budget stays scoped to
the summary.

```ts
const box = await makeTmpBox();
const longText = "x".repeat(400);

await box.write(CARD, memo(`contains: ${longText}`));
const ctx = await buildLoadContext(box.root);
const overLong = await lintCardsDispatch([box.path(CARD)], { boxRoot: box.root, ctx });
overLong.results[0].warnings.filter((i) => i.type === "contains").length
=> 1
```

The same length in `contains-evidence`, with a short `contains`, is clean.

```ts continue
await box.write(CARD, memo(`contains: A trip.\ncontains-evidence: ${longText}`));
const evidenceLong = await lintCardsDispatch([box.path(CARD)], { boxRoot: box.root, ctx });
evidenceLong.results[0].warnings.filter((i) => i.type === "contains").length
=> 0
```

```ts cleanup
await box.cleanup();
```
