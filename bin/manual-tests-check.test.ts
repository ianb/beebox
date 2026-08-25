/**
 * `schedules/manual-tests/check` — the guard that bounds what the weekly triage
 * agent gets committed.
 *
 * The agent cannot commit; the check can, and what it commits is decided here:
 * a claimed path must be an open-issue markdown file that actually changed and
 * changed only by appending. That is the whole reason the runner is allowed to
 * commit an unattended agent's edits at all, so it is tested rather than
 * trusted.
 *
 * Node's test runner rather than a doctest (`bin/CLAUDE.md` prefers doctests
 * for `bin/`): the subject is a script driven by a git fixture and two
 * environment variables, which is the unit tier's shape
 * (scheduled-workstreams.md, "Rollout shape").
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CHECK = path.join(REPO_ROOT, "schedules", "manual-tests", "check");
const ISSUE = "issues/bugs/2026-01-01-synthetic.md";
const BASE = "---\ntitle: Existing\n---\nExisting diagnosis.\n";
const RUN_ID = "20260101-000000";

interface Fixture {
  worktree: string;
  stateDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "manual-tests-check-"));
  const worktree = path.join(root, "repo");
  const stateDir = path.join(root, "state");
  await fs.mkdir(path.join(worktree, path.dirname(ISSUE)), { recursive: true });
  await fs.mkdir(path.join(stateDir, "runs"), { recursive: true });
  // `node --import tsx` resolves the loader from the CWD, and the check's CWD
  // is the schedule's worktree. A real one has been through `pnpm install`
  // (worktree-create.sh:354); a fixture borrows the repo's.
  await fs.symlink(path.join(REPO_ROOT, "node_modules"), path.join(worktree, "node_modules"));
  await fs.writeFile(path.join(worktree, ISSUE), BASE);
  await execa("git", ["-C", worktree, "init", "-q", "."]);
  await execa("git", ["-C", worktree, "config", "user.email", "test@example.com"]);
  await execa("git", ["-C", worktree, "config", "user.name", "Test"]);
  // The borrowed node_modules symlink is fixture scaffolding, not content.
  await fs.appendFile(path.join(worktree, ".git", "info", "exclude"), "node_modules\n");
  await execa("git", ["-C", worktree, "add", "--", ISSUE]);
  await execa("git", ["-C", worktree, "commit", "-q", "-m", "base"]);
  return { worktree, stateDir };
}

async function runCheck(fixture: Fixture, logBody: string): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  await fs.writeFile(path.join(fixture.stateDir, "runs", `${RUN_ID}.log`), logBody);
  const result = await execa(CHECK, [], {
    cwd: fixture.worktree,
    reject: false,
    env: { SCHEDULE_STATE_DIR: fixture.stateDir, SCHEDULE_RUN_ID: RUN_ID, SCHEDULE_NAME: "manual-tests" },
  });
  return { exitCode: result.exitCode ?? 1, stderr: result.stderr, stdout: result.stdout };
}

async function headCount(worktree: string): Promise<number> {
  const { stdout } = await execa("git", ["-C", worktree, "rev-list", "--count", "HEAD"]);
  return Number(stdout.trim());
}

test("an appended issue file is committed, path-scoped", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(path.dirname(fixture.worktree), { recursive: true, force: true }));
  await fs.appendFile(path.join(fixture.worktree, ISSUE), "\nAgent diagnosis.\n");
  // The log also carries the suite's own output; the agent's line is the last.
  const result = await runCheck(fixture, `not ok 1 - synthetic\nTRIAGE: ${ISSUE}.\n`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await headCount(fixture.worktree), 2);
  const { stdout } = await execa("git", ["-C", fixture.worktree, "status", "--porcelain"]);
  assert.equal(stdout.trim(), "");
});

test("a rewritten issue file is refused and nothing is committed", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(path.dirname(fixture.worktree), { recursive: true, force: true }));
  await fs.writeFile(path.join(fixture.worktree, ISSUE), "---\nrewritten\n");
  const result = await runCheck(fixture, `TRIAGE: ${ISSUE}\n`);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /rewritten, not appended to/u);
  assert.equal(await headCount(fixture.worktree), 1);
});

test("an unchanged issue file is refused", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(path.dirname(fixture.worktree), { recursive: true, force: true }));
  const result = await runCheck(fixture, `TRIAGE: ${ISSUE}\n`);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /unchanged since HEAD/u);
});

test("a path outside the open issue categories never parses as a TRIAGE line", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(path.dirname(fixture.worktree), { recursive: true, force: true }));
  const result = await runCheck(fixture, "TRIAGE: callback-box/src/webapp/server.ts\n");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /never printed a TRIAGE line/u);
});

test("a session that never reported is a failed check", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(path.dirname(fixture.worktree), { recursive: true, force: true }));
  const result = await runCheck(fixture, "the agent said many things, none of them a report\n");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /never printed a TRIAGE line/u);
});

test("TRIAGE: clean commits nothing and succeeds", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(path.dirname(fixture.worktree), { recursive: true, force: true }));
  const result = await runCheck(fixture, "TRIAGE: clean\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await headCount(fixture.worktree), 1);
});
