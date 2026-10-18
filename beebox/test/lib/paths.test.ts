// # Path Utilities
//
// Utilities for working with card filenames and Bee Box directory structure.

import { test } from "tap";
import "agent-doctest/tap";
import { parseCardName, isCardFile, findBoxRoot } from "../../src/lib/paths/core.js";
import { PreV3ShapeError } from "../../src/lib/box-shape-errors.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Whether `findBoxRoot(dir)` throws the migration-pointing pre-v3 error. */
async function findBoxRootThrowsPreV3(dir: string): Promise<boolean> {
  try {
    await findBoxRoot(dir);
    return false;
  } catch (e) {
    return e instanceof PreV3ShapeError;
  }
}

// ## Card filenames
//
// Card files follow the pattern `Name.type.card`. The name can contain dots, but the type is always the last segment before `.card`.
void test("Card files follow the pattern Name.type.card.", async (t) => {
  // doctest:L28
  t.check(parseCardName("Test.doc.card"), {
    name: "Test",
    type: "doc",
  });
});

// Positional names (bare `<type>.card` — "the ‹type› of this directory") parse
// with the stem doing double duty as name and type:
void test("Positional names (bare <type>.card — \"the ‹type› of this directory\") parse wi...", async (t) => {
  // doctest:L40
  t.check(parseCardName("nav.card"), {
    name: "nav",
    type: "nav",
  });
});

// Returns `null` for strings that aren't valid card filenames:
void test("Returns null for strings that aren't valid card filenames:", async (t) => {
  // doctest:L51
  t.check(parseCardName("no-extension"), null);

  // doctest:L54
  t.check(parseCardName(".card"), null);
});

// ## Checking card files
//
// `isCardFile` is a simple extension check — any path ending in `.card`:
void test("isCardFile is a simple extension check — any path ending in .card:", async (t) => {
  // doctest:L63
  t.check(isCardFile("Test.doc.card"), true);

  // doctest:L66
  t.check(isCardFile("Test.card.bak"), false);
});

// ## `findBoxRoot` refuses a pre-v3 marker
//
// A v3 box (`makeTmpBox`'s default scaffold) resolves normally:
void test("A v3 box (makeTmpBox's default scaffold) resolves normally:", async (t) => {
  t.teardown(async () => {
    try {
      await v3Box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L75
  const v3Box = await makeTmpBox();
  await t.checkText((await findBoxRoot(v3Box.root)) === v3Box.root, "true");
});

// A directory with NO marker anywhere above it still returns `null` — ordinary
// "not a box" discovery is untouched:
void test("A directory with NO marker anywhere above it still returns null — ordinary \"n...", async (t) => {
  t.teardown(async () => {
    try {
      await bareDir.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L88
  const bareDir = await makeTmpBox();
  const unmarkedSubdir = join(bareDir.root, "..", `bbx-doctest-unmarked-${String(Date.now())}`);
  await mkdir(unmarkedSubdir, { recursive: true });
  t.check(await findBoxRoot(unmarkedSubdir), null);

  // A marker whose `shapeVersion` predates 3 (the common "invoked from inside an
  // old v2 `content/` root" case) throws the migration-pointing error INSTEAD of
  // returning the directory — this is the fix for the original bug: `bbx tick`
  // run from inside such a directory used to silently resolve it as a valid box
  // root, find nothing under `_config/schedules`, and report zero-work success:

  // doctest:L102
  const v2ContentRoot = join(bareDir.root, "v2-content");
  await mkdir(join(v2ContentRoot, ".beebox"), { recursive: true });
  await writeFile(join(v2ContentRoot, ".beebox", "box.json"), JSON.stringify({ shapeVersion: 2 }));
  t.check(await findBoxRootThrowsPreV3(v2ContentRoot), true);

  // A marker with NO `shapeVersion` field at all (predates the field entirely)
  // throws the same way:

  // doctest:L113
  const noVersionRoot = join(bareDir.root, "no-version");
  await mkdir(join(noVersionRoot, ".beebox"), { recursive: true });
  await writeFile(join(noVersionRoot, ".beebox", "box.json"), JSON.stringify({}));
  t.check(await findBoxRootThrowsPreV3(noVersionRoot), true);
});
