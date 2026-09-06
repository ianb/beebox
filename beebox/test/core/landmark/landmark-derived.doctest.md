# Derived children in the resolved link list

Track B (`docs/plans/card-prominence.md`) splices a landmark's pruned subtree
(`prominence-index.ts`) into `resolveLandmark`'s flat list: hand-listed
`links` first, then derived `entry-point` cards, then derived `primary`
cards, then nested landmarks, then unnamed `expand` results — deduped by ref
across every tier, first wins. Each resolved link now carries `source`
(`"listed" | "derived" | "expand"`) and, for a derived link, `prominence`.

```ts setup
import { resolveLandmark } from "../../../src/core/landmark/resolve.js";
import { prunedSubtree } from "../../../src/core/landmark/prominence-index.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** The fields the assertions below care about, in list order. */
function summarize(links: { ref: string; label: string | null; source: string; prominence?: string }[]) {
  return links.map((l) => ({ ref: l.ref, label: l.label, source: l.source, prominence: l.prominence ?? null }));
}
```

## Tier order: entry-point, then primary, then nested landmarks, then expand

```ts
const box = await makeTmpBox();
await box.write("_content/Spot.landmark.card", "---\nnavigation:\n  label: Spot\n  expand:\n    - query: Extra.memo.card\n---\n");
await box.write("_content/Extra.memo.card", "---\n---\n");
await box.write("_content/Idx.memo.card", "---\nprominence: entry-point\n---\n");
await box.write("_content/Plan.memo.card", "---\nprominence: primary\n---\n");
await box.write("_content/Sub/Sub.landmark.card", "---\nnavigation:\n  label: Sub\n---\n");

const derived = await prunedSubtree(box.root, "");
const { links } = await resolveLandmark(
  { label: "Spot", expand: [{ query: "Extra.memo.card" }] },
  { landmarkDir: box.path("_content"), landmarkPath: "_content/Spot.landmark.card", boxRoot: box.root, derived },
);

JSON.stringify(summarize(links), null, 2)
=>
[
  {
    "ref": "_content/Idx.memo.card",
    "label": null,
    "source": "derived",
    "prominence": "entry-point"
  },
  {
    "ref": "_content/Plan.memo.card",
    "label": null,
    "source": "derived",
    "prominence": "primary"
  },
  {
    "ref": "_content/Sub/Sub.landmark.card",
    "label": "Sub",
    "source": "derived",
    "prominence": "background"
  },
  {
    "ref": "_content/Extra.memo.card",
    "label": null,
    "source": "expand",
    "prominence": null
  }
]
```

```ts cleanup
await box.cleanup();
```

## A hand-listed link wins the dedup against the same card, derived

The card is BOTH `links:`-listed (with a label) and marked `primary` — the
listed entry wins, keeping its label and `source: "listed"`; the derived
tier contributes nothing for that ref.

```ts
const box = await makeTmpBox();
await box.write("_content/Plan.memo.card", "---\nprominence: primary\n---\n");

const derived = await prunedSubtree(box.root, "");
const { links } = await resolveLandmark(
  { label: "Spot", links: [{ ref: "/_content/Plan.memo.card", label: "the plan" }] },
  { landmarkDir: box.path("_content"), landmarkPath: "_content/Spot.landmark.card", boxRoot: box.root, derived },
);

JSON.stringify(summarize(links), null, 2)
=>
[
  {
    "ref": "_content/Plan.memo.card",
    "label": "the plan",
    "source": "listed",
    "prominence": null
  }
]
```

```ts cleanup
await box.cleanup();
```

## No `derived` input: unchanged, listed-then-expand only

Omitting `derived` (the identity-only callers, and any resolver call that
doesn't want derivation) behaves exactly as before Track B.

```ts
const box = await makeTmpBox();
await box.write("_content/Bread.recipe.card", "---\ntitle: Bread\n---\n");

const { links, derivedProblems } = await resolveLandmark(
  { label: "Recipes", links: [{ ref: "Bread.recipe.card" }] },
  { landmarkDir: box.path("_content"), landmarkPath: "_content/Recipes.landmark.card", boxRoot: box.root },
);

JSON.stringify(summarize(links), null, 2)
=>
[
  {
    "ref": "_content/Bread.recipe.card",
    "label": null,
    "source": "listed",
    "prominence": null
  }
]

derivedProblems.length
=> 0
```

```ts cleanup
await box.cleanup();
```
