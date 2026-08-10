import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

test("cull pins report keep, test-setup, and manual-testing until released", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cull-pins-"));
  const mono = path.join(root, "mono");
  const source = path.join(root, "source");
  const clone = path.join(root, "boxes", "seam", "test1");
  await fs.mkdir(mono);
  await fs.mkdir(source);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(source, "state"), "base\n");
  git(source, ["add", "state"]); git(source, ["commit", "-qm", "base"]);
  await fs.mkdir(path.dirname(clone), { recursive: true });
  git(root, ["clone", "-q", source, clone]);
  git(clone, ["config", "user.email", "test@example.com"]); git(clone, ["config", "user.name", "Test"]);
  git(clone, ["checkout", "-qb", "keep"]);
  await fs.writeFile(path.join(clone, "state"), "keep\n"); git(clone, ["commit", "-qam", "keep"]);

  const pin = (): string => execFileSync("bash", ["-c", '. bin/lib/workstream-box-state.sh; workstream_cull_pin_reason seam'], {
    cwd: path.resolve("."), env: { ...process.env, WT_MONO: mono, WT_BOX_ROOT: path.join(root, "boxes"), WT_BOX_SRC: source }, encoding: "utf8",
  }).trim();
  assert.equal(pin(), "keep-unmerged");
  git(source, ["fetch", "-q", clone, "keep:keep"]);
  git(source, ["merge", "--ff-only", "keep"]);
  git(clone, ["branch", "test-setup"]);
  assert.equal(pin(), "test-setup");
  git(clone, ["branch", "-D", "test-setup"]);
  await fs.mkdir(path.join(mono, "issues", "features"), { recursive: true });
  const issue = path.join(mono, "issues", "features", "x.md");
  await fs.writeFile(issue, "---\nworkstream: seam\nneeds: [manual-testing]\n---\n");
  assert.equal(pin(), "manual-testing");
  await fs.writeFile(issue, "---\nworkstream: seam\nneeds: []\n---\n");
  assert.throws(pin);
});

test("keep preservation pushes a recreatable ref and refuses a conflicting push", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keep-preserve-"));
  const source = path.join(root, "source");
  const clone = path.join(root, "boxes", "seam", "test1");
  await fs.mkdir(source);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(source, "state"), "base\n");
  git(source, ["add", "state"]); git(source, ["commit", "-qm", "base"]);
  await fs.mkdir(path.dirname(clone), { recursive: true });
  git(root, ["clone", "-q", source, clone]);
  git(clone, ["config", "user.email", "test@example.com"]); git(clone, ["config", "user.name", "Test"]);
  git(clone, ["checkout", "-qb", "keep"]);
  await fs.writeFile(path.join(clone, "state"), "kept\n"); git(clone, ["commit", "-qam", "kept"]);
  const date = execFileSync("date", ["-u", "+%Y-%m-%d"], { encoding: "utf8" }).trim();
  const ref = `keep/seam-${date}`;
  const env = { ...process.env, WT_BOX_ROOT: path.join(root, "boxes"), WT_BOX_SRC: source };
  const preserve = (): ReturnType<typeof spawnSync> => spawnSync("bash", ["-c", ". bin/lib/workstream-box-state.sh; workstream_preserve_keep seam || exit; printf '%s' \"$WORKSTREAM_PRESERVED_BOX_REF\""], {
    cwd: path.resolve("."), env, encoding: "utf8",
  });
  const first = preserve();
  assert.equal(first.status, 0);
  assert.equal(first.stdout, ref);
  assert.equal(execFileSync("git", ["rev-parse", ref], { cwd: source, encoding: "utf8" }).trim(), execFileSync("git", ["rev-parse", "keep"], { cwd: clone, encoding: "utf8" }).trim());

  await fs.writeFile(path.join(source, "other"), "conflict\n");
  git(source, ["add", "other"]); git(source, ["commit", "-qm", "conflict"]);
  git(source, ["update-ref", `refs/heads/${ref}`, "main"]);
  const refused = preserve();
  assert.notEqual(refused.status, 0);
  assert.equal(await fs.readFile(path.join(clone, "state"), "utf8"), "kept\n");
});

test("box-ref restore resets clone main content to the preserved ref", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "box-restore-"));
  const source = path.join(root, "source");
  const clone = path.join(root, "clone");
  await fs.mkdir(source);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.com"]);
  git(source, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(source, "state"), "main\n");
  git(source, ["add", "state"]); git(source, ["commit", "-qm", "main"]);
  git(root, ["clone", "-q", source, clone]);
  await fs.writeFile(path.join(source, "state"), "preserved\n");
  git(source, ["checkout", "-qb", "keep/seam-fixture"]);
  git(source, ["commit", "-qam", "preserved"]);
  execFileSync("bash", ["-c", ". bin/lib/worktree-create.sh; wt_create_restore_box_ref \"$CLONE\" keep/seam-fixture"], {
    cwd: path.resolve("."), env: { ...process.env, CLONE: clone }, stdio: "ignore",
  });
  assert.equal(await fs.readFile(path.join(clone, "state"), "utf8"), "preserved\n");
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: clone, encoding: "utf8" }).trim(), "main");
});
