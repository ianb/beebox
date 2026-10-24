// # A git clone of a box is a box
//
// A box records its identity and shape in tracked files: `package.json`
// declares `beebox` and carries the `beebox` block, and `_config/` sits beside
// it. The old marker lived in the gitignored `.beebox/`, so a clone had none
// and was not a box (issues/bugs/2026-10-20-box-marker-in-gitignored-state-dir.md).
// This file clones real boxes with real git and checks every predicate that
// decides "is this a box".

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { isValidBox } from "../../../src/core/box/structure/core.js";
import { detectBoxTarget } from "../../../src/core/box/package.js";
import { isBox } from "../../../src/core/schedule/scheduler/core.js";
import { getBoxShape } from "../../../src/lib/box-shape.js";
import { findBoxRoot } from "../../../src/lib/paths/core.js";
import { setShapeBlock } from "../../../src/lib/box-identity.js";
import { runInit } from "../../../src/cli/commands/init.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

// `bbx init` installs git hooks and then commits generated docs, so the hook
// runs a real `bbx`. Pin this checkout's, as the other hook-running tests do.
process.env["BBX_HOOK_BIN"] = path.join(PACKAGE_ROOT, "bin", "bbx");

async function cloneOf(source: string): Promise<string> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-clone-"));
  const clone = path.join(parent, "clone");
  execFileSync("git", ["clone", "--quiet", source, clone], { stdio: "pipe" });
  return clone;
}

const markerState = (root: string): Promise<string> =>
  fs.access(path.join(root, ".beebox/box.json")).then(() => "present", () => "absent");

/** Run `fn` with console.log silenced (a re-init that changes something prints a list). */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

// ## A clone of a current box
//
// Every predicate accepts the clone, and `bbx init` on it takes the update path
// instead of refusing "already has a package.json". It also links the clone's
// portable `beebox` dependency to the running engine.
void test("A clone of a box is recognized as a box and re-inits", async (t) => {
  const box = await makeTmpBox({ git: true });
  const clone = await cloneOf(box.root);
  t.teardown(async () => {
    await box.cleanup();
    await fs.rm(path.dirname(clone), { recursive: true, force: true });
  });
  t.check({
    marker: await markerState(clone),
    isValidBox: await isValidBox(clone),
    isBox: await isBox(clone),
    shape: await getBoxShape(clone),
    findBoxRoot: await findBoxRoot(path.join(clone, "_content", "inbox")),
    detectBoxTarget: (await detectBoxTarget(clone)).mode,
    init: await quietly(() => runInit(clone, { branch: "main" })).then(() => "completed"),
    // The clone has no gitignored engine link; the re-init makes it.
    engineLink: await fs.readlink(path.join(clone, ".beebox/engine")),
  }, {
    engineLink: PACKAGE_ROOT,
    marker: "absent",
    isValidBox: true,
    isBox: true,
    shape: { shapeVersion: 3, boxRoot: clone },
    findBoxRoot: clone,
    detectBoxTarget: "update",
    init: "completed",
  });
});

// ## A clone of a box that has not migrated
//
// A box from before `box-shape-record-2026-10` records its shape only in the
// gitignored marker, so its clone has no record at all. That is refused with a
// named error and a recovery line, never opened with a guessed version: the
// rollout prerequisite is that the source box migrates first.
void test("A clone of an unmigrated box gets MissingShapeRecordError with recovery", async (t) => {
  const box = await makeTmpBox({ git: true });
  const pkgPath = box.path("package.json");
  await fs.writeFile(pkgPath, setShapeBlock(await fs.readFile(pkgPath, "utf-8"), null));
  await box.write(".beebox/box.json", JSON.stringify({ version: "1.0.0", shapeVersion: 3, created: "2026-01-01T00:00:00.000Z" }));
  box.commitAll("before the shape-record migration");
  const clone = await cloneOf(box.root);
  t.teardown(async () => {
    await box.cleanup();
    await fs.rm(path.dirname(clone), { recursive: true, force: true });
  });
  const failure = (e: unknown): string =>
    e instanceof Error ? `${e.name}${e.message.includes("run `bbx engine migrate` in the box it was cloned from") ? " with recovery" : ""}` : "non-error";
  t.check({
    source: (await getBoxShape(box.root)).shapeVersion,
    isValidBox: await isValidBox(clone),
    shape: await getBoxShape(clone).then(() => "opened", failure),
    init: await quietly(() => runInit(clone, { branch: "main" })).then(() => "completed", failure),
  }, {
    source: 3,
    isValidBox: true,
    shape: "MissingShapeRecordError with recovery",
    init: "MissingShapeRecordError with recovery",
  });
});
