# Workstream box-state preservation

Workstream culling treats box repositories as changed data. Test setup and
unmerged `keep` work pin a workstream, while preservation creates an explicit
source-repository ref from which the clone can be reconstructed.

```ts setup
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
```

Cull pins report the highest-priority reason until it is resolved: unmerged
keep work, a test-setup branch, or a linked issue awaiting manual testing. Both
supported YAML list forms are recognized.

```ts
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
pin()
=> keep-unmerged

git(source, ["fetch", "-q", clone, "keep:keep"]);
git(source, ["merge", "--ff-only", "keep"]);
git(clone, ["branch", "test-setup"]);
pin()
=> test-setup

git(clone, ["branch", "-D", "test-setup"]);
await fs.mkdir(path.join(mono, "issues", "features"), { recursive: true });
const issue = path.join(mono, "issues", "features", "x.md");
await fs.writeFile(issue, "---\nworkstream: seam\nneeds: [manual-testing]\n---\n");
pin()
=> manual-testing

await fs.writeFile(issue, "---\nworkstream: seam\nneeds: []\n---\n");
assert.throws(pin);
await fs.writeFile(issue, "---\nworkstream: seam\nneeds:\n  - manual-testing\n---\n");
pin()
=> manual-testing
```

Resetting a test clone checks out and hard-resets `main` without moving the
`keep` branch.

```ts
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
JSON.stringify({
  branch: execFileSync("git", ["branch", "--show-current"], {
    cwd: clone, encoding: "utf8",
  }).trim(),
  keepUnchanged: execFileSync("git", ["rev-parse", "keep"], {
    cwd: clone, encoding: "utf8",
  }).trim() === keepSha,
  state: await fs.readFile(path.join(clone, "state"), "utf8"),
})
=> {"branch":"main","keepUnchanged":true,"state":"setup\n"}
```

Preservation pushes a dated, recreatable ref. An existing conflicting ref makes
the operation fail closed and leaves the clone's keep content intact.

```ts
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
  `printf '%s' "$WORKSTREAM_PRESERVED_BOX_REF"`,
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
await fs.readFile(path.join(clone, "state"), "utf8")
=> kept
```

Recreation fetches the preserved ref, checks out clone `main`, and resets its
content to that ref.

```ts
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
  `wt_create_restore_box_ref "$CLONE" keep/seam-fixture`,
].join("; ")], {
  cwd: repoRoot,
  env: { ...process.env, CLONE: clone },
  stdio: "ignore",
});
JSON.stringify({
  state: await fs.readFile(path.join(clone, "state"), "utf8"),
  branch: execFileSync("git", ["branch", "--show-current"], {
    cwd: clone, encoding: "utf8",
  }).trim(),
})
=> {"state":"preserved\n","branch":"main"}
```
