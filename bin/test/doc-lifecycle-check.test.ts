// # Document lifecycle Git gates
//
// The lifecycle checker reads the candidate Git snapshot. The pre-commit hook
// checks the index, while `bin/land` checks the branch tree before changing
// `main`. These subprocess tests use isolated repositories so refusal and merge
// behavior are observable without touching the development checkout.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { binTsArgs } from "../lib/bin-ts.js";

const MONO_ROOT = resolve(import.meta.dirname, "../..");
const CHECK = join(MONO_ROOT, "bin/doc-lifecycle-check.ts");
const LAND = join(MONO_ROOT, "bin/land");

function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function writePlan({ repo, rel, status, title }: { repo: string; rel: string; status: string; title?: string }) {
  const absolute = join(repo, rel);
  const heading = title ?? "Test";
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `---\ntitle: ${heading}\nstatus: ${status}\nworkstream: test\nissues: []\n---\n# ${heading}\n`);
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

function runCheck(repo: string, ...args: string[]) {
  return spawnSync(process.execPath, binTsArgs(CHECK, ["--repo", repo, ...args]), {
    cwd: MONO_ROOT,
    encoding: "utf8",
  });
}

function runLand(repo: string, ...args: string[]) {
  return spawnSync("bash", [LAND, ...args], { cwd: repo, encoding: "utf8" });
}

// ## Tree and index validation use their own snapshots
//
// An invalid working-tree edit does not affect checks of `HEAD` or the unchanged
// index. Staging it makes the index check fail with an actionable path and
// required status set.
void test("An invalid working-tree edit does not affect checks of HEAD or the unchanged...", async (t) => {
  t.teardown(async () => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const repo = fixture();
  writePlan({ repo, rel: "beebox/docs/plans/unicode.md", status: "draft", title: "Café 🐝" });
  git(repo, "add", "beebox/docs/plans/unicode.md");
  writePlan({ repo, rel: "beebox/docs/plans/open.md", status: "implemented" });
  const treeStatus = runCheck(repo, "--tree", "HEAD").status;
  const cleanIndexStatus = runCheck(repo, "--index").status;
  git(repo, "add", "beebox/docs/plans/open.md");
  const staged = runCheck(repo, "--index");
  t.check(({ treeStatus, cleanIndexStatus, stagedStatus: staged.status, diagnostic: staged.stderr.includes("plans requires draft, active, partial") }), {
    treeStatus: 0,
    cleanIndexStatus: 0,
    stagedStatus: 1,
    diagnostic: true,
  });
});

// ## Snapshot validation fails closed
void test("Snapshot validation fails closed", async (t) => {
  t.teardown(async () => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const repo = fixture();
  writeFileSync(join(repo, "beebox/docs/plans/open.md"), "# No frontmatter\n");
  git(repo, "add", "beebox/docs/plans/open.md");
  const missing = runCheck(repo, "--index");
  writeFileSync(join(repo, "beebox/docs/plans/open.md"), "---\ntitle: [\n---\n");
  git(repo, "add", "beebox/docs/plans/open.md");
  const malformed = runCheck(repo, "--index");
  t.check(({ missing: missing.stderr.includes("YAML frontmatter is required"), malformed: malformed.stderr.includes("invalid YAML frontmatter") }), {
    missing: true,
    malformed: true,
  });
});

// ## Landing refuses an invalid candidate without changing main
//
// The checker comes from the executing `bin/land` checkout. This fixture's main
// tree deliberately has no checker or dependencies of its own, covering the
// first landing that introduces the gate and invocation from another directory.
void test("The checker comes from the executing bin/land checkout.", async (t) => {
  t.teardown(async () => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const repo = fixture();
  git(repo, "checkout", "-qb", "worktree-invalid");
  writePlan({ repo, rel: "beebox/docs/plans/open.md", status: "implemented" });
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "invalid plan");
  git(repo, "checkout", "-q", "main");
  const before = git(repo, "rev-parse", "main");
  const result = runLand(repo, "worktree-invalid");
  t.check(({ status: result.status, refused: result.stderr.includes("main was not changed"), unchanged: git(repo, "rev-parse", "main") === before }), {
    status: 1,
    refused: true,
    unchanged: true,
  });
});

// ## List, dry-run, and valid landing retain their behavior
void test("List, dry-run, and valid landing retain their behavior", async (t) => {
  t.teardown(async () => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
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
  t.check(
    ({
      listed: listed.status === 0 && listed.stdout.includes("worktree-valid"),
      dryRun: dryRun.status === 0 && dryRun.stdout.includes("dry run — nothing merged") && afterDryRun === before,
      landed: landed.status === 0 && git(repo, "rev-parse", "main") !== before,
      hookUsesIndex: readFileSync(join(MONO_ROOT, ".husky/pre-commit"), "utf8").includes("doc-lifecycle-check.ts --index"),
    }),
    {
    listed: true,
    dryRun: true,
    landed: true,
    hookUsesIndex: true,
  },
  );
});
