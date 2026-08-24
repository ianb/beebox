# Docling — mapping extracted text back onto pages

A pdf card's body is Docling's markdown rendering of the document. It carries no
page breaks, so "which page is this paragraph on" is answerable only by joining
the rendered blocks against the page-stamped text items in
`attach/docling.json.gz`.

`src/frontend/src/lib/docling-match.ts` does that join. It is deliberately
sequential and lossy: the two lists are not in correspondence, so it matches
forward only and refuses to guess.

```ts setup
import {
  matchBlocksToPages,
  normalizeForMatch,
  pageBoundaries,
  pagedTexts,
} from "../../../src/frontend/src/lib/docling-match.js";
import { readDoclingDocument } from "../../../src/frontend/src/lib/docling.js";

/** Render a match map compactly: `block=page` pairs, block order. */
function show(map) {
  return [...map.entries()].map(([block, page]) => `${block}=${page}`).join(" ");
}
```

## Normalization

The body is a *rendering* of these same characters, so the text matches but the
spacing doesn't.

```ts
normalizeForMatch("  Onboarding   starts\non your\tfirst Monday.  ")
=> onboarding starts on your first monday.
```

## The straightforward case

Blocks that line up with the docling texts get their page.

```ts
const texts = [
  { text: "Employee Handbook 2026", page: 1 },
  { text: "Onboarding starts on your first Monday.", page: 1 },
  { text: "Benefits", page: 2 },
  { text: "Expenses are reimbursed within two weeks.", page: 3 },
];
show(matchBlocksToPages([
  "Employee Handbook 2026",
  "Onboarding starts on your first Monday.",
  "Benefits",
  "Expenses are reimbursed within two weeks.",
], texts))
=> 0=1 1=1 2=2 3=3
```

## Blocks the markdown invented or dropped

The rendering adds blocks docling never emitted (a table rendered as pipe text,
a figure's alt line) and drops ones it did. Unmatched blocks are simply skipped;
the cursor never goes backwards, so the rest still lands.

```ts continue
show(matchBlocksToPages([
  "Employee Handbook 2026",
  "| Plan | Cost |",
  "| Standard | $0 |",
  "Benefits",
  "Expenses are reimbursed within two weeks.",
], texts))
=> 0=1 3=2 4=3
```

A prefix match counts in either direction, because the two renderings truncate
each other: a heading rendered with its numbering, a paragraph docling split.

```ts continue
show(matchBlocksToPages(["Onboarding starts"], texts))
=> 0=1
```

## Ambiguity is skipped, not guessed

A block that matches candidates on *different* pages inside the lookahead window
produces no marker at all — a paragraph labelled with the wrong page is worse
than one labelled with none.

```ts
show(matchBlocksToPages(["Continued"], [
  { text: "Continued", page: 4 },
  { text: "Continued", page: 5 },
]))
=>
```

A line repeated *within* one page still identifies that page:

```ts
show(matchBlocksToPages(["Continued"], [
  { text: "Continued", page: 4 },
  { text: "Continued", page: 4 },
]))
=> 0=4
```

Empty blocks (a spacer paragraph, a `<li>` holding only a nested list) are
ignored rather than matched against the next text:

```ts
show(matchBlocksToPages(["", "   ", "Benefits"], [{ text: "Benefits", page: 2 }]))
=> 2=2
```

## Boundaries, not per-paragraph noise

The view draws a marker where the page *turns*, so the map is reduced to the
first block of each new page.

```ts
const matched = matchBlocksToPages(
  ["A one", "A two", "A three", "B one", "B two", "C one"],
  [
    { text: "A one", page: 1 },
    { text: "A two", page: 1 },
    { text: "A three", page: 1 },
    { text: "B one", page: 2 },
    { text: "B two", page: 2 },
    { text: "C one", page: 5 },
  ],
);
pageBoundaries(matched).map((b) => `${b.block}:p${b.page}`).join(" ")
=> 0:p1 3:p2 5:p5
```

A backwards page is a mis-match, not a page the reader re-entered, so it is
dropped rather than drawn:

```ts
pageBoundaries(new Map([[0, 1], [1, 3], [2, 2], [3, 4]])).map((b) => b.page).join(",")
=> 1,3,4
```

## The right-hand list comes from the document

`pagedTexts` takes the text items that carry provenance, in reading order.
Tables and pictures are dropped (they have no comparable rendered text), and so
is any item docling placed on no page.

```ts
pagedTexts(readDoclingDocument({
  body: { children: [{ $ref: "#/texts/0" }, { $ref: "#/tables/0" }, { $ref: "#/texts/1" }] },
  texts: [
    { label: "paragraph", text: "Placed", prov: [{ page_no: 7 }] },
    { label: "paragraph", text: "Unplaced" },
  ],
  tables: [{ label: "table", prov: [{ page_no: 7 }], data: {} }],
})).map((t) => `${t.text}@${t.page}`).join(" ")
=> Placed@7
```
