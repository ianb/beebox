// # Nearest landmark directory
//
// Resolving the directory whose chat a "chat about this card" action binds to:
// the deepest landmark directory that is an ancestor-or-self of the card's
// directory, or `""` (the box root) when none encloses it. See
// `src/core/landmark/nearest.ts` and `docs/plans/open-chat-from-card.md`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  nearestDirFromDirs,
  nearestLandmarkDir,
  isBoxRelativeCardPath,
  boxRelativePathSchema,
} from "../../../src/core/landmark/nearest.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

// ## nearestDirFromDirs (pure matching)
//
// Deepest enclosing landmark wins. With a root landmark (`""`) and a mid-tree one,
// a card under the mid-tree dir binds to the deeper one:
void test("Deepest enclosing landmark wins.", async (t) => {
  t.check(nearestDirFromDirs("class/activities/shared/Logprobs.sandbox.card", ["", "class/activities"]), "class/activities");
});

// A card with no enclosing non-root landmark falls back to the root (`""`):
void test("A card with no enclosing non-root landmark falls back to the root (\"\"):", async (t) => {
  t.check(nearestDirFromDirs("store/notes/idea.doc.card", ["class/activities"]), "");
});

// A card directly at the box root resolves to the root, never a sibling landmark:
void test("A card directly at the box root resolves to the root, never a sibling landmark:", async (t) => {
  t.check(nearestDirFromDirs("Inbox.doc.card", ["class/activities"]), "");
});

// A sibling/prefix-overlap dir does not falsely enclose — `class/act` must not
// match a card under `class/activities/`:
void test("A sibling/prefix-overlap dir does not falsely enclose — class/act must not ma...", async (t) => {
  t.check(nearestDirFromDirs("class/activities/x.card", ["class/act", "class/activities"]), "class/activities");
});

// The landmark's own directory encloses cards sitting directly in it:
void test("The landmark's own directory encloses cards sitting directly in it:", async (t) => {
  t.check(nearestDirFromDirs("class/activities/Index.card", ["class/activities"]), "class/activities");
});

// ## nearestLandmarkDir (globs the box)
//
// Landmark directories are keyed on the `*.landmark.card` filename — a glob, no
// parse — so the body's validity doesn't gate which directory counts as a
// landmark. Seed a root and a nested landmark, then resolve a deep card:
void test("Landmark directories are keyed on the .landmark.card filename — a glob, no pa...", async (t) => {
  const box = await makeTmpBox();
  await box.write("Home.landmark.card", "---\ntype: landmark\n---\n");
  await box.write("class/activities/Activities.landmark.card", "garbled not-even-yaml {{{");
  t.check(await nearestLandmarkDir(box.root, { cardPath: "class/activities/shared/Logprobs.sandbox.card" }), "class/activities");
});

// A card outside any landmarked subtree falls back to the root:
void test("A card outside any landmarked subtree falls back to the root:", async (t) => {
  const box = await makeTmpBox();
  await box.write("class/activities/Activities.landmark.card", "---\ntype: landmark\n---\n");
  t.check(await nearestLandmarkDir(box.root, { cardPath: "store/notes/idea.doc.card" }), "");
});

// ## isBoxRelativeCardPath (traversal guard)
//
// The `?card=` value flows into `card.get`; `openForCard` rejects paths that could
// escape the box:
void test("The ?card= value flows into card.get; openForCard rejects paths that could es...", async (t) => {
  t.check(
    [
      isBoxRelativeCardPath("class/activities/x.card"),
      isBoxRelativeCardPath("/etc/passwd"),
      isBoxRelativeCardPath("../../etc/passwd"),
      isBoxRelativeCardPath("a/../../b.card"),
    ].join(" "),
    "true false false false",
  );
});

// ## `boxRelativePathSchema` rejects a display-form path with a message naming the canonical form
//
// Every tRPC procedure that takes a `contextDir`/`dir`/card-path string through
// this schema (`chat.startSession`'s `contextDir`, `landmarks.hqPreferences`'s
// `dir`, …) gets this for free — a display-form leak (`Config:box.json`) fails
// zod input validation, which tRPC reports as `BAD_REQUEST` carrying the zod
// issue message (`docs/plans/display-path-guard.subplan.md`).
void test("Every tRPC procedure that takes a contextDir/dir/card-path string through thi...", async (t) => {
  const ok = boxRelativePathSchema.safeParse("class/activities/x.card");
  t.check(ok.success, true);

  const displayForm = boxRelativePathSchema.safeParse("Config:box.json");
  t.check(displayForm.success, false);

  t.check(displayForm.success ? "" : displayForm.error.issues[0]!.message, "`Config:box.json` is the boxholder's display form; write `/_config/box.json`");
});
