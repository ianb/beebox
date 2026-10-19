// # The prominence index — pruned subtrees
//
// `prunedSubtree(boxRoot, dir)` answers "which cards under this landmark's
// directory carry a level, and what does the pruned tree boil down to" —
// `docs/implemented-plans/card-prominence.md`, Track B. It stops at any directory that has
// its own landmark card (contributing one `nested` entry instead), never
// enters an OWNED `<basename>.attach/` scope unless that scope holds its own
// landmark, and folds to nothing under a `background` landmark — the top one
// or any ancestor.

import { test } from "tap";
import "agent-doctest/tap";
import { unordered } from "agent-doctest/check";
import { utimes } from "node:fs/promises";
import { prunedSubtree } from "../../../src/core/landmark/prominence-index.js";
import { getParseCount, resetParseCount } from "../../../src/core/landmark/prominence-cache.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

// ## A directory of mixed cards: only non-ordinary levels are indexed
void test("A directory of mixed cards: only non-ordinary levels are indexed", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L29
  const box = await makeTmpBox();
  await box.write("_content/Entry.doc.card", "---\nprominence: entry-point\n---\n");
  await box.write("_content/Primary1.doc.card", "---\nprominence: primary\n---\n");
  await box.write("_content/Primary2.doc.card", "---\nprominence: primary\n---\n");
  await box.write("_content/Ordinary.doc.card", "---\n---\n");
  // A system-category card is background BY TYPE with no declared prominence.
  await box.write("_content/Job.contains-backfill-job.card", "---\ndescription: test\nitems: []\n---\n");

  // doctest:L37
  const { entries, nested, summary } = await prunedSubtree(box.root, "");
  t.check(entries, unordered([
    { boxPath: "/_content/Entry.doc.card", level: "entry-point", kind: "card" },
    { boxPath: "/_content/Job.contains-backfill-job.card", level: "background", kind: "card" },
    { boxPath: "/_content/Primary1.doc.card", level: "primary", kind: "card" },
    { boxPath: "/_content/Primary2.doc.card", level: "primary", kind: "card" },
  ]));

  // doctest:L45
  t.check(nested, []);

  // doctest:L48
  t.check(summary, {
    hasEntryPoint: true,
    primaryCount: 2,
    background: false,
  });
});

// ## A nested landmark stops the walk and contributes one entry
//
// A `primary` card inside a directory that has its own landmark card is never
// indexed by the OUTER pruned subtree — the nested landmark is the one entry,
// and the box path is a `kind: "landmark"` entry too (`nested` carries its
// tile metadata; `entries` carries it so the resolver can place it in its own
// tier).
void test("A primary card inside a directory that has its own landmark card is never ind...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L65
  const box = await makeTmpBox();
  await box.write("_content/Sub/Sub.landmark.card", "---\nnavigation:\n  label: Sub\n---\n");
  await box.write("_content/Sub/SubPrimary.doc.card", "---\nprominence: primary\n---\n");

  // doctest:L69
  const { entries, nested, summary } = await prunedSubtree(box.root, "");
  t.check(entries, [{ boxPath: "/_content/Sub/Sub.landmark.card", level: "background", kind: "landmark" }]);

  // doctest:L73
  t.check(nested, [
    { path: "_content/Sub/Sub.landmark.card", dir: "_content/Sub", label: "Sub", symbol: null, prominence: null },
  ]);

  // doctest:L76
  t.check(summary, {
    hasEntryPoint: false,
    primaryCount: 0,
    background: false,
  });
});

// ## A background landmark contributes nothing, and excludes its subtree
//
// A landmark written `prominence: background` is not itself an entry (it
// contributes NOTHING, not even a background-level entry) and its cards never
// count toward the outer directory's summary.
void test("A landmark written prominence:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L91
  const box = await makeTmpBox();
  await box.write("_content/BG/BG.landmark.card", "---\nprominence: background\n---\n");
  await box.write("_content/BG/BGPrimary.doc.card", "---\nprominence: primary\n---\n");

  // doctest:L95
  const { entries, nested, summary } = await prunedSubtree(box.root, "");
  t.check(entries, []);

  // doctest:L100
  t.check(nested, []);

  // doctest:L103
  t.check(summary, {
    hasEntryPoint: false,
    primaryCount: 0,
    background: false,
  });
});

// ## An owned attach scope is skipped, not walked
//
// A card living inside its owner's `<basename>.attach/` directory is folded
// into the owner everywhere else in the app (Browse); the pruned walk follows
// the same fold and never surfaces it as its own entry.
void test("A card living inside its owner's <basename>.attach/ directory is folded into...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L118
  const box = await makeTmpBox();
  await box.write("_content/Att.doc.card", "---\n---\n");
  await box.write("_content/Att.attach/AttPrimary.doc.card", "---\nprominence: primary\n---\n");

  // doctest:L122
  const { entries, summary } = await prunedSubtree(box.root, "");
  t.check(entries, []);

  // doctest:L127
  t.check(summary, {
    hasEntryPoint: false,
    primaryCount: 0,
    background: false,
  });

  // An attach scope that holds ITS OWN landmark card is a nested landmark like
  // any other, not skipped:

  // doctest:L135
  await box.write("_content/Course.doc.card", "---\n---\n");
  await box.write("_content/Course.attach/Course.landmark.card", "---\nnavigation:\n  label: Course notes\n---\n");
  await box.write("_content/Course.attach/CoursePrimary.doc.card", "---\nprominence: primary\n---\n");

  // doctest:L139
  const after = await prunedSubtree(box.root, "");
  t.check(after.nested, [
    { path: "_content/Course.attach/Course.landmark.card", dir: "_content/Course.attach", label: "Course notes", symbol: null, prominence: null },
  ]);
});

// ## A `background` ancestor landmark folds a directory with no landmark of its own
//
// `Deeper/` has no landmark card, but its ancestor `BG/` is a `background`
// landmark — the cascade folds `Deeper` too.
void test("Deeper/ has no landmark card, but its ancestor BG/ is a background landmark —...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L154
  const box = await makeTmpBox();
  await box.write("_content/BG/BG.landmark.card", "---\nprominence: background\n---\n");
  await box.write("_content/BG/Deeper/DeeperPrimary.doc.card", "---\nprominence: primary\n---\n");

  // doctest:L158
  const { entries, summary } = await prunedSubtree(box.root, "_content/BG/Deeper");
  t.check(entries, []);

  // doctest:L163
  t.check(summary, {
    hasEntryPoint: false,
    primaryCount: 0,
    background: true,
  });

  // The root landmark is the box's identity, not a place that can be
  // housekeeping: `background` written there is ignored (and lint-warned), so the
  // root's own walk and every descendant's still run.

  // doctest:L172
  await box.write("_content/Box.landmark.card", "---\nprominence: background\nnavigation:\n  label: Box\n---\n");
  await box.write("_content/Top.doc.card", "---\nprominence: primary\n---\n");
  const root = await prunedSubtree(box.root, "");
  t.check(root.entries, [{ boxPath: "/_content/Top.doc.card", level: "primary", kind: "card" }]);

  // doctest:L178
  t.check(root.summary, { hasEntryPoint: false, primaryCount: 1, background: false });
});

// ## Ordinary cards are listed with their mtimes
//
// `ordinary` lists every `ordinary`-level card the walk reached, with its file
// mtime, for the place page's "Also here" group. A briefing is ordinary: the
// person reads it as their own page. Chat husks, capture sessions and upload
// batches are `background` by type, so they are not listed; neither is a card
// inside a nested place.
void test("ordinary lists every ordinary-level card the walk reached, with its file mtim...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L195
  const box = await makeTmpBox();
  await box.write("_content/Groceries.doc.card", "---\n---\n");
  await box.write("_content/Box.briefing.card", "---\n---\nAbout this box.\n");
  await box.write("_content/chat/web/Hello.chat.card", "---\nsession: s1\n---\n");
  await box.write("_content/tmp-capture/Walk.capture-session.card", "---\n---\n");
  await box.write("_content/tmp-upload/Batch.upload-batch.card", "---\n---\n");
  await box.write("_content/Sub/Sub.landmark.card", "---\nnavigation:\n  label: Sub\n---\n");
  await box.write("_content/Sub/Nested.doc.card", "---\n---\n");
  await utimes(box.path("_content/Groceries.doc.card"), 1_700_000_000, 1_700_000_000);
  await utimes(box.path("_content/Box.briefing.card"), 1_700_000_100, 1_700_000_100);

  // doctest:L206
  const { ordinary, entries } = await prunedSubtree(box.root, "");
  t.check(ordinary, unordered([
    { boxPath: "/_content/Box.briefing.card", mtimeMs: 1_700_000_100_000 },
    { boxPath: "/_content/Groceries.doc.card", mtimeMs: 1_700_000_000_000 },
  ]));

  // doctest:L215
  t.check(entries, unordered([
    { boxPath: "/_content/Sub/Sub.landmark.card", level: "background", kind: "landmark" },
    { boxPath: "/_content/tmp-capture/Walk.capture-session.card", level: "background", kind: "card" },
    { boxPath: "/_content/tmp-upload/Batch.upload-batch.card", level: "background", kind: "card" },
    { boxPath: "/_content/chat/web/Hello.chat.card", level: "background", kind: "card" },
  ]));
});

// ## A warm second call parses nothing
//
// The per-file cache (`prominence-cache.ts`) memoizes each file's parse by
// identity; only discovery (the `readdir` walk itself) repeats.
void test("The per-file cache (prominence-cache.ts) memoizes each file's parse by identi...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L233
  const box = await makeTmpBox();
  await box.write("_content/Entry.doc.card", "---\nprominence: entry-point\n---\n");
  await box.write("_content/Sub/Sub.landmark.card", "---\nnavigation:\n  label: Sub\n---\n");

  // doctest:L237
  await prunedSubtree(box.root, "");

  // doctest:L239
  resetParseCount();
  await prunedSubtree(box.root, "");
  t.check(getParseCount(), 0);
});

// ## A large box stays cached
//
// A walk reads every card under its place, so the cache must hold a whole
// large box. A cap of 4,096 files once cleared the cache partway through every
// walk of a box with about 9,000 cards, and each walk parsed every card again.
// Here 4,500 cards, more than that old cap, are all parsed once and then never
// again.
void test("A walk reads every card under its place, so the cache must hold a whole large...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L258
  const box = await makeTmpBox();
  await Promise.all(
    Array.from({ length: 4500 }, (_, i) => box.write(`_content/d${i % 30}/Card${i}.doc.card`, "---\n---\n")),
  );

  // doctest:L263
  resetParseCount();
  await prunedSubtree(box.root, "");
  const cold = getParseCount();
  resetParseCount();
  await prunedSubtree(box.root, "");
  t.check({ cold, warm: getParseCount() }, {
    cold: 4500,
    warm: 0,
  });
});
