// # finish-preflight: merge conflicts it resolves by rule
//
// A headless finish stops on any merge conflict (exit 3). In October 2026 three
// finishes stopped on conflicts that needed no judgment. One was the audit
// ledger `context-history.yaml`, where both sides appended rows. One was the
// `MIGRATIONS` list, where both sides appended an entry. One was the generated
// `doc-graph.md`. Preflight now resolves these three files and stops on any
// other conflict, as before.

import * as tapModule from "tap";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendBranchMigrations, mergeLedger } from "../finish-preflight-merge.js";
import { binTsArgs } from "../lib/bin-ts.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "finish-preflight-merge-"));
const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_MERGE_AUTOEDIT: "no" } }).trim();
const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const commitAll = (message: string): void => {
  git("add", ".");
  git("commit", "-qm", message);
};
const preflight = () =>
  spawnSync(process.execPath, binTsArgs("bin/finish-preflight.ts", ["--json"]), {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_MERGE_AUTOEDIT: "no" },
  });

/** A MIGRATIONS file with these entry lines. */
const migrations = (...entries: string[]): string =>
  ["const RETIRED = \"retired.ts\";", "", "export const MIGRATIONS: ReadonlyArray<Migration> = [", ...entries, "];", ""].join("\n");
const entry = (name: string, script?: string): string => `  { name: "${name}", script: "${script ?? "retired.ts"}" },`;

/** One ledger row, in the shape `knowledge-audit run` writes. */
const row = (date: string, initial: number): string =>
  [`    - date: ${date}`, "      boxCommit: b", "      repoCommit: r", `      initial: ${initial}`, `      peak: ${initial}`, "      added: 0", "      turns: 1", ""].join("\n");
const ledger = (...rows: string[]): string => ["test1:", "  audit:", ...rows].join("\n");

// The fork point, the branch (appends `branch-new`), and main (retires `a`, appends `main-new`).
const base = migrations(entry("a", "a.ts"));
const ours = migrations(entry("a", "a.ts"), "  // The branch's migration.", entry("branch-new", "b.ts"));
const theirs = migrations(entry("a"), entry("main-new", "m.ts"));

tapModule.default.teardown(async () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (error) {
    console.error("teardown failed:", error);
    process.exitCode = 1;
  }
});

// ## The migration list keeps main's order, then appends the branch's entries
//
// Deployed boxes have run main's list in main's order. So the result is main's
// list as it stands, including entries main changed since the branch forked
// (here `a` was retired), followed by the branch's new entries with their
// comments.
void test("Deployed boxes have run main's list in main's order.", async (t) => {
  t.check(
    appendBranchMigrations({ base, ours, theirs }),
    migrations(entry("a"), entry("main-new", "m.ts"), "  // The branch's migration.", entry("branch-new", "b.ts")),
  );
});

// The rule applies only when the branch's change to the file is pure appends.
// A branch that also edited an existing entry, or added an entry main also
// added, needs a person: the result is `null` and the conflict stands.
void test("The rule applies only when the branch's change to the file is pure appends.", async (t) => {
  const edited = migrations(entry("a", "a2.ts"), entry("branch-new", "b.ts"));
  const sameName = migrations(entry("a", "a.ts"), entry("main-new", "b.ts"));
  t.check([appendBranchMigrations({ base, ours: edited, theirs }), appendBranchMigrations({ base, ours: sameName, theirs })], [
    null,
    null,
  ]);
});

// The ledger rule likewise applies only to appends. A side that corrected or
// deleted an existing row made a choice, so the conflict stands for a person
// rather than keeping both versions of the row.
void test("The ledger rule likewise applies only to appends.", async (t) => {
  const baseLedger = ledger(row("2026-10-01T00:00:00Z", 100));
  const corrected = ledger(row("2026-10-01T00:00:00Z", 101), row("2026-10-03T00:00:00Z", 300));
  const appended = ledger(row("2026-10-01T00:00:00Z", 100), row("2026-10-02T00:00:00Z", 200));
  t.check(mergeLedger({ base: baseLedger, ours: corrected, theirs: appended }), null);
});

// ## A real merge: the ledger and the list resolve, and the merge commits
//
// Both sides append a ledger row and a migration. Every row ends in the same
// `added: 0` and `turns: 1` lines. A line-based merge, such as git's `union`
// driver, keeps those shared lines once and leaves one row without them. The
// ledger rule merges parsed rows instead and sorts them by date.
void test("Both sides append a ledger row and a migration.", async (t) => {
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write("pnpm-workspace.yaml", "packages: []\n");
  write("package.json", "{}\n");
  write("beebox/src/dev/context-history.yaml", ledger(row("2026-10-01T00:00:00Z", 100)));
  write("beebox/src/core/migrations.ts", base);
  commitAll("base");
  git("checkout", "-qb", "worktree-demo");
  write("beebox/src/dev/context-history.yaml", ledger(row("2026-10-01T00:00:00Z", 100), row("2026-10-03T00:00:00Z", 300)));
  write("beebox/src/core/migrations.ts", ours);
  commitAll("branch");
  git("checkout", "-q", "main");
  write("beebox/src/dev/context-history.yaml", ledger(row("2026-10-01T00:00:00Z", 100), row("2026-10-02T00:00:00Z", 200)));
  write("beebox/src/core/migrations.ts", theirs);
  commitAll("main");
  git("checkout", "-q", "worktree-demo");
  const run = preflight();
  const sheet = JSON.parse(run.stdout);
  t.check(run.status, 0);
  t.check(sheet.merge, {
    status: "merged",
    broughtPaths: ["beebox/src/core/migrations.ts", "beebox/src/dev/context-history.yaml"],
    resolved: [
      "beebox/src/core/migrations.ts (main's list + branch entries)",
      "beebox/src/dev/context-history.yaml (both sides' rows)",
    ],
  });
  t.check(git("status", "--porcelain"), "");

  // The ledger keeps all three rows, each complete, oldest first.

  t.checkText(
    fs.readFileSync(path.join(root, "beebox/src/dev/context-history.yaml"), "utf8"),
    [
      "# Context-size history — auto-appended by `knowledge-audit run`.",
      "# box basename → audit id → entries (oldest first). See lib/context-history.ts.",
      "test1:",
      "  audit:",
      ...[100, 200, 300].map((initial) => row(`2026-10-0${initial / 100}T00:00:00Z`, initial).trimEnd()),
    ].join("\n"),
  );
});

// ## Any other conflict still stops the finish
//
// A conflict in a file with no rule exits 3 and leaves the merge in progress for
// a person, as before.
void test("A conflict in a file with no rule exits 3 and leaves the merge in progress fo...", async (t) => {
  git("checkout", "-qb", "worktree-other", "main");
  write("notes.txt", "branch\n");
  commitAll("branch notes");
  git("checkout", "-q", "main");
  write("notes.txt", "main\n");
  commitAll("main notes");
  git("checkout", "-q", "worktree-other");
  const blocked = preflight();
  t.check(blocked.status, 3);
  t.check(git("diff", "--name-only", "--diff-filter=U"), "notes.txt");
});
