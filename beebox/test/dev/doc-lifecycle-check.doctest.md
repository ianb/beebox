# Document lifecycle Git gates

The lifecycle checker reads the candidate Git snapshot. The pre-commit hook
checks the index, while `bin/land` checks the branch tree before changing
`main`. These subprocess tests use isolated repositories so refusal and merge
behavior are observable without touching the development checkout.

```ts setup
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const MONO_ROOT = resolve(import.meta.dirname, "../../..");
const CHECK = join(MONO_ROOT, "bin/doc-lifecycle-check.ts");
const LAND = join(MONO_ROOT, "bin/land");

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function writePlan({ repo, rel, status, title = "Test" }) {
  const absolute = join(repo, rel);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `---\ntitle: ${title}\nstatus: ${status}\nworkstream: test\nissues: []\n---\n# ${title}\n`);
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "doc-lifecycle-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "config", "user.name", "Test");
  writePlan({ repo, rel: "beebox/docs/plans/open.md", status: "active" });
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  return repo;
}

function runCheck(repo, ...args) {
  return spawnSync("node", ["--import", "tsx", CHECK, "--repo", repo, ...args], {
    cwd: MONO_ROOT,
    encoding: "utf8",
  });
}

function runLand(repo, ...args) {
  return spawnSync("bash", [LAND, ...args], { cwd: repo, encoding: "utf8" });
}
```

## Tree and index validation use their own snapshots

An invalid working-tree edit does not affect checks of `HEAD` or the unchanged
index. Staging it makes the index check fail with an actionable path and
required status set.

```ts
const repo = fixture();
writePlan({ repo, rel: "beebox/docs/plans/unicode.md", status: "draft", title: "Café 🐝" });
git(repo, "add", "beebox/docs/plans/unicode.md");
writePlan({ repo, rel: "beebox/docs/plans/open.md", status: "implemented" });
const treeStatus = runCheck(repo, "--tree", "HEAD").status;
const cleanIndexStatus = runCheck(repo, "--index").status;
git(repo, "add", "beebox/docs/plans/open.md");
const staged = runCheck(repo, "--index");
({ treeStatus, cleanIndexStatus, stagedStatus: staged.status, diagnostic: staged.stderr.includes("plans requires draft, active, partial") })
=> {
  "treeStatus": 0,
  "cleanIndexStatus": 0,
  "stagedStatus": 1,
  "diagnostic": true
}
```

```ts cleanup
rmSync(repo, { recursive: true, force: true });
```

## Snapshot validation fails closed

```ts
const repo = fixture();
writeFileSync(join(repo, "beebox/docs/plans/open.md"), "# No frontmatter\n");
git(repo, "add", "beebox/docs/plans/open.md");
const missing = runCheck(repo, "--index");
writeFileSync(join(repo, "beebox/docs/plans/open.md"), "---\ntitle: [\n---\n");
git(repo, "add", "beebox/docs/plans/open.md");
const malformed = runCheck(repo, "--index");
({ missing: missing.stderr.includes("YAML frontmatter is required"), malformed: malformed.stderr.includes("invalid YAML frontmatter") })
=> {
  "missing": true,
  "malformed": true
}
```

```ts cleanup
rmSync(repo, { recursive: true, force: true });
```

## Landing refuses an invalid candidate without changing main

The checker comes from the executing `bin/land` checkout. This fixture's main
tree deliberately has no checker or dependencies of its own, covering the
first landing that introduces the gate and invocation from another directory.

```ts
const repo = fixture();
git(repo, "checkout", "-qb", "worktree-invalid");
writePlan({ repo, rel: "beebox/docs/plans/open.md", status: "implemented" });
git(repo, "add", ".");
git(repo, "commit", "-qm", "invalid plan");
git(repo, "checkout", "-q", "main");
const before = git(repo, "rev-parse", "main");
const result = runLand(repo, "worktree-invalid");
({ status: result.status, refused: result.stderr.includes("main was not changed"), unchanged: git(repo, "rev-parse", "main") === before })
=> {
  "status": 1,
  "refused": true,
  "unchanged": true
}
```

```ts cleanup
rmSync(repo, { recursive: true, force: true });
```

## List, dry-run, and valid landing retain their behavior

```ts
const repo = fixture();
git(repo, "checkout", "-qb", "worktree-valid");
writePlan({ repo, rel: "beebox/docs/plans/next.md", status: "draft" });
git(repo, "add", ".");
git(repo, "commit", "-qm", "valid plan");
git(repo, "checkout", "-q", "main");
const before = git(repo, "rev-parse", "main");
const listed = runLand(repo, "--list");
const dryRun = runLand(repo, "--dry-run", "worktree-valid");
const afterDryRun = git(repo, "rev-parse", "main");
const landed = runLand(repo, "worktree-valid");
({
  listed: listed.status === 0 && listed.stdout.includes("worktree-valid"),
  dryRun: dryRun.status === 0 && dryRun.stdout.includes("dry run — nothing merged") && afterDryRun === before,
  landed: landed.status === 0 && git(repo, "rev-parse", "main") !== before,
  hookUsesIndex: readFileSync(join(MONO_ROOT, ".husky/pre-commit"), "utf8").includes("doc-lifecycle-check.ts --index"),
})
=> {
  "listed": true,
  "dryRun": true,
  "landed": true,
  "hookUsesIndex": true
}
```

```ts cleanup
rmSync(repo, { recursive: true, force: true });
```
