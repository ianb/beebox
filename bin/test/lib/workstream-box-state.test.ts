// # Workstream box-state preservation
//
// Workstream culling treats box repositories as changed data. Test setup and
// unmerged `keep` work pin a workstream, while preservation creates an explicit
// source-repository ref from which the clone can be reconstructed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

// Worktree setup recognizes boxes that still carry the pre-rename engine package
// name and migrates the dependency. The tracked dependency becomes the portable
// `link:.beebox/engine`, the engine override goes, and the gitignored
// `.beebox/engine` link holds the worktree's engine path.
void test("Worktree setup links the worktree engine and commits only the portable spec", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "box-engine-repoint-")));
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  const box = path.join(root, "box");
  const worktree = path.join(root, "new-worktree");
  await fs.mkdir(path.join(worktree, "beebox/bin"), { recursive: true });
  await fs.writeFile(path.join(worktree, "beebox/package.json"), JSON.stringify({ name: "beebox" }));
  await fs.copyFile(path.join(repoRoot, "beebox/bin/box-engine-link"), path.join(worktree, "beebox/bin/box-engine-link"));
  await fs.mkdir(box);
  const packageJson = path.join(box, "package.json");
  await fs.writeFile(packageJson, JSON.stringify({
    dependencies: { "callback-box": "^0.1.0", react: "^18.3.1" },
    pnpm: { overrides: { "callback-box": "link:/old/engine" } },
  }));
  execFileSync("bash", ["-c", [
    ". bin/lib/worktree-create.sh",
    'wt_create_repoint_box_engine "$PACKAGE_JSON" "$WORKTREE"',
  ].join("; ")], {
    cwd: repoRoot,
    env: { ...process.env, PACKAGE_JSON: packageJson, WORKTREE: worktree },
  });
  t.check(
    {
      packageJson: JSON.parse(await fs.readFile(packageJson, "utf8")),
      link: await fs.readlink(path.join(box, ".beebox/engine")),
    },
    {
      packageJson: { dependencies: { react: "^18.3.1", beebox: "link:.beebox/engine" } },
      link: path.join(worktree, "beebox"),
    },
  );
});

// A cloned box with a pinned engine (a `file:` tarball, a semver range, a link
// into the box) keeps it: worktree setup replaces only a machine-local link
// outside the box, and warns that the clone will not run the worktree engine.
void test("Worktree setup leaves a pinned engine in place and says so", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "box-engine-pinned-")));
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  const worktree = path.join(root, "wt");
  await fs.mkdir(path.join(worktree, "beebox/bin"), { recursive: true });
  await fs.writeFile(path.join(worktree, "beebox/package.json"), JSON.stringify({ name: "beebox" }));
  await fs.copyFile(path.join(repoRoot, "beebox/bin/box-engine-link"), path.join(worktree, "beebox/bin/box-engine-link"));
  const results: Record<string, { stderr: string; packageJson: string; link: string }> = {};
  for (const [name, spec] of [["tarball", "file:/app/beebox.tgz"], ["range", "^1.0.0"], ["inBox", "link:./vendor/beebox"]] as const) {
    const box = path.join(root, name);
    await fs.mkdir(box);
    const text = JSON.stringify({ dependencies: { beebox: spec } });
    await fs.writeFile(path.join(box, "package.json"), text);
    const run = spawnSync("bash", ["-c", '. bin/lib/worktree-create.sh; wt_create_repoint_box_engine "$PACKAGE_JSON" "$WORKTREE"'], {
      cwd: repoRoot,
      env: { ...process.env, PACKAGE_JSON: path.join(box, "package.json"), WORKTREE: worktree },
      encoding: "utf8",
    });
    results[name] = {
      stderr: run.stderr.trim(),
      packageJson: (await fs.readFile(path.join(box, "package.json"), "utf8")) === text ? "unchanged" : "rewritten",
      link: await fs.lstat(path.join(box, ".beebox/engine")).then(() => "present", () => "absent"),
    };
  }
  const warning = (name: string, spec: string): string =>
    `[worktree-create] WARNING: ${path.join(root, name)} keeps its pinned engine (${spec}); it will not run this worktree's engine`;
  t.check(results, {
    tarball: { stderr: warning("tarball", "file:/app/beebox.tgz"), packageJson: "unchanged", link: "absent" },
    range: { stderr: warning("range", "^1.0.0"), packageJson: "unchanged", link: "absent" },
    inBox: { stderr: warning("inBox", "link:./vendor/beebox"), packageJson: "unchanged", link: "absent" },
  });
});

// An existing clone with the tracked pre-rename box marker is made recognizable
// to the renamed engine without modifying the source box.
void test("An existing clone with the tracked pre-rename box marker is made recognizable...", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "box-marker-migrate-"));
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  const oldMarker = path.join(root, "content/.cb-box");
  const newMarker = path.join(root, "content/.beebox/box.json");
  await fs.mkdir(path.dirname(oldMarker), { recursive: true });
  await fs.writeFile(oldMarker, '{"shapeVersion":2}\n');
  execFileSync("bash", ["-c", [
    ". bin/lib/worktree-create.sh",
    'wt_create_migrate_box_marker "$BOX_PACKAGE"',
  ].join("; ")], {
    cwd: repoRoot,
    env: { ...process.env, BOX_PACKAGE: root },
  });
  t.check(
    {
      oldExists: await fs.stat(oldMarker).then(() => true, () => false),
      marker: await fs.readFile(newMarker, "utf8"),
    },
    {
    oldExists: false,
    marker: `{"shapeVersion":2}
`,
  },
  );
});

// Cull pins report the highest-priority reason until it is resolved: unmerged
// keep work, a test-setup branch, or a linked issue awaiting manual testing. Both
// supported YAML list forms are recognized.
void test("Cull pins report the highest-priority reason until it is resolved:", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cull-pins-"));
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  const mono = path.join(root, "mono");
  const source = path.join(root, "source");
  const clone = path.join(root, "boxes", "seam", "test1");
  await fs.mkdir(mono);
  await fs.mkdir(source);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(source, "state"), "base\n");
  git(source, ["add", "state"]);
  git(source, ["commit", "-qm", "base"]);
  await fs.mkdir(path.dirname(clone), { recursive: true });
  git(root, ["clone", "-q", source, clone]);
  git(clone, ["config", "user.email", "test@example.com"]);
  git(clone, ["config", "user.name", "Test"]);
  git(clone, ["checkout", "-qb", "keep"]);
  await fs.writeFile(path.join(clone, "state"), "keep\n");
  git(clone, ["commit", "-qam", "keep"]);

  const pin = (): string => execFileSync("bash", ["-c", [
    ". bin/lib/workstream-box-state.sh",
    "workstream_cull_pin_reason seam",
  ].join("; ")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      WT_MONO: mono,
      WT_BOX_ROOT: path.join(root, "boxes"),
      WT_BOX_SRC: source,
    },
    encoding: "utf8",
  }).trim();
  t.check(pin(), "keep-unmerged");

  git(source, ["fetch", "-q", clone, "keep:keep"]);
  git(source, ["merge", "--ff-only", "keep"]);
  git(clone, ["branch", "test-setup"]);
  t.check(pin(), "test-setup");

  git(clone, ["branch", "-D", "test-setup"]);
  await fs.mkdir(path.join(mono, "issues", "features"), { recursive: true });
  const issue = path.join(mono, "issues", "features", "x.md");
  await fs.writeFile(issue, "---\nworkstream: seam\nneeds: [manual-testing]\n---\n");
  t.check(pin(), "manual-testing");

  await fs.writeFile(issue, "---\nworkstream: seam\nneeds: []\n---\n");
  assert.throws(pin);
  await fs.writeFile(issue, "---\nworkstream: seam\nneeds:\n  - manual-testing\n---\n");
  t.check(pin(), "manual-testing");
});

// Resetting a test clone checks out and hard-resets `main` without moving the
// `keep` branch.
void test("Resetting a test clone checks out and hard-resets main without moving the kee...", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reset-test-"));
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  const clone = path.join(root, "boxes", "seam", "test1");
  await fs.mkdir(clone, { recursive: true });
  git(clone, ["init", "-q", "-b", "main"]);
  git(clone, ["config", "user.email", "test@example.com"]);
  git(clone, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(clone, "state"), "setup\n");
  git(clone, ["add", "state"]);
  git(clone, ["commit", "-qm", "setup"]);
  git(clone, ["branch", "test-setup"]);
  git(clone, ["checkout", "-qb", "keep"]);
  await fs.writeFile(path.join(clone, "state"), "kept\n");
  git(clone, ["commit", "-qam", "kept"]);
  const keepSha = execFileSync("git", ["rev-parse", "keep"], {
    cwd: clone,
    encoding: "utf8",
  }).trim();
  execFileSync("bash", ["-c", [
    ". bin/lib/worktree-paths.sh",
    ". bin/lib/manual-testing.sh",
    "workstream_reset_test seam",
  ].join("; ")], {
    cwd: repoRoot,
    env: { ...process.env, WT_BOX_ROOT: path.join(root, "boxes") },
    stdio: "ignore",
  });
  t.check(
    {
      branch: execFileSync("git", ["branch", "--show-current"], {
        cwd: clone, encoding: "utf8",
      }).trim(),
      keepUnchanged: execFileSync("git", ["rev-parse", "keep"], {
        cwd: clone, encoding: "utf8",
      }).trim() === keepSha,
      state: await fs.readFile(path.join(clone, "state"), "utf8"),
    },
    {
    branch: "main",
    keepUnchanged: true,
    state: `setup
`,
  },
  );
});

// Preservation pushes a dated, recreatable ref. An existing conflicting ref makes
// the operation fail closed and leaves the clone's keep content intact.
void test("Preservation pushes a dated, recreatable ref.", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keep-preserve-"));
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const clone = path.join(root, "boxes", "seam", "test1");
  await fs.mkdir(source);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(source, "state"), "base\n");
  git(source, ["add", "state"]);
  git(source, ["commit", "-qm", "base"]);
  await fs.mkdir(path.dirname(clone), { recursive: true });
  git(root, ["clone", "-q", source, clone]);
  git(clone, ["config", "user.email", "test@example.com"]);
  git(clone, ["config", "user.name", "Test"]);
  git(clone, ["checkout", "-qb", "keep"]);
  await fs.writeFile(path.join(clone, "state"), "kept\n");
  git(clone, ["commit", "-qam", "kept"]);
  const date = execFileSync("date", ["-u", "+%Y-%m-%d"], { encoding: "utf8" }).trim();
  const ref = `keep/seam-${date}`;
  const env = {
    ...process.env,
    WT_BOX_ROOT: path.join(root, "boxes"),
    WT_BOX_SRC: source,
  };
  const preserve = () => spawnSync("bash", ["-c", [
    ". bin/lib/workstream-box-state.sh",
    "workstream_preserve_keep seam || exit",
    "printf '%s' \"$WORKSTREAM_PRESERVED_BOX_REF\"",
  ].join("; ")], { cwd: repoRoot, env, encoding: "utf8" });
  const first = preserve();
  assert.equal(first.status, 0);
  assert.equal(first.stdout, ref);
  assert.equal(
    execFileSync("git", ["rev-parse", ref], { cwd: source, encoding: "utf8" }).trim(),
    execFileSync("git", ["rev-parse", "keep"], { cwd: clone, encoding: "utf8" }).trim(),
  );
  await fs.writeFile(path.join(source, "other"), "conflict\n");
  git(source, ["add", "other"]);
  git(source, ["commit", "-qm", "conflict"]);
  git(source, ["update-ref", `refs/heads/${ref}`, "main"]);
  const refused = preserve();
  assert.notEqual(refused.status, 0);
  await t.checkText(await fs.readFile(path.join(clone, "state"), "utf8"), "kept");
});

// Preservation leaves out the clone's worktree-setup commit. Creation commits
// the clone's engine link (bin/lib/worktree-create.sh step 6); it points at a
// worktree that will be gone, so the preserved ref replays keep without it.
void test("Preservation drops the worktree setup commit from the preserved ref", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keep-preserve-setup-"));
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const clone = path.join(root, "boxes", "seam", "test1");
  await fs.mkdir(source);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(source, "package.json"), "source link\n");
  await fs.writeFile(path.join(source, "state"), "base\n");
  git(source, ["add", "."]);
  git(source, ["commit", "-qm", "base"]);
  await fs.mkdir(path.dirname(clone), { recursive: true });
  git(root, ["clone", "-q", source, clone]);
  git(clone, ["config", "user.email", "test@example.com"]);
  git(clone, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(clone, "package.json"), "worktree link\n");
  git(clone, ["commit", "-qam", "Worktree setup: link the beebox engine to worktree seam"]);
  git(clone, ["checkout", "-qb", "keep"]);
  await fs.writeFile(path.join(clone, "state"), "kept\n");
  git(clone, ["commit", "-qam", "kept"]);
  const result = spawnSync("bash", ["-c", [
    ". bin/lib/workstream-box-state.sh",
    "workstream_preserve_keep seam || exit",
    "printf '%s' \"$WORKSTREAM_PRESERVED_BOX_REF\"",
  ].join("; ")], { cwd: repoRoot, env: { ...process.env, WT_BOX_ROOT: path.join(root, "boxes"), WT_BOX_SRC: source }, encoding: "utf8" });
  const show = (spec: string): string => execFileSync("git", ["show", spec], { cwd: source, encoding: "utf8" });
  t.check({
    status: result.status,
    subjects: execFileSync("git", ["log", "--format=%s", result.stdout], { cwd: source, encoding: "utf8" }),
    packageJson: show(`${result.stdout}:package.json`),
    state: show(`${result.stdout}:state`),
    cloneWorktrees: execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: clone, encoding: "utf8" }).split("\n").filter((line) => line.startsWith("worktree ")),
  }, {
    status: 0,
    subjects: "kept\nbase\n",
    packageJson: "source link\n",
    state: "kept\n",
    // The replay's temporary worktree is gone.
    cloneWorktrees: [`worktree ${await fs.realpath(clone)}`],
  });
});

// Build a source box and a clone whose `main` carries the setup commit, as
// bin/lib/worktree-create.sh step 6 leaves it, with `keep` checked out.
async function setupClonePair(prefix: string): Promise<{ root: string; source: string; clone: string; env: NodeJS.ProcessEnv }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const source = path.join(root, "source");
  const clone = path.join(root, "boxes", "seam", "test1");
  await fs.mkdir(source);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(source, "package.json"), "source link\n");
  await fs.writeFile(path.join(source, "pnpm-lock.yaml"), "lock base\n");
  await fs.writeFile(path.join(source, "state"), "base\n");
  git(source, ["add", "."]);
  git(source, ["commit", "-qm", "base"]);
  await fs.mkdir(path.dirname(clone), { recursive: true });
  git(root, ["clone", "-q", source, clone]);
  git(clone, ["config", "user.email", "test@example.com"]);
  git(clone, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(clone, "package.json"), "worktree link\n");
  await fs.writeFile(path.join(clone, "pnpm-lock.yaml"), "lock setup\n");
  git(clone, ["commit", "-qam", "Worktree setup: link the beebox engine to worktree seam"]);
  git(clone, ["checkout", "-qb", "keep"]);
  return {
    root, source, clone,
    env: { ...process.env, WT_BOX_ROOT: path.join(root, "boxes"), WT_BOX_SRC: source },
  };
}

function runLib(env: NodeJS.ProcessEnv, script: string): ReturnType<typeof spawnSync> {
  return spawnSync("bash", ["-c", `. bin/lib/workstream-box-state.sh; ${script}`], { cwd: repoRoot, env, encoding: "utf8" });
}

// The setup commit never reaches the source box, so it must not make `keep`
// look unmerged: a keep holding only that commit, or real work already merged
// into source main (here as a separate commit with the same patch, not by ancestry), is
// not pinned and not preserved.
void test("A keep with only the setup commit, or already-merged work, is not unmerged", async (t) => {
  const { root, source, clone, env } = await setupClonePair("keep-setup-merged-");
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  const state = () => String(runLib(env, `workstream_box_state ${clone} ${source} | grep -o '"keepUnmerged": *[a-z]*' | tr -d ' '`).stdout).trim();
  const pin = () => runLib(env, "workstream_cull_pin_reason seam");
  const preserve = () => String(runLib(env, 'workstream_preserve_keep seam || exit; printf "%s" "$WORKSTREAM_PRESERVED_BOX_REF"').stdout);
  const before = { setupOnly: state(), pin: pin().status, preserved: preserve() };

  await fs.writeFile(path.join(clone, "state"), "kept\n");
  git(clone, ["commit", "-qam", "real work"]);
  const unmerged = { state: state(), pin: String(pin().stdout).trim() };
  await fs.writeFile(path.join(source, "state"), "kept\n");
  git(source, ["commit", "-qam", "real work (merged by patch)"]);
  const merged = { state: state(), pin: pin().status, preserved: preserve() };
  t.check({ before, unmerged, merged }, {
    before: { setupOnly: '"keepUnmerged":false', pin: 1, preserved: "" },
    unmerged: { state: '"keepUnmerged":true', pin: "keep-unmerged" },
    merged: { state: '"keepUnmerged":false', pin: 1, preserved: "" },
  });
});

// A box agent's later `pnpm add` edits the files the setup commit touched, so
// dropping the setup commit conflicts. Preservation then pushes keep unrebased,
// setup commit included, instead of refusing removal.
void test("Preservation pushes keep with the setup commit when dropping it conflicts", async (t) => {
  const { root, source, clone, env } = await setupClonePair("keep-setup-conflict-");
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(clone, "package.json"), "worktree link plus dep\n");
  await fs.writeFile(path.join(clone, "pnpm-lock.yaml"), "lock setup plus dep\n");
  git(clone, ["commit", "-qam", "pnpm add dep"]);
  const result = runLib(env, 'workstream_preserve_keep seam || exit; printf "%s" "$WORKSTREAM_PRESERVED_BOX_REF"');
  const ref = String(result.stdout);
  t.check({
    status: result.status,
    stderr: String(result.stderr).includes("carries the worktree setup commit"),
    subjects: execFileSync("git", ["log", "--format=%s", ref], { cwd: source, encoding: "utf8" }),
    cloneWorktrees: execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: clone, encoding: "utf8" }).split("\n").filter((line) => line.startsWith("worktree ")),
  }, {
    status: 0,
    stderr: true,
    subjects: "pnpm add dep\nWorktree setup: link the beebox engine to worktree seam\nbase\n",
    cloneWorktrees: [`worktree ${await fs.realpath(clone)}`],
  });
});

// Recreation fetches the preserved ref, checks out clone `main`, and resets its
// content to that ref.
void test("Recreation fetches the preserved ref, checks out clone main, and resets its c...", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "box-restore-"));
  t.teardown(async () => await fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const clone = path.join(root, "clone");
  await fs.mkdir(source);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(source, "state"), "main\n");
  git(source, ["add", "state"]);
  git(source, ["commit", "-qm", "main"]);
  git(root, ["clone", "-q", source, clone]);
  await fs.writeFile(path.join(source, "state"), "preserved\n");
  git(source, ["checkout", "-qb", "keep/seam-fixture"]);
  git(source, ["commit", "-qam", "preserved"]);
  execFileSync("bash", ["-c", [
    ". bin/lib/worktree-create.sh",
    "wt_create_restore_box_ref \"$CLONE\" keep/seam-fixture",
  ].join("; ")], {
    cwd: repoRoot,
    env: { ...process.env, CLONE: clone },
    stdio: "ignore",
  });
  t.check(
    {
      state: await fs.readFile(path.join(clone, "state"), "utf8"),
      branch: execFileSync("git", ["branch", "--show-current"], {
        cwd: clone, encoding: "utf8",
      }).trim(),
    },
    {
    state: `preserved
`,
    branch: "main",
  },
  );
});
