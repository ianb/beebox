// # A box's own name and mark
//
// `readBoxIdentity` (`core/landmark/box-identity.ts`) answers what to call a box
// and what mark to show for it, from the landmark card at the box root — the same
// card the Landmarks page and the app bar's place pill already read. Every
// `/api/boxes` listing goes through it, so this is what the box switcher, the
// dashboard header, and the browser tab all say.

import { test } from "tap";
import "agent-doctest/tap";
import { readBoxIdentity } from "../../../src/core/landmark/box-identity.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";

const identity = (box: TmpBox) => readBoxIdentity({ boxRoot: box.root, slug: "kitchen-box" });

// ## The root landmark names the box
void test("The root landmark names the box", async (t) => {
  // doctest:L20
  const box = await makeTmpBox();
  await box.write("_content/Kitchen.landmark.card", "---\nsymbol:\n  glyph: 🍳\nnavigation:\n  label: Kitchen\n---\n");
  t.check(await identity(box), {
    slug: "kitchen-box",
    name: "Kitchen",
    symbol: {
      glyph: "🍳",
    },
  });
});

// ## An image symbol comes back as a box-relative path
//
// A `{ src }` symbol resolves through the shared ref algebra, so a box-root ref
// stays inside the box rather than becoming a filesystem path.
void test("A { src } symbol resolves through the shared ref algebra, so a box-root ref s...", async (t) => {
  // doctest:L32
  const box = await makeTmpBox();
  await box.write("_content/Box.landmark.card", "---\nsymbol:\n  src: /_content/art/pan.png\nnavigation:\n  label: Kitchen\n---\n");
  t.check(await identity(box), {
    slug: "kitchen-box",
    name: "Kitchen",
    symbol: {
      src: "_content/art/pan.png",
    },
  });
});

// ## Every failure degrades to the slug
//
// A box that cannot say its own name is still a box you must be able to open, so
// nothing here throws: no landmark card at all, a card with no label, and a card
// whose frontmatter isn't a landmark all answer with the slug and no mark.
void test("A box that cannot say its own name is still a box you must be able to open, s...", async (t) => {
  // doctest:L45
  const bare = await makeTmpBox();

  // doctest:L47
  const unlabelled = await makeTmpBox();
  await unlabelled.write("_content/Box.landmark.card", "---\nsymbol:\n  glyph: 📦\nnavigation: {}\n---\n");

  // doctest:L50
  const broken = await makeTmpBox();
  await broken.write("_content/Box.landmark.card", "---\nnot-a-landmark: true\n---\n");

  // doctest:L53
  t.check(
    [
      (await identity(bare)).name,
      await identity(unlabelled),
      (await identity(broken)).name,
    ],
    [
    "kitchen-box",
    {
      slug: "kitchen-box",
      name: "kitchen-box",
      symbol: {
        glyph: "📦",
      },
    },
    "kitchen-box",
  ],
  );
});

// ## One landmark per directory, chosen stably
//
// A box root that somehow holds two landmark cards picks the same one every
// time — sorted, not whatever `readdir` returned — so a box doesn't change its
// name between requests.
void test("A box root that somehow holds two landmark cards picks the same one every tim...", async (t) => {
  // doctest:L68
  const box = await makeTmpBox();
  await box.write("_content/Zebra.landmark.card", "---\nnavigation:\n  label: Zebra\n---\n");
  await box.write("_content/Alpha.landmark.card", "---\nnavigation:\n  label: Alpha\n---\n");
  t.check((await identity(box)).name, "Alpha");
});

// ## The old scaffold's label is not a name
//
// Boxes created before the scaffold learned to name the box carry `label: Box` —
// the same word on every box in the fleet, which tells a tab strip less than the
// slug does. It reads as unset; the box's symbol still counts.
void test("Boxes created before the scaffold learned to name the box carry label:", async (t) => {
  // doctest:L82
  const box = await makeTmpBox();
  await box.write("_content/Box.landmark.card", "---\nsymbol:\n  glyph: 📦\nnavigation:\n  label: Box\n---\n");
  t.check(await identity(box), {
    slug: "kitchen-box",
    name: "kitchen-box",
    symbol: {
      glyph: "📦",
    },
  });
});
