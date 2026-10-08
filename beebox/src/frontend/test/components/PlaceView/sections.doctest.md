# What the place page lists, in order

A landmark card renders as the place page. `placeSections` turns the
`landmarks.forDir` payload (asked with `expandsAsGroups`) into the page's
sections: entry points, primary cards, places inside, pinned links, then each
`expand` group in the landmark's order. A tier with no links is left out. A
place with no links and no groups is empty, and the page says so
(docs/plans/landmark-arrival.md, Track C).

```ts setup
import { placeSections } from "../../../src/components/PlaceView/sections.js";

function link(ref: string, source: "listed" | "derived" | "expand" | "place", prominence?: "entry-point" | "primary" | "background") {
  return { ref, label: null, title: ref, exists: true, source, ...(prominence === undefined ? {} : { prominence }) };
}

/** Each section as "tier: refs" or "group label (count)". */
function outline(result: ReturnType<typeof placeSections>) {
  if (result.kind === "empty") return "empty";
  return result.sections.map((s) => s.kind === "links" ? `${s.tier}: ${s.links.map((l) => l.ref).join(", ")}` : `${s.group.label} (${s.group.count})`);
}
```

## Tiers come in a fixed order, whatever order the links arrive in

The server already sends links in tier order; the page groups them by where
they came from. A nested place is `source: "place"`, so a derived card with
the same `prominence` is not mistaken for one.

```ts
outline(placeSections({
  links: [
    link("Pinned.memo.card", "listed"),
    link("List.memo.card", "derived", "entry-point"),
    link("Rules.memo.card", "derived", "primary"),
    link("tools/Tools.landmark.card", "place", "background"),
  ],
  groups: [
    { label: "Every loan card here", count: 2, children: [] },
    { label: "Every receipt card here", count: 0, children: [] },
  ],
}))
=> [
  "entry-point: List.memo.card",
  "primary: Rules.memo.card",
  "places: tools/Tools.landmark.card",
  "pinned: Pinned.memo.card",
  "Every loan card here (2)",
  "Every receipt card here (0)",
]
```

## A group that matches nothing still makes the place non-empty

The place expects such cards, so the page shows the group with "None yet"
rather than "Nothing here yet."

```ts
outline(placeSections({ links: [], groups: [{ label: "Every loan card here", count: 0, children: [] }] }))
=> ["Every loan card here (0)"]
```

## No links and no groups is an empty place

```ts
outline(placeSections({ links: [], groups: [] }))
=> empty
```
