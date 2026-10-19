// # What the place page lists, in order
//
// A landmark card renders as the place page. `placeSections` turns the
// `landmarks.forDir` payload (asked with `expandsAsGroups`) into the page's
// sections: entry points, primary cards, places inside, pinned links, then each
// `expand` group in the landmark's order. A tier with no links is left out. A
// place with no links and no groups is empty, and the page says so
// (docs/implemented-plans/landmark-arrival.md, Track C).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { placeSections } from "../../../src/components/PlaceView/sections.js";

function link({ ref, source, prominence }: { ref: string; source: "listed" | "derived" | "expand" | "place"; prominence?: "entry-point" | "primary" | "background" }) {
  return { ref, label: null, title: ref, exists: true, source, ...(prominence === undefined ? {} : { prominence }) };
}

/** Each section as "tier: refs" or "group label (count)". */
function outline(result: ReturnType<typeof placeSections>) {
  if (result.kind === "empty") return "empty";
  return result.sections.map((s) => s.kind === "links" ? `${s.tier}: ${s.links.map((l) => l.ref).join(", ")}` : `${s.group.label} (${s.group.count})`);
}

// ## Tiers come in a fixed order, whatever order the links arrive in
//
// The server already sends links in tier order; the page groups them by where
// they came from. A nested place is `source: "place"`, so a derived card with
// the same `prominence` is not mistaken for one.
void test("The server already sends links in tier order; the page groups them by where t...", async (t) => {
  // doctest:L31
  t.check(
    outline(placeSections({
      links: [
        link({ ref: "Pinned.doc.card", source: "listed" }),
        link({ ref: "List.doc.card", source: "derived", prominence: "entry-point" }),
        link({ ref: "Rules.doc.card", source: "derived", prominence: "primary" }),
        link({ ref: "tools/Tools.landmark.card", source: "place", prominence: "background" }),
      ],
      groups: [
        { label: "Every loan card here", count: 2, children: [] },
        { label: "Every receipt card here", count: 0, children: [] },
      ],
    })),
    [
    "entry-point: List.doc.card",
    "primary: Rules.doc.card",
    "places: tools/Tools.landmark.card",
    "pinned: Pinned.doc.card",
    "Every loan card here (2)",
    "Every receipt card here (0)",
  ],
  );
});

// ## A listed card shows in the tier of its prominence
//
// A place may list its own entry point in `links:`. The resolver keeps the
// listed row and gives it the card's `prominence`, so the card shows under the
// entry points ("Start here"), not with the pinned links. A listed card with no
// derived level stays pinned.
void test("A place may list its own entry point in links:.", async (t) => {
  // doctest:L61
  t.check(
    outline(placeSections({
      links: [
        link({ ref: "List.doc.card", source: "listed", prominence: "entry-point" }),
        link({ ref: "Rules.doc.card", source: "listed", prominence: "primary" }),
        link({ ref: "Pinned.doc.card", source: "listed" }),
      ],
      groups: [],
    })),
    [
    "entry-point: List.doc.card",
    "primary: Rules.doc.card",
    "pinned: Pinned.doc.card",
  ],
  );
});

// ## A group that matches nothing still makes the place non-empty
//
// The place expects such cards, so the page shows the group with "None yet"
// rather than "No cards to show here yet."
void test("The place expects such cards, so the page shows the group with \"None yet\" rat...", async (t) => {
  // doctest:L78
  t.check(outline(placeSections({ links: [], groups: [{ label: "Every loan card here", count: 0, children: [] }] })), [
    "Every loan card here (0)",
  ]);
});

// ## "Also here" is the last group
//
// The server appends "Also here" after the landmark's own groups, and the page
// keeps the server's group order.
void test("The server appends \"Also here\" after the landmark's own groups, and the page...", async (t) => {
  // doctest:L88
  t.check(
    outline(placeSections({
      links: [link({ ref: "List.doc.card", source: "derived", prominence: "entry-point" })],
      groups: [
        { label: "Every loan card here", count: 2, children: [] },
        { label: "Also here", count: 30, children: [link({ ref: "Groceries.doc.card", source: "derived" })], alsoHere: true },
      ],
    })),
    [
    "entry-point: List.doc.card",
    "Every loan card here (2)",
    "Also here (30)",
  ],
  );
});

// ## No links and no groups is an empty place
void test("No links and no groups is an empty place", async (t) => {
  // doctest:L101
  t.check(outline(placeSections({ links: [], groups: [] })), "empty");
});
