// # Confirming manual workstream tests
//
// Boxholder confirmation removes only the `manual-testing` need. When no other
// needs remain, the issue is marked implemented and can move to the closed queue.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confirmTestedContent } from "../confirm-tested.js";

// The last need closes the issue and records who performed the acceptance step.
void test("The last need closes the issue and records who performed the acceptance step.", async () => {
  const result = confirmTestedContent(
    `---
title: Test me
workstream: seam
needs: [manual-testing]
---
## Manual testing

Try it.
`,
    "2026-08-09",
  );
  assert.equal(result.close, true);
  assert.doesNotMatch(result.content, /needs:/);
  assert.match(result.content, /resolution: implemented/);
  assert.match(result.content, /> Verified by boxholder 2026-08-09/);
});

// Other needs keep the issue open. Both flow and block YAML lists accepted by the
// frontmatter validator are supported.
void test("Other needs keep the issue open.", async () => {
  const flow = confirmTestedContent(
    `---
title: Test me
workstream: seam
needs: [decision, manual-testing]
---
## Manual testing
`,
    "2026-08-09",
  );
  assert.equal(flow.close, false);
  assert.match(flow.content, /needs: \[decision]/);
  assert.doesNotMatch(flow.content, /resolution:/);

  const block = confirmTestedContent(
    `---
title: Test me
workstream: seam
needs:
  - decision
  - manual-testing
---
## Manual testing
`,
    "2026-08-09",
  );
  assert.equal(block.close, false);
  assert.match(block.content, /needs:\n {2}- decision/);
  assert.doesNotMatch(block.content, /manual-testing/);
});

// An issue not awaiting manual testing cannot be confirmed through this path.
void test("An issue not awaiting manual testing cannot be confirmed through this path.", async () => {
  assert.throws(
    () =>
      confirmTestedContent(
        `---
title: Test me
workstream: seam
needs: [decision]
---
## Manual testing
`,
        "2026-08-09",
      ),
    /does not need manual testing/,
  );
});

const ISSUE = `---
title: Fixture
workstream: seam
needs: [manual-testing]
---
## Manual testing

Try it.
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

// A main checkout (and, when given, a private-issues/ repository inside it)
// committed from `files`.
function checkout({ t, files, privateFiles }: {
  t: { teardown: (fn: () => void) => void }; files: Record<string, string>; privateFiles?: Record<string, string>;
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "confirm-tested-"));
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }));
  const commit = (dir: string, entries: Record<string, string>): void => {
    for (const [rel, content] of Object.entries(entries)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@example.com");
    git(dir, "config", "user.name", "Test");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "fixture");
  };
  commit(root, { ".gitignore": "private-issues/\n", ...files });
  if (privateFiles !== undefined) commit(path.join(root, "private-issues"), privateFiles);
  return root;
}

function confirm(root: string): ReturnType<typeof spawnSync> & { stderr: string } {
  const repo = path.resolve(process.cwd(), "..");
  return spawnSync("bash", ["-c", [
    `. "${repo}/bin/lib/worktree-paths.sh"`,
    `. "${repo}/bin/lib/manual-testing.sh"`,
    "workstream_confirm_tested fixture.md true",
  ].join("; ")], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      REPO_DIR: repo,
      WT_MONO: root,
      WT_BOX_ROOT: path.join(root, "boxes"),
      WT_STATE_DIR: path.join(root, "state"),
    },
  });
}

// Closing the issue rewrites the plan entry that names it, in the same
// commit, and commits a private issue's link rewrite inside private-issues/.
// This is the 2026-11-15 failure: the plan's `issues:` entry kept the open
// path and the commit hook rejected the move.
void test("Closing the issue rewrites inbound references in the same commit, per repository", async (t) => {
  const root = checkout({ t, files: {
    "issues/features/fixture.md": ISSUE,
    "beebox/docs/plans/p.md": "---\ntitle: P\nstatus: implemented\nworkstream: seam\nissues:\n  - ../../../issues/features/fixture.md\n---\nBody.\n",
  }, privateFiles: { "bugs/q.md": "Public context: [fixture](../../issues/features/fixture.md).\n" } });
  const run = confirm(root);
  assert.equal(run.status, 0, run.stderr);
  t.check(git(root, "show", "--name-status", "-M", "--format=%s", "HEAD").trim().split("\n").map((l) => l.replace(/^R\d+/, "R")), [
    "Confirm manual testing for fixture",
    "",
    "M\tbeebox/docs/plans/p.md",
    "R\tissues/features/fixture.md\tissues/closed/features/fixture.md",
  ]);
  t.check(git(root, "show", "HEAD:beebox/docs/plans/p.md").split("\n")[5], "  - ../../../issues/closed/features/fixture.md");
  t.check(git(root, "status", "--porcelain"), "");
  const priv = path.join(root, "private-issues");
  t.check(git(priv, "show", "HEAD:bugs/q.md"), "Public context: [fixture](../../issues/closed/features/fixture.md).\n");
  t.check(git(priv, "status", "--porcelain"), "");
});

// A private file with uncommitted edits would be swept into the commit, so the
// move refuses before anything changes in either repository.
void test("A dirty private referrer refuses before any write", async (t) => {
  const root = checkout({ t, files: { "issues/features/fixture.md": ISSUE }, privateFiles: { "bugs/q.md": "See [fixture](../../issues/features/fixture.md).\n" } });
  fs.appendFileSync(path.join(root, "private-issues/bugs/q.md"), "Someone's draft.\n");
  const run = confirm(root);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /uncommitted changes; commit or restore them first: private-issues\/bugs\/q\.md/);
  t.check(git(root, "status", "--porcelain"), "");
  t.check(git(path.join(root, "private-issues"), "status", "--porcelain"), " M bugs/q.md\n");
});

// When the commit fails (here, its hook), the issue, the rewritten referrers,
// and the index return exactly to their original state.
void test("A failed commit restores the issue and its referrers", async (t) => {
  const root = checkout({ t, files: {
    "issues/features/fixture.md": ISSUE,
    "issues/bugs/b.md": "See [fixture](../features/fixture.md).\n",
  } });
  fs.writeFileSync(path.join(root, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 23\n", { mode: 0o755 });
  const run = confirm(root);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /transition failed; restored issues\/features\/fixture\.md/);
  assert.equal(fs.readFileSync(path.join(root, "issues/features/fixture.md"), "utf8"), ISSUE);
  assert.equal(fs.existsSync(path.join(root, "issues/closed/features/fixture.md")), false);
  t.check(git(root, "status", "--porcelain"), "");
});
