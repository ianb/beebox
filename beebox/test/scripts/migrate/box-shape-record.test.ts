// # `box-shape-record-2026-10`: the shape moves into package.json
//
// The migration copies `shapeVersion` and `created` from the gitignored
// `.beebox/box.json` marker into a `beebox` block in the box's tracked
// `package.json`, so a clone of the box is a box. It leaves the marker on disk,
// and tracked where it was tracked, so an engine from before the block still
// opens the box after a deploy rollback (boxholder decision, 2026-10-20).
// Plan: `docs/implemented-plans/box-shape-in-package-json.md`, Track D.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { planShapeRecord } from "../../../src/scripts/migrate/box-shape-record/plan.js";
import { runBoxShapeRecord } from "../../../src/scripts/migrate/box-shape-record/run.js";
import { sweepMigrations } from "../../../src/core/migration-sweep.js";
import { MANIFEST_PATH, MIGRATIONS } from "../../../src/core/migrations.js";
import { getBoxShape } from "../../../src/lib/box-shape.js";
import { makeTmpBox, useMarkerOnly, type TmpBox } from "../../helpers/test-helpers.js";

const MARKER = JSON.stringify({ version: "1.0.0", created: "2026-01-30T23:37:19.468Z", shapeVersion: 3, "migrated-at": "2026-09-05T08:38:03.986Z" });
const git = (root: string, ...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** A committed box from before the migration: no block, the marker on disk, the migration pending. */
async function unmigratedBox(t: Test, { trackMarker }: { trackMarker: boolean }): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await useMarkerOnly(box.root, MARKER);
  await box.write(MANIFEST_PATH, MIGRATIONS.filter((m) => m.name !== "box-shape-record-2026-10")
    .map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-10-01T00:00:00Z" })).join("\n") + "\n");
  if (trackMarker) git(box.root, "add", "-f", ".beebox/box.json");
  box.commitAll("before box-shape-record-2026-10");
  return box;
}

// ## The decision
//
// Other keys keep their order and the block goes last. A marker without both
// fields, or an older shape, is refused with the fix rather than completed
// with a guess.
void test("planShapeRecord copies the marker or refuses", async (t) => {
  const pkg = JSON.stringify({ name: "a-box", dependencies: { beebox: "*" } });
  t.check({
    write: planShapeRecord({ packageJson: pkg, marker: MARKER }),
    converted: planShapeRecord({ packageJson: JSON.stringify({ beebox: { shapeVersion: 3, created: "2026-01-01T00:00:00Z" } }), marker: null }),
    noMarker: planShapeRecord({ packageJson: pkg, marker: null }).kind,
    noCreated: planShapeRecord({ packageJson: pkg, marker: JSON.stringify({ shapeVersion: 3 }) }).kind,
    older: planShapeRecord({ packageJson: pkg, marker: JSON.stringify({ shapeVersion: 2, created: "x" }) }).kind,
    malformedBlock: planShapeRecord({ packageJson: JSON.stringify({ beebox: { shapeVersion: "3" } }), marker: MARKER }).kind,
  }, {
    write: {
      kind: "write",
      created: "2026-01-30T23:37:19.468Z",
      packageJson: JSON.stringify({ name: "a-box", dependencies: { beebox: "*" }, beebox: { shapeVersion: 3, created: "2026-01-30T23:37:19.468Z" } }, null, 2) + "\n",
    },
    converted: { kind: "already-converted" },
    noMarker: "refuse",
    noCreated: "refuse",
    older: "refuse",
    malformedBlock: "refuse",
  });
});

// ## On a box
//
// A dry run writes nothing. The applied run writes the block, keeps the marker
// on disk, and a rerun has nothing to do. Then a clone of the box is a box.
void test("The runner records the block and a clone of the result is a box", async (t) => {
  const box = await unmigratedBox(t, { trackMarker: false });
  const dry = await runBoxShapeRecord({ boxRoot: box.root, mode: "plan" });
  const unchanged = JSON.parse(await box.read("package.json")).beebox ?? "no block";
  const applied = await runBoxShapeRecord({ boxRoot: box.root, mode: "apply" });
  const again = await runBoxShapeRecord({ boxRoot: box.root, mode: "apply" });
  box.commitAll("Apply migration: box-shape-record-2026-10");
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-shape-clone-"));
  t.teardown(() => fs.rm(parent, { recursive: true, force: true }));
  const clone = path.join(parent, "clone");
  execFileSync("git", ["clone", "--quiet", box.root, clone], { stdio: "pipe" });
  t.check({
    dry: dry.lines,
    unchanged,
    applied: applied.lines,
    block: JSON.parse(await box.read("package.json")).beebox,
    markerKept: await box.read(".beebox/box.json"),
    again: again.lines,
    cloneMarker: await fs.access(path.join(clone, ".beebox/box.json")).then(() => "present", () => "absent"),
    cloneShape: await getBoxShape(clone),
  }, {
    dry: ["would add \"beebox\": { \"shapeVersion\": 3, \"created\": \"2026-01-30T23:37:19.468Z\" } to package.json (dry run; pass --apply)"],
    unchanged: "no block",
    applied: ["box-shape-record: added \"beebox\": { \"shapeVersion\": 3, \"created\": \"2026-01-30T23:37:19.468Z\" } to package.json."],
    block: { shapeVersion: 3, created: "2026-01-30T23:37:19.468Z" },
    markerKept: MARKER,
    again: ["box-shape-record: already converted."],
    cloneMarker: "absent",
    cloneShape: { shapeVersion: 3, boxRoot: clone },
  });
});

// ## Through the real sweep, on a box that tracks its marker
//
// Production boxes tracked the marker. The sweep commits `package.json` and the
// manifest and leaves the tree clean; the marker stays tracked until the
// deferred cleanup deletes it
// (`issues/deferred/2026-10-20-drop-box-marker-fallback.md`).
void test("The sweep commits the block and leaves a tracked marker tracked", async (t) => {
  const box = await unmigratedBox(t, { trackMarker: true });
  const result = await sweepMigrations({ boxRoot: box.root });
  t.check({
    status: result.status,
    committed: git(box.root, "show", "--name-only", "--format=%s", "HEAD").split("\n"),
    status_: git(box.root, "status", "--porcelain"),
    markerTracked: git(box.root, "ls-files", ".beebox/box.json"),
    block: JSON.parse(git(box.root, "show", "HEAD:package.json")).beebox,
  }, {
    status: "applied",
    committed: ["Apply migration: box-shape-record-2026-10", "", "_config/migrations.jsonl", "package.json"],
    status_: "",
    markerTracked: ".beebox/box.json",
    block: { shapeVersion: 3, created: "2026-01-30T23:37:19.468Z" },
  });
});
