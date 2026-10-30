// boxSlug: a box's URL slug, derived from where it lives on disk.
//
// shapeVersion 3 has one root, so `path.basename(boxRoot)` is the box's own
// directory name. (The v2 trap: `boxRoot` was a `content/` directory nested
// inside a package, so every box's basename was the literal "content".)
// `boxSlug` reads the shape and returns `path.basename(shape.boxRoot)`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { boxSlug, boxSlugFromShape } from "../../src/lib/box-slug.js";
import { getBoxShape } from "../../src/lib/box-shape.js";
import { writeBoxFiles } from "../helpers/test-helpers.js";

/** A minimal shapeVersion-3 box named `name` under `parent`. */
async function makeBox(parent: string, name: string): Promise<string> {
  const boxRoot = join(parent, name);
  await writeBoxFiles(boxRoot, { name });
  return boxRoot;
}

void test("boxSlug", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "bbx-box-slug-"));
  t.teardown(() => rm(parent, { recursive: true, force: true }));
  const alpha = await makeBox(parent, "alpha");
  const beta = await makeBox(parent, "beta");

  // Two different boxes get two different slugs: their root directory names.
  t.check([await boxSlug(alpha), await boxSlug(beta)], ["alpha", "beta"]);

  // boxSlugFromShape is the same answer for a caller that already resolved
  // the shape, so the two never disagree.
  t.check(boxSlugFromShape(await getBoxShape(alpha)), "alpha");

  // A marker-less directory has no shape (the plain-directory serve mode)
  // and falls back to its own basename.
  const plain = join(parent, "just-a-dir");
  await mkdir(plain);
  await t.check(boxSlug(plain), "just-a-dir");
});

// ## On a unit host the box's directory is always `box`, so the slug is its parent's
//
// docs/plans/per-box-units.md: `/var/lib/beebox/<slug>/box`, one home per box.
// Found on production at the migration: every box asked for its grants as "box".
// Off a unit host a directory named `box` is a box named "box", as before.
void test("On a unit host the slug is the parent of a directory named box", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "bbx-box-slug-unit-"));
  const previous = process.env.BBX_UNIT_HOST;
  t.teardown(async () => {
    if (previous === undefined) delete process.env.BBX_UNIT_HOST;
    else process.env.BBX_UNIT_HOST = previous;
    await rm(parent, { recursive: true, force: true });
  });
  await mkdir(join(parent, "gamma"));
  const gamma = await makeBox(join(parent, "gamma"), "box");
  const plain = join(parent, "delta", "box");
  await mkdir(plain, { recursive: true });

  delete process.env.BBX_UNIT_HOST;
  t.check([await boxSlug(gamma), await boxSlug(plain)], ["box", "box"]);

  process.env.BBX_UNIT_HOST = "1";
  t.check([await boxSlug(gamma), boxSlugFromShape(await getBoxShape(gamma)), await boxSlug(plain)], ["gamma", "gamma", "delta"]);
});
