import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

test("scheduled manual-test failure leaves a local issue and per-run log", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "manual-tests-scheduled-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));

  const fixtureBin = path.join(fixture, "bin");
  const fixtureIssues = path.join(fixture, "issues", "bugs");
  const fixtureCodeQuality = path.join(fixture, "issues", "code-quality");
  const fixtureHomeBin = path.join(fixture, "home", ".local", "bin");
  await Promise.all([
    fs.mkdir(fixtureBin, { recursive: true }),
    fs.mkdir(fixtureIssues, { recursive: true }),
    fs.mkdir(fixtureCodeQuality, { recursive: true }),
    fs.mkdir(fixtureHomeBin, { recursive: true }),
  ]);

  const sourceScript = path.join(import.meta.dirname, "manual-tests-scheduled.sh");
  const fixtureScript = path.join(fixtureBin, "manual-tests-scheduled.sh");
  const fakeOsascript = path.join(fixtureHomeBin, "osascript");
  const fixtureDriver = path.join(fixtureBin, "exercise-reporting.sh");
  const notificationArgs = path.join(fixture, "home", "notification-args");
  await fs.copyFile(sourceScript, fixtureScript);
  await fs.writeFile(fakeOsascript, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/notification-args\"\n");
  await fs.writeFile(path.join(fixtureIssues, "2026-01-01-unrelated.md"), "---\ntitle: Unrelated\n---\n");
  await fs.writeFile(fixtureDriver, [
    "#!/bin/bash",
    "set -euo pipefail",
    "export MANUAL_TESTS_SOURCE_ONLY=1",
    `export MANUAL_TESTS_OSASCRIPT=${JSON.stringify(fakeOsascript)}`,
    `. ${JSON.stringify(fixtureScript)}`,
    "failure_kind=tests",
    "run_commit=abc123",
    "run_branch=main",
    "setup_run_log",
    "echo \"repo: $run_commit branch=$run_branch\"",
    "echo 'synthetic manual-test failure'",
    "test -z \"$(find_open_failure_issue)\"",
    "issue_path=\"$(record_failure_issue 7)\"",
    "notify_failure \"$issue_path\"",
    "mv \"$REPO_ROOT/$issue_path\" \"$REPO_ROOT/issues/code-quality/2026-01-02-renamed-failure.md\"",
    "RUN_ID=second-run",
    "failure_log=logs/manual-tests/second-run.log",
    "record_failure_issue 7 >/dev/null",
  ].join("\n"));
  await Promise.all([
    fs.chmod(fixtureScript, 0o755),
    fs.chmod(fakeOsascript, 0o755),
    fs.chmod(fixtureDriver, 0o755),
  ]);

  const run = await execa(fixtureDriver, {
    cwd: fixture,
    env: {
      HOME: path.join(fixture, "home"),
    },
  });
  assert.equal(run.exitCode, 0);

  const logDir = path.join(fixture, "logs", "manual-tests");
  const latestTarget = await fs.readlink(path.join(logDir, "latest.log"));
  const latest = await fs.readFile(path.join(logDir, latestTarget), "utf8");
  assert.match(latest, /repo: [0-9a-f]+ branch=main/);
  assert.match(latest, /synthetic manual-test failure/);
  assert.deepEqual(await fs.readdir(fixtureIssues), ["2026-01-01-unrelated.md"]);

  const renamedIssue = path.join(fixtureCodeQuality, "2026-01-02-renamed-failure.md");
  const issue = await fs.readFile(renamedIssue, "utf8");
  assert.match(issue, /title: "Weekly manual tests failed"/);
  assert.match(issue, /labels: \[scheduled-manual-tests\]/);
  assert.ok(issue.includes(`log \`logs/manual-tests/${latestTarget}\``));
  assert.match(issue, /log `logs\/manual-tests\/second-run\.log`/);
  assert.equal(issue.match(/test suite failure; exit 7/g)?.length, 2);

  const notification = await fs.readFile(notificationArgs, "utf8");
  assert.ok(notification.includes(`Log: logs/manual-tests/${latestTarget}.`));
});
