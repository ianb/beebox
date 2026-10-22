// # Closed-vocabulary root check
//
// `checkBoxRoot` (`src/lib/box-root-check.ts`) readdirs a box root and reports
// every entry outside `BOX_ROOT_VOCABULARY` — the check that turns a recreated
// two-root shape into one loud `bbx validate` (Track C,
// `docs/implemented-plans/one-root-box-layout.md`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir } from "node:fs/promises";
import { checkBoxRoot } from "../../src/lib/box-root-check.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// A box with only vocabulary entries — areas, npm namespace, agent identity —
// reports nothing:
void test("A box with only vocabulary entries — areas, npm namespace, agent identity — r...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/x.doc.card", "---\ntitle: Note\n---\n");
  await box.write("package.json", "{}");
  await box.write("AGENTS.md", "# Box\n");
  t.check(await checkBoxRoot(box.root), []);
});

// A stray non-underscore directory — the "user content lives loose at the root"
// mistake — is reported as a closed-vocabulary violation:
void test("A stray non-underscore directory — the \"user content lives loose at the root\"...", async (t) => {
  t.teardown(async () => {
    try {
      await strayBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const strayBox = await makeTmpBox();
  await strayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
  const strays = await checkBoxRoot(strayBox.root);
  t.check(strays.map((s) => ({ name: s.name, kind: s.kind })), [
    {
      name: "recipes",
      kind: "unlisted",
    },
  ]);

  t.check(strays[0]!.message, "recipes: the box root is a closed vocabulary — user content goes under /_content/");
});

// A running reactor holds `.bbx-reactor.lock` plus its guard directory
// `.bbx-reactor.lock.guard/` (`src/lib/file-lock.ts` locks by `mkdir` of the
// guard). Both are legal, so the pre-commit root check does not refuse the
// commit a reactor job makes. The guard rule is derived from listed lock names,
// so an unlisted `.guard` is still a stray:
void test("A running reactor holds .bbx-reactor.lock plus its guard directory .bbx-react...", async (t) => {
  t.teardown(async () => {
    try {
      await lockBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const lockBox = await makeTmpBox();
  await lockBox.write(".bbx-reactor.lock", "{}");
  await mkdir(`${lockBox.root}/.bbx-reactor.lock.guard`);
  await mkdir(`${lockBox.root}/.bbx-other.lock.guard`);
  t.check((await checkBoxRoot(lockBox.root)).map((s) => s.name), [
    ".bbx-other.lock.guard",
  ]);
});

// A stray `content/` directory gets a message calling out the specific
// recreated-two-root failure mode this check exists to catch:
void test("A stray content/ directory gets a message calling out the specific recreated-...", async (t) => {
  t.teardown(async () => {
    try {
      await legacyBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const legacyBox = await makeTmpBox();
  await legacyBox.write("content/box/inbox/x.doc.card", "---\ntitle: Note\n---\n");
  const legacyStrays = await checkBoxRoot(legacyBox.root);
  t.check(legacyStrays[0]!.message, "content: the box root is a closed vocabulary — user content goes under /_content/ (this is the pre-migration operational-root name — a v2 leftover, not a place to write to)");
});

// An unlisted underscore directory — an ad hoc `_scratch`, say — gets its own,
// more specific message: the underscore areas are a closed FIVE, not an open
// convention:
void test("An unlisted underscore directory — an ad hoc scratch, say — gets its own, mor...", async (t) => {
  t.teardown(async () => {
    try {
      await adHocBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const adHocBox = await makeTmpBox();
  await adHocBox.write("_scratch/notes.txt", "hi");
  const adHocStrays = await checkBoxRoot(adHocBox.root);
  t.check(adHocStrays.map((s) => ({ name: s.name, kind: s.kind })), [
    {
      name: "_scratch",
      kind: "ad-hoc-underscore",
    },
  ]);

  t.check(adHocStrays[0]!.message, "_scratch: ad hoc underscore directories are reserved — the underscore areas are exactly _content, _config, _bookkeeping, _publish, _tmp; rename or remove this one");
});

// OS/editor junk (`.DS_Store` and friends) is ignored outright, not reported —
// and multiple strays all come back, sorted:
void test("OS/editor junk (.DSStore and friends) is ignored outright, not reported — and...", async (t) => {
  t.teardown(async () => {
    try {
      await junkBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const junkBox = await makeTmpBox();
  await junkBox.write(".DS_Store", "");
  await junkBox.write("zebra/x.txt", "z");
  await junkBox.write("_ad_hoc/x.txt", "a");
  const junkStrays = await checkBoxRoot(junkBox.root);
  t.check(junkStrays.map((s) => s.name).join(","), "_ad_hoc,zebra");
});

// A box root that doesn't exist yet reports no strays — there is nothing to
// flag, and the caller's own box-root resolution is a separate failure mode:
void test("A box root that doesn't exist yet reports no strays — there is nothing to fla...", async (t) => {
  t.check(await checkBoxRoot("/nonexistent/not-a-real-box-root-12345"), []);
});
