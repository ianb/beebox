import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { execa } from "execa";

import {
  activateDeferredRoot,
  activatedSource,
  isCalendarDate,
  parseDeferredIssue,
  readDeferredIssues,
  runActivationTransaction,
} from "./deferred-issues.js";

function issue(metadata: string): string {
  return `---\ntitle: Later\nworkstream: unattached\n${metadata}\n---\n\nBody.\n`;
}

async function root(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deferred-issues-"));
  await fs.mkdir(path.join(directory, "deferred"));
  return directory;
}

void test("calendar dates reject normalized overflow dates", () => {
  assert.equal(isCalendarDate("2026-09-07"), true);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("2026-9-7"), false);
});

void test("deferred metadata is strict", () => {
  assert.deepEqual(parseDeferredIssue("later.md", issue("activate-on: 2026-09-07\ncategory: code-quality")), {
    file: "later.md", activateOn: "2026-09-07", category: "code-quality",
  });
  assert.throws(() => parseDeferredIssue("later.md", issue("activate-on: 2026-02-30\ncategory: someday")), /activate-on.*category/u);
});

void test("activation removes only deferred lifecycle fields", () => {
  const source = issue("activate-on: 2026-09-07\ncategory: code-quality\nlabels: [cleanup]");
  const activated = activatedSource(source);
  assert.doesNotMatch(activated, /activate-on|category:/u);
  assert.match(activated, /labels: \[cleanup\]/u);
  assert.match(activated, /Body\./u);
});

void test("only due issues move, retaining the filing-date basename", async () => {
  const issuesRoot = await root();
  const due = "2026-08-31-remove-compat.md";
  const later = "2026-08-31-check-upstream.md";
  await fs.writeFile(path.join(issuesRoot, "deferred", due), issue("activate-on: 2026-09-07\ncategory: code-quality"));
  await fs.writeFile(path.join(issuesRoot, "deferred", later), issue("activate-on: 2026-10-01\ncategory: watch"));

  const preview = await activateDeferredRoot({ issuesRoot, today: "2026-09-07", dryRun: true });
  assert.equal(preview.length, 1);
  assert.equal(path.basename(preview[0]?.destination ?? ""), due);
  assert.equal((await readDeferredIssues(issuesRoot)).length, 2, "dry-run writes nothing");

  await activateDeferredRoot({ issuesRoot, today: "2026-09-07", dryRun: false });
  const active = await fs.readFile(path.join(issuesRoot, "code-quality", due), "utf8");
  assert.doesNotMatch(active, /activate-on|category:/u);
  assert.deepEqual((await readDeferredIssues(issuesRoot)).map((entry) => path.basename(entry.file)), [later]);
});

void test("a destination collision refuses before moving anything", async () => {
  const issuesRoot = await root();
  const name = "2026-08-31-collision.md";
  await fs.writeFile(path.join(issuesRoot, "deferred", name), issue("activate-on: 2026-09-07\ncategory: bugs"));
  await fs.mkdir(path.join(issuesRoot, "bugs"));
  await fs.writeFile(path.join(issuesRoot, "bugs", name), "existing");
  await assert.rejects(
    activateDeferredRoot({ issuesRoot, today: "2026-09-07", dryRun: false }),
    /destination already exists/u,
  );
  assert.equal((await readDeferredIssues(issuesRoot)).length, 1);
});

void test("deferred storage is flat", async () => {
  const issuesRoot = await root();
  await fs.mkdir(path.join(issuesRoot, "deferred", "2026-09-07"));
  await assert.rejects(readDeferredIssues(issuesRoot), /must be flat/u);
});

class TestTransactionFailureError extends Error {
  constructor() { super("injected activation failure"); this.name = "TestTransactionFailureError"; }
}

void test("a failed activation transaction restores tracked and untracked files", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deferred-transaction-"));
  const source = path.join(repoRoot, "deferred.md");
  const destination = path.join(repoRoot, "active.md");
  await fs.writeFile(source, "original\n");
  await execa("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "Test"], { cwd: repoRoot });
  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-qm", "fixture"], { cwd: repoRoot });

  await assert.rejects(runActivationTransaction(repoRoot, async () => {
    await fs.writeFile(destination, "activated\n");
    await fs.unlink(source);
    throw new TestTransactionFailureError();
  }), TestTransactionFailureError);
  assert.equal(await fs.readFile(source, "utf8"), "original\n");
  await assert.rejects(fs.stat(destination));
  assert.equal((await execa("git", ["status", "--porcelain"], { cwd: repoRoot })).stdout, "");
});
