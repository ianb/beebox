// # Box identity and the recorded shape version
//
// `src/lib/box-identity.ts` decides whether a directory is a box from TRACKED
// files — a `package.json` declaring `beebox` beside `_config/` — so a
// `git clone` of a box is a box. The shape version is read from the
// `package.json` `beebox` block first, then from the gitignored
// `.beebox/box.json` marker that boxes carry until the
// `box-shape-record-2026-10` migration
// (`docs/implemented-plans/box-shape-in-package-json.md`).

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { isBoxRoot, probeBoxLevel, readShapeRecord, refuseV2 } from "../../src/lib/box-identity.js";
import { LEGACY_BOX_MARKER, LEGACY_BOX_STATE_DIR } from "../../src/lib/state-migration.js";
import { getBoxShape } from "../../src/lib/box-shape.js";
import { writeBoxFiles } from "../helpers/test-helpers.js";

async function tmpDir(t: Test): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-identity-"));
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** The error name a promise rejects with, or "ok". */
const outcome = (promise: Promise<unknown>): Promise<string> =>
  promise.then(() => "ok", (e: unknown) => (e instanceof Error ? e.name : "non-error"));

// ## Identity
//
// Both halves are needed: the dependency and the `_config/` sibling. A v2
// package root counts by its `content/config/`. A `package.json` that does not
// parse is an error once the sibling says this is meant to be a box.
void test("isBoxRoot needs the beebox dependency and a structural sibling", async (t) => {
  const box = await tmpDir(t);
  await writeBoxFiles(box);
  const noSibling = await tmpDir(t);
  await fs.writeFile(path.join(noSibling, "package.json"), JSON.stringify({ dependencies: { beebox: "*" } }));
  const otherPackage = await tmpDir(t);
  await fs.mkdir(path.join(otherPackage, "_config"));
  await fs.writeFile(path.join(otherPackage, "package.json"), JSON.stringify({ dependencies: { lodash: "1" } }));
  const devDependency = await tmpDir(t);
  await fs.mkdir(path.join(devDependency, "_config"));
  await fs.writeFile(path.join(devDependency, "package.json"), JSON.stringify({ devDependencies: { beebox: "*" } }));
  const v2 = await tmpDir(t);
  await fs.mkdir(path.join(v2, "content", "config"), { recursive: true });
  await fs.writeFile(path.join(v2, "package.json"), JSON.stringify({ dependencies: { beebox: "*" } }));
  const broken = await tmpDir(t);
  await fs.mkdir(path.join(broken, "_config"));
  await fs.writeFile(path.join(broken, "package.json"), "{not json");
  // The sibling must be a directory: a regular file named `_config` is not one.
  const configFile = await tmpDir(t);
  await fs.writeFile(path.join(configFile, "_config"), "");
  await fs.writeFile(path.join(configFile, "package.json"), JSON.stringify({ dependencies: { beebox: "*" }, beebox: { shapeVersion: 3, created: "x" } }));

  t.check({
    box: await isBoxRoot(box),
    noSibling: await isBoxRoot(noSibling),
    otherPackage: await isBoxRoot(otherPackage),
    devDependency: await isBoxRoot(devDependency),
    v2: await isBoxRoot(v2),
    empty: await isBoxRoot(await tmpDir(t)),
    broken: await outcome(isBoxRoot(broken)),
    configFile: await isBoxRoot(configFile),
  }, {
    box: true,
    noSibling: false,
    otherPackage: false,
    devDependency: true,
    v2: true,
    empty: false,
    broken: "UnreadablePackageJsonError",
    configFile: false,
  });
});

// ## The shape record
//
// The block wins over a marker. A marker alone is the fallback and keeps its
// `created`. Neither is a named error with a recovery line, never a guessed
// version.
void test("readShapeRecord reads the block, then the marker", async (t) => {
  const block = await tmpDir(t);
  await writeBoxFiles(block, { created: "2026-02-03T04:05:06.000Z" });
  await fs.mkdir(path.join(block, ".beebox"));
  await fs.writeFile(path.join(block, ".beebox/box.json"), JSON.stringify({ shapeVersion: 2 }));

  const marker = await tmpDir(t);
  await writeBoxFiles(marker, { shapeVersion: null });
  await fs.mkdir(path.join(marker, ".beebox"));
  await fs.writeFile(path.join(marker, ".beebox/box.json"),
    JSON.stringify({ version: "1.0.0", created: "2026-01-30T23:37:19.468Z", shapeVersion: 3, "migrated-at": "2026-09-05T08:38:03.986Z" }));

  const neither = await tmpDir(t);
  await writeBoxFiles(neither, { shapeVersion: null });

  t.check({
    block: await readShapeRecord(block),
    marker: await readShapeRecord(marker),
  }, {
    block: { shapeVersion: 3, created: "2026-02-03T04:05:06.000Z", source: "package" },
    marker: { shapeVersion: 3, created: "2026-01-30T23:37:19.468Z", source: "marker" },
  });
  const missing = await readShapeRecord(neither).catch((e: unknown) => e);
  t.check(missing instanceof Error ? { name: missing.name, recovery: missing.message.includes("run `bbx engine migrate` in the box it was cloned from") } : missing,
    { name: "MissingShapeRecordError", recovery: true });
});

// A malformed block, an older block, and a newer block are each refused; the
// newer one keeps the forward-compatibility refusal.
void test("readShapeRecord refuses a malformed, older, or newer block", async (t) => {
  const malformed = await tmpDir(t);
  await writeBoxFiles(malformed);
  await fs.writeFile(path.join(malformed, "package.json"),
    JSON.stringify({ dependencies: { beebox: "*" }, beebox: { shapeVersion: "3", created: "x" } }));
  const older = await tmpDir(t);
  await writeBoxFiles(older, { shapeVersion: 2 });
  const newer = await tmpDir(t);
  await writeBoxFiles(newer, { shapeVersion: 4 });
  t.check({
    malformed: await outcome(readShapeRecord(malformed)),
    older: await outcome(readShapeRecord(older)),
    newer: await outcome(readShapeRecord(newer)),
  }, {
    malformed: "BoxShapeError",
    older: "PreV3ShapeError",
    newer: "NewerShapeRequiredError",
  });
});

// ## The v2 probe
//
// A v2 package root is refused whether it is recognized by its nested marker
// or by its `content/config/` beside a beebox `package.json`. A v3 box with a
// `content/` folder of its own is not mistaken for one.
void test("refuseV2 recognizes both v2 forms and leaves v3 alone", async (t) => {
  const nestedMarker = await tmpDir(t);
  await fs.mkdir(path.join(nestedMarker, "content", ".beebox"), { recursive: true });
  await fs.writeFile(path.join(nestedMarker, "content", ".beebox", "box.json"), JSON.stringify({ shapeVersion: 2 }));
  const contentConfig = await tmpDir(t);
  await fs.mkdir(path.join(contentConfig, "content", "config"), { recursive: true });
  await fs.writeFile(path.join(contentConfig, "package.json"), JSON.stringify({ dependencies: { beebox: "*" } }));
  const v3 = await tmpDir(t);
  await writeBoxFiles(v3);
  await fs.mkdir(path.join(v3, "content", "config"), { recursive: true });
  t.check({
    nestedMarker: await outcome(refuseV2(nestedMarker)),
    contentConfig: await outcome(refuseV2(contentConfig)),
    v3: await outcome(refuseV2(v3)),
    plain: await outcome(refuseV2(await tmpDir(t))),
  }, {
    nestedMarker: "V2PackageRootError",
    contentConfig: "V2PackageRootError",
    v3: "ok",
    plain: "ok",
  });
});

// ## One discovery level
//
// `probeBoxLevel` is what `findBoxRoot` asks of each directory. The
// retired-name marker alone still counts, so `requireBoxRoot` can reach the
// state migration that moves it; a retired-name STATE directory alone does not.
// A valid `.beebox/box.json` alone does not make a box: identity is the
// dependency plus the sibling. A marker that predates v3 is still diagnosed
// there (a v1 box had no package.json).
void test("probeBoxLevel: identity, marker, retired-name marker, and nothing", async (t) => {
  const identity = await tmpDir(t);
  await writeBoxFiles(identity);
  const markerOnly = await tmpDir(t);
  await fs.mkdir(path.join(markerOnly, ".beebox"));
  await fs.writeFile(path.join(markerOnly, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
  const legacyMarker = await tmpDir(t);
  await fs.writeFile(path.join(legacyMarker, LEGACY_BOX_MARKER), JSON.stringify({ shapeVersion: 3 }));
  const legacyStateOnly = await tmpDir(t);
  await fs.mkdir(path.join(legacyStateOnly, LEGACY_BOX_STATE_DIR));
  const unrecorded = await tmpDir(t);
  await writeBoxFiles(unrecorded, { shapeVersion: null });
  const unrelatedWithMarker = await tmpDir(t);
  await fs.writeFile(path.join(unrelatedWithMarker, "package.json"), JSON.stringify({ name: "some-app", dependencies: { lodash: "1" } }));
  await fs.mkdir(path.join(unrelatedWithMarker, ".beebox"));
  await fs.writeFile(path.join(unrelatedWithMarker, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
  const v1 = await tmpDir(t);
  await fs.mkdir(path.join(v1, ".beebox"));
  await fs.writeFile(path.join(v1, ".beebox/box.json"), JSON.stringify({ version: "1.0.0" }));
  t.check({
    identity: await probeBoxLevel(identity),
    markerOnly: await probeBoxLevel(markerOnly),
    legacyMarker: await probeBoxLevel(legacyMarker),
    legacyStateOnly: await probeBoxLevel(legacyStateOnly),
    nothing: await probeBoxLevel(await tmpDir(t)),
    unrecorded: await outcome(probeBoxLevel(unrecorded)),
    unrelatedWithMarker: await probeBoxLevel(unrelatedWithMarker),
    unrelatedGetBoxShape: await outcome(getBoxShape(unrelatedWithMarker)),
    v1: await outcome(probeBoxLevel(v1)),
  }, {
    identity: true,
    markerOnly: false,
    legacyMarker: true,
    legacyStateOnly: false,
    nothing: false,
    unrecorded: "MissingShapeRecordError",
    unrelatedWithMarker: false,
    unrelatedGetBoxShape: "NotABoxError",
    v1: "PreV3ShapeError",
  });
});
