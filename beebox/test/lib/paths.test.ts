// # Path Utilities
//
// Utilities for working with card filenames and Bee Box directory structure.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { instanceOf } from "@ianbicking/tap-check/check";
import { PreV3ShapeError } from "../../src/lib/box-shape-errors.js";
import { parseCardName, isCardFile, findBoxRoot } from "../../src/lib/paths/core.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ## Card filenames
//
// Card files follow the pattern `Name.type.card`. The name can contain dots, but the type is always the last segment before `.card`.
void test("Card files follow the pattern Name.type.card.", async (t) => {
  t.check(parseCardName("Test.doc.card"), {
    name: "Test",
    type: "doc",
  });
});

// Positional names (bare `<type>.card` — "the ‹type› of this directory") parse
// with the stem doing double duty as name and type:
void test("Positional names (bare <type>.card — \"the ‹type› of this directory\") parse wi...", async (t) => {
  t.check(parseCardName("nav.card"), {
    name: "nav",
    type: "nav",
  });
});

// A job card's type is its schema type (`intake-job`), the one templates and
// schemas are registered under; its name is the stem of its attach directory:
void test("A job card parses to its schema type and its attach-directory stem", async (t) => {
  t.check(parseCardName("Inbox_scan.intake.job.card"), {
    name: "Inbox_scan.intake",
    type: "intake-job",
  });
});

// Returns `null` for strings that aren't valid card filenames:
void test("Returns null for strings that aren't valid card filenames:", async (t) => {
  t.check(parseCardName("no-extension"), null);

  t.check(parseCardName(".card"), null);
});

// ## Checking card files
//
// `isCardFile` is a simple extension check — any path ending in `.card`:
void test("isCardFile is a simple extension check — any path ending in .card:", async (t) => {
  t.check(isCardFile("Test.doc.card"), true);

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
  const v3Box = await makeTmpBox();
  t.check(await findBoxRoot(v3Box.root), v3Box.root);
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
  const bareDir = await makeTmpBox();
  const unmarkedSubdir = join(bareDir.root, "..", `bbx-test-unmarked-${String(Date.now())}`);
  await mkdir(unmarkedSubdir, { recursive: true });
  t.check(await findBoxRoot(unmarkedSubdir), null);

  // A marker whose `shapeVersion` predates 3 (the common "invoked from inside an
  // old v2 `content/` root" case) throws the migration-pointing error INSTEAD of
  // returning the directory — this is the fix for the original bug: `bbx tick`
  // run from inside such a directory used to silently resolve it as a valid box
  // root, find nothing under `_config/schedules`, and report zero-work success:

  const v2ContentRoot = join(bareDir.root, "v2-content");
  await mkdir(join(v2ContentRoot, ".beebox"), { recursive: true });
  await writeFile(join(v2ContentRoot, ".beebox", "box.json"), JSON.stringify({ shapeVersion: 2 }));
  await t.checkThrows(() => findBoxRoot(v2ContentRoot), "PreV3ShapeError");
  t.check(await findBoxRoot(v2ContentRoot).catch((e: unknown) => e), instanceOf(PreV3ShapeError));

  // A marker with NO `shapeVersion` field at all (predates the field entirely)
  // throws the same way:

  const noVersionRoot = join(bareDir.root, "no-version");
  await mkdir(join(noVersionRoot, ".beebox"), { recursive: true });
  await writeFile(join(noVersionRoot, ".beebox", "box.json"), JSON.stringify({}));
  await t.checkThrows(() => findBoxRoot(noVersionRoot), "PreV3ShapeError");
  t.check(await findBoxRoot(noVersionRoot).catch((e: unknown) => e), instanceOf(PreV3ShapeError));
});

// ## `findBoxRoot` from inside a v2 `content/` directory
//
// A v2 package root keeps its operational tree under `content/` (with
// `content/config/`), so a command run from inside it walks up to the package
// root. There the v2 probe refuses it with the same error `getBoxShape` gives,
// instead of reporting a box with no recorded version.
void test("findBoxRoot from inside a v2 content/ dir names the v2 package root", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const v2Root = join(box.root, "_tmp", "v2-package");
  await mkdir(join(v2Root, "content", "config", "procedures"), { recursive: true });
  await writeFile(join(v2Root, "package.json"), JSON.stringify({ dependencies: { beebox: "*" } }));
  const error = await findBoxRoot(join(v2Root, "content", "config", "procedures")).catch((e: unknown) => e);
  t.check(error instanceof Error ? error.name : error, "V2PackageRootError");
});
