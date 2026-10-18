// # The place page's view of `landmarks.forDir`
//
// A landmark card renders as the place page: the place's links in tiers, then
// each `expand` as a group that says in words what it lists
// (docs/implemented-plans/landmark-arrival.md, Track C). The page asks `landmarks.forDir`
// with `expandsAsGroups: true`; the menus omit the flag and keep today's flat
// list. The same payload names the place's arrival target (Track D): the card
// that arriving at the place opens.

import { test } from "tap";
import "agent-doctest/tap";
import { utimes } from "node:fs/promises";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import assert from "node:assert/strict";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { expandLabel } from "../../../../src/core/landmark/expand-label.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

async function payload(boxRoot: string, input: { dir: string; expandsAsGroups?: boolean }) {
  const { landmark } = await caller(boxRoot).landmarks.forDir(input);
  if (landmark === null) throw new Error(`no landmark in ${input.dir}`);
  return landmark;
}

/** The fields the page reads from each row. */
function rows(links: { ref: string; source: string; exists: boolean; prominence?: string }[]) {
  return links.map((l) => `${l.source}${l.prominence === undefined ? "" : `/${l.prominence}`} ${l.ref}${l.exists ? "" : " (missing)"}`);
}

function groups(gs: { label: string; count: number; children: { ref: string }[] }[]) {
  return gs.map((g) => ({ label: g.label, count: g.count, children: g.children.map((c) => c.ref) }));
}

/**
 * A Lending place: an entry point, a primary card, a nested place, a curated
 * link whose card is gone, an unnamed expand over loan cards, an unnamed expand
 * that matches nothing, and a named group.
 */
async function lendingBox() {
  const box = await makeTmpBox();
  await box.write("_content/lending/Lending.landmark.card", [
    "---",
    "navigation:",
    "  label: Lending",
    "  links:",
    "    - ref: Gone.doc.card",
    "  expand:",
    "    - query: \"*.loan.card\"",
    "    - query: \"**/*.receipt.card\"",
    "    - query: \"*.doc.card\"",
    "      group: Notes",
    "---",
    "",
  ].join("\n"));
  await box.write("_content/lending/Lending_List.doc.card", "---\ntitle: Lending List\nprominence: entry-point\n---\n");
  await box.write("_content/lending/Rules.doc.card", "---\ntitle: Rules\nprominence: primary\n---\n");
  await box.write("_content/lending/Drill.loan.card", "---\n---\n");
  await box.write("_content/lending/Stove.loan.card", "---\n---\n");
  await box.write("_content/lending/tools/Tools.landmark.card", "---\nnavigation:\n  label: Tools\n---\n");
  return box;
}

// ## `expandLabel` says what an unnamed expand lists
//
// A single-type glob in the place's own folder, the same glob through every
// folder below, and anything else, which is named by its query.
void test("A single-type glob in the place's own folder, the same glob through every fol...", async (t) => {
  // doctest:L75
  t.check(({ here: expandLabel("*.loan.card"), below: expandLabel("**/*.image.card"), other: expandLabel("2026-*.doc.card") }), {
    here: "Every loan card here",
    below: "Every image card here and in folders below",
    other: "Cards matching 2026-*.doc.card",
  });
});

// ## With `expandsAsGroups`, every expand is a group
//
// The flat list keeps the curated link (missing, so it stays as a row), the
// entry point, the primary card, and the nested place, which is marked
// `source: "place"` because its `prominence` cannot tell it from a derived
// card. Each unnamed expand becomes its own group, in the order the landmark
// lists its expands, under a plain-words label with an exact count; one that matches nothing is still there, with
// `count: 0`, so the page can say "None yet".
void test("The flat list keeps the curated link (missing, so it stays as a row), the ent...", async (t) => {
  // doctest:L89
  const box = await lendingBox();
  const page = await payload(box.root, { dir: "_content/lending", expandsAsGroups: true });
  t.check(({ links: rows(page.links), groups: groups(page.groups) }), {
    links: [
      "listed _content/lending/Gone.doc.card (missing)",
      "derived/entry-point _content/lending/Lending_List.doc.card",
      "derived/primary _content/lending/Rules.doc.card",
      "place/background _content/lending/tools/Tools.landmark.card",
    ],
    groups: [
      {
        label: "Every loan card here",
        count: 2,
        children: [
          "_content/lending/Drill.loan.card",
          "_content/lending/Stove.loan.card",
        ],
      },
      {
        label: "Every receipt card here and in folders below",
        count: 0,
        children: [],
      },
      {
        label: "Notes",
        count: 2,
        children: [
          "_content/lending/Lending_List.doc.card",
          "_content/lending/Rules.doc.card",
        ],
      },
    ],
  });
});

// ## Without the flag, unnamed expands stay in the flat list
//
// The place menu and the chat's link panel read this shape; it is unchanged.
void test("The place menu and the chat's link panel read this shape; it is unchanged.", async (t) => {
  // doctest:L112
  const box = await lendingBox();
  const menu = await payload(box.root, { dir: "_content/lending" });
  t.check(({ links: rows(menu.links), groups: menu.groups.map((g) => g.label) }), {
    links: [
      "listed _content/lending/Gone.doc.card (missing)",
      "derived/entry-point _content/lending/Lending_List.doc.card",
      "derived/primary _content/lending/Rules.doc.card",
      "place/background _content/lending/tools/Tools.landmark.card",
      "expand _content/lending/Drill.loan.card",
      "expand _content/lending/Stove.loan.card",
    ],
    groups: [
      "Notes",
    ],
  });
});

// ## Arrival opens the single entry point
//
// A place with exactly one entry-point card arrives on that card.
void test("A place with exactly one entry-point card arrives on that card.", async (t) => {
  // doctest:L133
  const box = await lendingBox();
  t.check((await payload(box.root, { dir: "_content/lending" })).arrival, "_content/lending/Lending_List.doc.card");
});

// ## Two entry points, or none, arrive on the landmark card
//
// With two entry points arrival does not guess; with none there is nothing
// else to open. Either way it opens the place page.
void test("With two entry points arrival does not guess; with none there is nothing else...", async (t) => {
  // doctest:L144
  const box = await makeTmpBox();
  await box.write("_content/swim/Swim.landmark.card", "---\nnavigation:\n  label: Swim\n---\n");
  await box.write("_content/swim/Week.doc.card", "---\ntitle: Week\nprominence: entry-point\n---\n");
  await box.write("_content/swim/Meets.doc.card", "---\ntitle: Meets\nprominence: entry-point\n---\n");
  await box.write("_content/garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");
  t.check(
    ({ two: (await payload(box.root, { dir: "_content/swim" })).arrival,
      none: (await payload(box.root, { dir: "_content/garden" })).arrival }),
    {
    two: "_content/swim/Swim.landmark.card",
    none: "_content/garden/Garden.landmark.card",
  },
  );
});

// ## The root place follows the same rule
//
// The root is the logical directory `""`; its landmark lives under `_content/`.
// An entry point inside a nested place belongs to that place, not the root.
void test("The root is the logical directory \"\"; its landmark lives under content/.", async (t) => {
  // doctest:L160
  const box = await makeTmpBox();
  await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: test\n---\n");
  await box.write("_content/lending/Lending.landmark.card", "---\nnavigation:\n  label: Lending\n---\n");
  await box.write("_content/lending/List.doc.card", "---\ntitle: List\nprominence: entry-point\n---\n");
  const root = await payload(box.root, { dir: "" });
  t.check(({ dir: root.dir, arrival: root.arrival }), {
    dir: "",
    arrival: "_content/Box.landmark.card",
  });
});

// ## A background place arrives on its landmark card
//
// A `background` landmark's cards are not listed by level, so it has no entry
// point to open.
void test("A background landmark's cards are not listed by level, so it has no entry poi...", async (t) => {
  // doctest:L175
  const box = await makeTmpBox();
  await box.write("_content/house/House.landmark.card", "---\nprominence: background\nnavigation:\n  label: Housekeeping\n---\n");
  await box.write("_content/house/Log.doc.card", "---\ntitle: Log\nprominence: entry-point\n---\n");
  t.check((await payload(box.root, { dir: "_content/house" })).arrival, "_content/house/House.landmark.card");
});

// ## "Also here" lists the place's other cards, most recently changed first
//
// With `expandsAsGroups`, the last group is "Also here": the place's ordinary
// cards that no tier or other group shows (docs/implemented-plans/place-shows-cards.md,
// Track A). A pinned card, an entry point, an expand group's cards, a chat husk
// (background by type) and a nested place's card are not in it.
void test("With expandsAsGroups, the last group is \"Also here\":", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L190
  const box = await makeTmpBox();
  await box.write("_content/house/House.landmark.card", [
    "---",
    "navigation:",
    "  label: House",
    "  links:",
    "    - ref: Pinned.doc.card",
    "  expand:",
    "    - query: \"Recipe*.doc.card\"",
    "      group: Recipes",
    "---",
    "",
  ].join("\n"));
  await box.write("_content/house/Pinned.doc.card", "---\ntitle: Pinned\n---\n");
  await box.write("_content/house/Start.doc.card", "---\ntitle: Start\nprominence: entry-point\n---\n");
  await box.write("_content/house/Recipe_Soup.doc.card", "---\ntitle: Recipe Soup\n---\n");
  await box.write("_content/house/chat/Hello.chat.card", "---\nsession: s1\n---\n");
  await box.write("_content/house/garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");
  await box.write("_content/house/garden/Seeds.doc.card", "---\ntitle: Seeds\n---\n");
  await box.write("_content/house/Groceries.doc.card", "---\ntitle: Groceries\n---\n");
  await box.write("_content/house/notes/Landlord.doc.card", "---\ntitle: Landlord\n---\n");
  await box.write("_content/house/Spanish.doc.card", "---\ntitle: Spanish\n---\n");
  await utimes(box.path("_content/house/Groceries.doc.card"), 1_700_000_000, 1_700_000_000);
  await utimes(box.path("_content/house/notes/Landlord.doc.card"), 1_700_000_200, 1_700_000_200);
  await utimes(box.path("_content/house/Spanish.doc.card"), 1_700_000_100, 1_700_000_100);

  // doctest:L216
  const page = await payload(box.root, { dir: "_content/house", expandsAsGroups: true });
  t.check(groups(page.groups), [
    {
      label: "Recipes",
      count: 1,
      children: [
        "_content/house/Recipe_Soup.doc.card",
      ],
    },
    {
      label: "Also here",
      count: 3,
      children: [
        "_content/house/notes/Landlord.doc.card",
        "_content/house/Spanish.doc.card",
        "_content/house/Groceries.doc.card",
      ],
    },
  ]);

  // Its rows are derived links with no level, titled like any other row.

  // doctest:L231
  t.check(rows(page.groups[1]?.children ?? []), [
    "derived _content/house/notes/Landlord.doc.card",
    "derived _content/house/Spanish.doc.card",
    "derived _content/house/Groceries.doc.card",
  ]);

  // Only the server's group carries the `alsoHere` mark the page reads.

  // doctest:L238
  t.check(page.groups.map((g) => ({ label: g.label, alsoHere: g.alsoHere === true })), [
    {
      label: "Recipes",
      alsoHere: false,
    },
    {
      label: "Also here",
      alsoHere: true,
    },
  ]);

  // The menus omit the flag and get no "Also here".

  // doctest:L245
  t.check((await payload(box.root, { dir: "_content/house" })).groups.map((g) => g.label), [
    "Recipes",
  ]);
});

// ## "Also here" shows 10 cards and counts the rest
//
// Thirty ordinary cards: the 10 most recently changed are listed, and `count`
// is 30, so the page can say "+20 more".
void test("Thirty ordinary cards:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L259
  const box = await makeTmpBox();
  await box.write("_content/many/Many.landmark.card", "---\nnavigation:\n  label: Many\n---\n");
  for (let i = 1; i <= 30; i++) {
    const rel = `_content/many/Card_${i}.doc.card`;
    await box.write(rel, `---\ntitle: Card ${i}\n---\n`);
    await utimes(box.path(rel), 1_700_000_000 + i, 1_700_000_000 + i);
  }
  const [also] = (await payload(box.root, { dir: "_content/many", expandsAsGroups: true })).groups;
  assert.ok(also);
  t.check(({ label: also.label, count: also.count, children: also.children.map((c) => c.ref.replace("_content/many/", "")) }), {
    label: "Also here",
    count: 30,
    children: [
      "Card_30.doc.card",
      "Card_29.doc.card",
      "Card_28.doc.card",
      "Card_27.doc.card",
      "Card_26.doc.card",
      "Card_25.doc.card",
      "Card_24.doc.card",
      "Card_23.doc.card",
      "Card_22.doc.card",
      "Card_21.doc.card",
    ],
  });
});

// ## Equal mtimes keep a stable order
//
// A checkout can give every card the same mtime; the path then orders them,
// numbers by value.
void test("A checkout can give every card the same mtime; the path then orders them, num...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L289
  const box = await makeTmpBox();
  await box.write("_content/same/Same.landmark.card", "---\nnavigation:\n  label: Same\n---\n");
  for (const name of ["B_10", "A", "B_2"]) {
    const rel = `_content/same/${name}.doc.card`;
    await box.write(rel, `---\ntitle: ${name}\n---\n`);
    await utimes(box.path(rel), 1_700_000_000, 1_700_000_000);
  }
  t.check((await payload(box.root, { dir: "_content/same", expandsAsGroups: true })).groups[0]?.children.map((c) => c.ref), [
    "_content/same/A.doc.card",
    "_content/same/B_2.doc.card",
    "_content/same/B_10.doc.card",
  ]);
});

// ## An author's expand named "Also here" is not the server's group
//
// The author's group keeps its own cards and gets no `alsoHere` mark; the
// server's group still comes last.
void test("The author's group keeps its own cards and gets no alsoHere mark; the server'...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L310
  const box = await makeTmpBox();
  await box.write("_content/den/Den.landmark.card", [
    "---",
    "navigation:",
    "  label: Den",
    "  expand:",
    "    - query: \"Book*.doc.card\"",
    "      group: Also here",
    "---",
    "",
  ].join("\n"));
  await box.write("_content/den/Book_One.doc.card", "---\ntitle: Book One\n---\n");
  await box.write("_content/den/Lamp.doc.card", "---\ntitle: Lamp\n---\n");
  t.check(
    (await payload(box.root, { dir: "_content/den", expandsAsGroups: true })).groups
      .map((g) => ({ label: g.label, alsoHere: g.alsoHere === true, children: g.children.map((c) => c.ref) })),
    [
    {
      label: "Also here",
      alsoHere: false,
      children: [
        "_content/den/Book_One.doc.card",
      ],
    },
    {
      label: "Also here",
      alsoHere: true,
      children: [
        "_content/den/Lamp.doc.card",
      ],
    },
  ],
  );
});

// ## No ordinary cards left, no "Also here"
//
// Every card here is already in a tier, so the page adds no empty group.
void test("Every card here is already in a tier, so the page adds no empty group.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L340
  const box = await makeTmpBox();
  await box.write("_content/tidy/Tidy.landmark.card", "---\nnavigation:\n  label: Tidy\n---\n");
  await box.write("_content/tidy/Start.doc.card", "---\ntitle: Start\nprominence: entry-point\n---\n");
  await box.write("_content/tidy/Log.chat.card", "---\nsession: s1\n---\n");
  t.check((await payload(box.root, { dir: "_content/tidy", expandsAsGroups: true })).groups, []);
});

// ## A tile carries its card type's summary line
//
// Each row carries `detail`, the line the card's type writes about itself
// through `summarize` (docs/implemented-plans/place-shows-cards.md, Track B). A box-authored
// `loan` type writes who has it and when it is due. The loan cards do not
// write `type:` on disk; the type comes from the filename, as loading a card
// does, so the line is still there. A card whose type writes no line, a
// loan that fails validation, and a loan file whose written `type:` names
// another type (the card loader rejects it) have none.
void test("Each row carries detail, the line the card's type writes about itself through...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L363
  const fs = await import("node:fs/promises");

  // doctest:L365
  const box = await makeTmpBox({ deps: true });
  await fs.mkdir(box.path("src/schemas"), { recursive: true });
  await fs.writeFile(box.path("src/schemas/loan.ts"), `import { body, cardSchema } from "beebox/cards";
import { z } from "beebox/schema";

export default cardSchema("loan", {
  fields: { item: z.string(), holder: z.string(), due: z.string(), body: body(z.string()) },
  instructions: "# Loan Cards",
  summarize: (card, base) => ({ ...base, title: card.item, detail: \`\${card.holder} has it · back by \${card.due}\` }),
});
`);
  await box.write("_content/lending/Lending.landmark.card", "---\nnavigation:\n  label: Lending\n---\n");
  await box.write("_content/lending/Stove.loan.card", "---\nitem: Camp stove\nholder: Idris\ndue: 2026-10-17\n---\n");
  await box.write("_content/lending/Broken.loan.card", "---\nitem: Ladder\n---\n");
  await box.write("_content/lending/Rules.doc.card", "---\ntitle: House rules\n---\n");
  await box.write("_content/lending/Mislabeled.loan.card", "---\ntype: doc\nitem: Tent\nholder: Bram\ndue: 2026-11-01\n---\n");
  const [also] = (await payload(box.root, { dir: "_content/lending", expandsAsGroups: true })).groups;
  assert.ok(also);
  t.check(also.children.map((c) => [c.title, c.detail ?? null]).toSorted(), [
    [
      "Broken",
      null,
    ],
    [
      "Camp stove",
      "Idris has it · back by 2026-10-17",
    ],
    [
      "House rules",
      null,
    ],
    [
      "Mislabeled",
      null,
    ],
  ]);
});

// ## A landmark with a body is still read as a place
//
// The landmark's body is the place summary (Track C). The lightweight reader
// parses only the frontmatter, so a body changes nothing about the payload.
void test("The landmark's body is the place summary (Track C).", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L397
  const box = await makeTmpBox();
  await box.write("_content/lending/Lending.landmark.card",
    "---\nnavigation:\n  label: Lending\n  links:\n    - ref: Stove.doc.card\n---\nThe [stove](Stove.doc.card) is with Idris.\n");
  await box.write("_content/lending/Stove.doc.card", "---\ntitle: Stove\n---\n");
  const p = await payload(box.root, { dir: "_content/lending", expandsAsGroups: true });
  t.check(({ label: p.label, links: rows(p.links) }), {
    label: "Lending",
    links: [
      "listed _content/lending/Stove.doc.card",
    ],
  });
});
