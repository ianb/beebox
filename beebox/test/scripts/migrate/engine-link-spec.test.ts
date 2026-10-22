// # `engine-link-spec-2026-10`: the box commits a portable beebox dependency
//
// Deploy, `bbx init`, and worktree setup each wrote this machine's engine path
// into the box's tracked `package.json`, so box history carried a path that
// resolves only there. The migration replaces a machine-local `link:` spec
// with `link:.beebox/engine` and points the gitignored `.beebox/engine` at the
// old target. A pinned engine (a `file:` tarball, a semver range, a link into
// the box) is left alone.
// Plan: `docs/implemented-plans/portable-engine-dependency.md`, Track B.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { lockfileIsPortable, planEngineSpec } from "../../../src/scripts/migrate/engine-link-spec/plan.js";
import { runEngineLinkSpec } from "../../../src/scripts/migrate/engine-link-spec/run.js";
import { sweepMigrations } from "../../../src/core/migration-sweep.js";
import { MANIFEST_PATH, MIGRATIONS } from "../../../src/core/migrations.js";
import { makeTmpBox, useMarkerOnly, type TmpBox } from "../../helpers/test-helpers.js";

const git = (root: string, ...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const PORTABLE_LOCK = "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      beebox:\n        specifier: link:.beebox/engine\n        version: link:.beebox/engine\n";
const pkg = (beebox: string, extra?: Record<string, unknown>): string =>
  JSON.stringify({ name: "a-box", dependencies: { beebox, react: "^18.3.1" }, ...extra });

/** A fake engine package outside any box. */
async function fakeEngine(t: Test): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bbx-fake-engine-")));
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "beebox", version: "1.0.0" }));
  return dir;
}

/** A committed box whose dependency is `spec`, with this migration pending. */
async function boxWith(t: Test, { spec, extra }: { spec: string; extra?: Record<string, unknown> }): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const current = JSON.parse(await box.read("package.json"));
  await box.write("package.json", JSON.stringify({ ...current, dependencies: { ...current.dependencies, beebox: spec }, ...extra }, null, 2) + "\n");
  await box.write(MANIFEST_PATH, MIGRATIONS.filter((m) => m.name !== "engine-link-spec-2026-10")
    .map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-10-01T00:00:00Z" })).join("\n") + "\n");
  box.commitAll("before engine-link-spec-2026-10");
  return box;
}

// ## The decision
//
// A `pnpm.overrides.beebox` wins over the dependency, as it does for pnpm.
// Only a `link:` spec converts; the override goes, and an `overrides` or
// `pnpm` object it leaves empty goes with it. Everything else is a pin.
void test("plan converts link specs and leaves pins", async (t) => {
  const worktree = pkg("link:/w/beebox", { pnpm: { onlyBuiltDependencies: ["esbuild"], overrides: { beebox: "link:/w/beebox" } } });
  t.check({
    absolute: planEngineSpec(pkg("link:/opt/beebox/beebox")),
    worktree: planEngineSpec(worktree),
    onlyOverride: planEngineSpec(pkg("^1.0.0", { pnpm: { overrides: { beebox: "link:../engine" } } })),
    leftoverOverride: planEngineSpec(pkg("link:.beebox/engine", { pnpm: { overrides: { beebox: "link:.beebox/engine" } } })).kind,
    dev: planEngineSpec(JSON.stringify({ devDependencies: { beebox: "link:/e" } })),
    tarball: planEngineSpec(pkg("file:/app/beebox.tgz")),
    range: planEngineSpec(pkg("^1.0.0")),
    portable: planEngineSpec(pkg("link:.beebox/engine")),
    none: planEngineSpec(JSON.stringify({ dependencies: { react: "^18.3.1" } })).kind,
    notObject: planEngineSpec("[]").kind,
  }, {
    absolute: { kind: "convert", linkTarget: "/opt/beebox/beebox", packageJson: JSON.stringify({ name: "a-box", dependencies: { beebox: "link:.beebox/engine", react: "^18.3.1" } }, null, 2) + "\n" },
    worktree: { kind: "convert", linkTarget: "/w/beebox", packageJson: JSON.stringify({ name: "a-box", dependencies: { beebox: "link:.beebox/engine", react: "^18.3.1" }, pnpm: { onlyBuiltDependencies: ["esbuild"] } }, null, 2) + "\n" },
    onlyOverride: { kind: "convert", linkTarget: "../engine", packageJson: JSON.stringify({ name: "a-box", dependencies: { beebox: "link:.beebox/engine", react: "^18.3.1" } }, null, 2) + "\n" },
    leftoverOverride: "convert",
    dev: { kind: "convert", linkTarget: "/e", packageJson: JSON.stringify({ devDependencies: { beebox: "link:.beebox/engine" } }, null, 2) + "\n" },
    tarball: { kind: "pinned", spec: "file:/app/beebox.tgz" },
    range: { kind: "pinned", spec: "^1.0.0" },
    portable: { kind: "already-portable" },
    none: "refuse",
    notObject: "refuse",
  });
});

// ## Through the real sweep
//
// The commit holds only `package.json` and the manifest (the box has no
// lockfile here), and the committed `package.json` names no machine path. The
// engine link points at the old target, and a rerun has nothing to do.
void test("the sweep commits the portable spec with no machine path", async (t) => {
  const engine = await fakeEngine(t);
  const box = await boxWith(t, { spec: `link:${engine}`, extra: { pnpm: { overrides: { beebox: `link:${engine}` } } } });
  const result = await sweepMigrations({ boxRoot: box.root });
  const committed = git(box.root, "show", "HEAD:package.json");
  t.check({
    status: result.status,
    paths: git(box.root, "show", "--name-only", "--format=%s", "HEAD").split("\n"),
    clean: git(box.root, "status", "--porcelain"),
    spec: JSON.parse(committed).dependencies.beebox,
    pnpm: JSON.parse(committed).pnpm ?? "none",
    machinePath: committed.includes(engine),
    link: await fs.readlink(box.path(".beebox/engine")),
    again: await runEngineLinkSpec({ boxRoot: box.root, mode: "apply" }),
  }, {
    status: "applied",
    paths: ["Apply migration: engine-link-spec-2026-10", "", "_config/migrations.jsonl", "package.json"],
    clean: "",
    spec: "link:.beebox/engine",
    // The fixture's `pnpm` held only the override, so it goes with it.
    pnpm: "none",
    machinePath: false,
    link: engine,
    again: { code: 0, lines: ["engine-link-spec: already converted."] },
  });
});

// ## Left alone or refused
//
// A link into the box is a pin: linking to it would let the next install
// remove the engine the link names. A dead target with no usable link exits 1
// with the repair and writes nothing. A dry run writes nothing.
void test("run skips pins, refuses a dead target, and dry-runs", async (t) => {
  const inBox = await boxWith(t, { spec: "link:./vendor/beebox" });
  await inBox.write("vendor/beebox/package.json", JSON.stringify({ name: "beebox" }));
  const dead = await boxWith(t, { spec: "link:/nonexistent/beebox" });
  const engine = await fakeEngine(t);
  const dry = await boxWith(t, { spec: `link:${engine}` });
  const tarball = await boxWith(t, { spec: "file:/app/beebox.tgz" });
  t.check({
    inBox: await runEngineLinkSpec({ boxRoot: inBox.root, mode: "apply" }),
    inBoxSpec: JSON.parse(await inBox.read("package.json")).dependencies.beebox,
    dead: await runEngineLinkSpec({ boxRoot: dead.root, mode: "apply" }),
    deadSpec: JSON.parse(await dead.read("package.json")).dependencies.beebox,
    dry: await runEngineLinkSpec({ boxRoot: dry.root, mode: "plan" }),
    dryLink: await fs.lstat(dry.path(".beebox/engine")).then(() => "present", () => "absent"),
    tarball: await runEngineLinkSpec({ boxRoot: tarball.root, mode: "apply" }),
  }, {
    inBox: { code: 0, lines: ["engine-link-spec: skipped: pinned engine (link:./vendor/beebox is inside the box)."] },
    inBoxSpec: "link:./vendor/beebox",
    dead: { code: 1, lines: [`engine-link-spec: the engine at /nonexistent/beebox is missing; link one with \`ln -sfn <engine checkout>/beebox ${path.join(dead.root, ".beebox/engine")}\` and rerun. Nothing written.`] },
    deadSpec: "link:/nonexistent/beebox",
    dry: { code: 0, lines: ["would set \"beebox\": \"link:.beebox/engine\" and link .beebox/engine (dry run; pass --apply)"] },
    dryLink: "absent",
    tarball: { code: 0, lines: ["engine-link-spec: skipped: pinned engine (file:/app/beebox.tgz)."] },
  });
});

// ## The tracked lockfile
//
// A box that tracks `pnpm-lock.yaml` gets it refreshed against the new spec. A
// failed refresh restores both files and exits 1, so the migration stays
// pending and the manifest never disagrees with the tracked lockfile.
void test("run refreshes the lockfile, and restores both files when that fails", async (t) => {
  const engine = await fakeEngine(t);
  const failing = await boxWith(t, { spec: `link:${engine}` });
  await failing.write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const before = await failing.read("package.json");
  const failed = await runEngineLinkSpec({
    boxRoot: failing.root,
    mode: "apply",
    refreshLockfile: async (boxRoot) => {
      await fs.writeFile(path.join(boxRoot, "pnpm-lock.yaml"), "half-written\n");
      return { code: 1, output: "ERR_PNPM_NO_OFFLINE_META  Failed to resolve react\n" };
    },
  });
  const passing = await boxWith(t, { spec: `link:${engine}` });
  await passing.write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const passed = await runEngineLinkSpec({
    boxRoot: passing.root,
    mode: "apply",
    refreshLockfile: async (boxRoot) => {
      await fs.writeFile(path.join(boxRoot, "pnpm-lock.yaml"), PORTABLE_LOCK);
      return { code: 0, output: "" };
    },
  });
  t.check({
    failed,
    packageRestored: await failing.read("package.json"),
    lockfileRestored: await failing.read("pnpm-lock.yaml"),
    passed: passed.code,
    lockfile: await passing.read("pnpm-lock.yaml"),
  }, {
    failed: {
      code: 1,
      lines: [
        `engine-link-spec: \`pnpm install --lockfile-only --prefer-offline\` failed in ${failing.root} (exit 1); package.json and pnpm-lock.yaml restored, the migration stays pending.`,
        "ERR_PNPM_NO_OFFLINE_META  Failed to resolve react",
      ],
    },
    packageRestored: before,
    lockfileRestored: "lockfileVersion: '9.0'\n",
    passed: 0,
    lockfile: PORTABLE_LOCK,
  });
});

// ## The lockfile decides "already converted"
//
// pnpm v9 records the root importer's specifier and any top-level override.
// Only a lockfile with the portable specifier and no beebox override agrees
// with a converted manifest.
void test("lockfileIsPortable reads the importer specifier and overrides", async (t) => {
  const importer = (spec: string): string => `importers:\n\n  .:\n    dependencies:\n      beebox:\n        specifier: ${spec}\n        version: ${spec}\n`;
  t.check({
    portable: lockfileIsPortable(`lockfileVersion: '9.0'\n\n${importer("link:.beebox/engine")}`),
    machine: lockfileIsPortable(`lockfileVersion: '9.0'\n\n${importer("link:/opt/beebox/beebox")}`),
    overridden: lockfileIsPortable(`lockfileVersion: '9.0'\n\noverrides:\n  react: 18.3.1\n  beebox: link:/w/beebox\n\n${importer("link:.beebox/engine")}`),
    empty: lockfileIsPortable("lockfileVersion: '9.0'\n"),
    machineVersion: lockfileIsPortable("lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      beebox:\n        specifier: link:.beebox/engine\n        version: link:/opt/beebox/beebox\n"),
  }, { portable: true, machine: false, overridden: false, empty: false, machineVersion: false });
});

// ## A failed spawn, then the rerun
//
// When pnpm cannot even start (not on PATH), both files are restored as for a
// nonzero exit. A box left with a converted manifest and a stale lockfile (an
// interrupted earlier run) is not "already converted": the rerun refreshes
// the lockfile first, and a failure there keeps it pending.
void test("run restores both files when the refresh cannot spawn, and a rerun refreshes a stale lockfile", async (t) => {
  const engine = await fakeEngine(t);
  const stale = `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      beebox:\n        specifier: link:${engine}\n        version: link:${engine}\n`;
  const box = await boxWith(t, { spec: `link:${engine}` });
  await box.write("pnpm-lock.yaml", stale);
  const before = await box.read("package.json");
  const spawnFailed = await runEngineLinkSpec({
    boxRoot: box.root,
    mode: "apply",
    refreshLockfile: async () => { throw new Error("spawn pnpm ENOENT"); },
  });
  const restored = { packageJson: await box.read("package.json"), lockfile: await box.read("pnpm-lock.yaml") };

  // The interrupted state: manifest converted, lockfile still stale.
  await box.write("package.json", JSON.stringify({ ...JSON.parse(before), dependencies: { ...JSON.parse(before).dependencies, beebox: "link:.beebox/engine" } }, null, 2) + "\n");
  const rerunFailed = await runEngineLinkSpec({ boxRoot: box.root, mode: "apply", refreshLockfile: async () => ({ code: 1, output: "offline" }) });
  const rerun = await runEngineLinkSpec({
    boxRoot: box.root,
    mode: "apply",
    refreshLockfile: async (boxRoot) => {
      await fs.writeFile(path.join(boxRoot, "pnpm-lock.yaml"), stale.replaceAll(`link:${engine}`, "link:.beebox/engine"));
      return { code: 0, output: "" };
    },
  });
  const after = await runEngineLinkSpec({ boxRoot: box.root, mode: "apply" });
  t.check({ spawnFailed: spawnFailed.lines[0], restored, rerunFailed: rerunFailed.code, rerun, after }, {
    spawnFailed: `engine-link-spec: \`pnpm install --lockfile-only --prefer-offline\` failed in ${box.root} (exit 1); package.json and pnpm-lock.yaml restored, the migration stays pending.`,
    restored: { packageJson: before, lockfile: stale },
    rerunFailed: 1,
    rerun: { code: 0, lines: ["engine-link-spec: refreshed pnpm-lock.yaml for \"link:.beebox/engine\"."] },
    after: { code: 0, lines: ["engine-link-spec: already converted."] },
  });
});

// ## A refresh that exits 0 but leaves another engine
//
// The run checks the lockfile after the refresh. One that still records a
// machine path is a failure: both files are restored and the run exits 1.
void test("run restores both files when the refreshed lockfile is still not portable", async (t) => {
  const engine = await fakeEngine(t);
  const box = await boxWith(t, { spec: `link:${engine}` });
  await box.write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const before = await box.read("package.json");
  const result = await runEngineLinkSpec({
    boxRoot: box.root,
    mode: "apply",
    refreshLockfile: async (boxRoot) => {
      await fs.writeFile(path.join(boxRoot, "pnpm-lock.yaml"), PORTABLE_LOCK.replace("version: link:.beebox/engine", "version: link:/opt/beebox/beebox"));
      return { code: 0, output: "" };
    },
  });
  t.check({ result, packageJson: await box.read("package.json"), lockfile: await box.read("pnpm-lock.yaml") }, {
    result: {
      code: 1,
      lines: [
        `engine-link-spec: \`pnpm install --lockfile-only --prefer-offline\` failed in ${box.root} (exit 1); package.json and pnpm-lock.yaml restored, the migration stays pending.`,
        "pnpm-lock.yaml still does not record \"beebox\": \"link:.beebox/engine\" after the refresh.",
      ],
    },
    packageJson: before,
    lockfile: "lockfileVersion: '9.0'\n",
  });
});

// ## A dead in-box pin stays a pin
//
// `link:./vendor/beebox` points into the box. It is a pin by where it points,
// even when the vendored engine is gone and deploy has made a usable
// `.beebox/engine`.
void test("run leaves a dead in-box link pinned when the engine link works", async (t) => {
  const engine = await fakeEngine(t);
  const box = await boxWith(t, { spec: "link:./vendor/beebox" });
  await fs.mkdir(box.path(".beebox"), { recursive: true });
  await fs.symlink(engine, box.path(".beebox/engine"));
  t.check({
    result: await runEngineLinkSpec({ boxRoot: box.root, mode: "apply" }),
    spec: JSON.parse(await box.read("package.json")).dependencies.beebox,
  }, {
    result: { code: 0, lines: ["engine-link-spec: skipped: pinned engine (link:./vendor/beebox is inside the box)."] },
    spec: "link:./vendor/beebox",
  });
});

// ## Order: the spec converts before box-shape-record commits package.json
//
// Both migrations write `package.json`. If box-shape-record ran first, its
// commit would carry the machine path into history once more. With both
// pending, no commit the sweep makes contains the old link.
void test("the sweep converts the spec before box-shape-record commits package.json", async (t) => {
  const engine = await fakeEngine(t);
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const current = JSON.parse(await box.read("package.json"));
  await box.write("package.json", JSON.stringify({ ...current, dependencies: { ...current.dependencies, beebox: `link:${engine}` } }, null, 2) + "\n");
  await useMarkerOnly(box.root, JSON.stringify({ version: "1.0.0", shapeVersion: 3, created: "2026-01-30T23:37:19.468Z" }));
  const pending = new Set(["engine-link-spec-2026-10", "box-shape-record-2026-10"]);
  await box.write(MANIFEST_PATH, MIGRATIONS.filter((m) => !pending.has(m.name))
    .map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-10-01T00:00:00Z" })).join("\n") + "\n");
  box.commitAll("before both");
  const base = git(box.root, "rev-parse", "HEAD");
  await sweepMigrations({ boxRoot: box.root });
  const commits = git(box.root, "log", "--format=%H %s", `${base}..HEAD`).split("\n").toReversed();
  t.check(commits.map((line) => {
    const [sha = "", ...subject] = line.split(" ");
    return { subject: subject.join(" "), machinePath: git(box.root, "show", `${sha}:package.json`).includes(engine) };
  }), [
    { subject: "Apply migration: engine-link-spec-2026-10", machinePath: false },
    { subject: "Apply migration: box-shape-record-2026-10", machinePath: false },
  ]);
});
