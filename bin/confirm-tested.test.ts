import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { confirmTestedContent } from "./confirm-tested.js";

test("confirm clears manual-testing, records verification, and closes when no needs remain", () => {
  const result = confirmTestedContent(`---
title: Test me
workstream: seam
needs: [manual-testing]
---
## Manual testing

Try it.
`, "2026-08-09");
  assert.equal(result.close, true);
  assert.doesNotMatch(result.content, /needs:/);
  assert.match(result.content, /resolution: implemented/);
  assert.match(result.content, /> Verified by boxholder 2026-08-09/);
});

test("confirm preserves other needs and leaves the issue open", () => {
  const result = confirmTestedContent(`---
title: Test me
workstream: seam
needs: [decision, manual-testing]
---
## Manual testing
`, "2026-08-09");
  assert.equal(result.close, false);
  assert.match(result.content, /needs: \[decision\]/);
  assert.doesNotMatch(result.content, /resolution:/);
});

test("confirm refuses an issue without the flag", () => {
  assert.throws(() => confirmTestedContent(`---
title: Test me
workstream: seam
needs: [decision]
---
## Manual testing
`, "2026-08-09"), /does not need manual testing/);
});

test("confirm rolls the issue and index back when doc-check fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "confirm-tested-"));
  const issueDirectory = path.join(root, "issues", "features");
  const callbackBox = path.join(root, "callback-box");
  fs.mkdirSync(issueDirectory, { recursive: true });
  fs.mkdirSync(callbackBox);
  fs.writeFileSync(path.join(callbackBox, "package.json"), JSON.stringify({
    private: true,
    scripts: { "doc-check": "exit 23" },
  }));
  const issue = path.join(issueDirectory, "fixture.md");
  const content = `---
title: Fixture
workstream: seam
needs: [manual-testing]
---
## Manual testing

Try it.
`;
  fs.writeFileSync(issue, content);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });

  const repo = path.resolve(".");
  const run = spawnSync("bash", ["-c", `. "${repo}/bin/lib/manual-testing.sh"; workstream_confirm_tested fixture.md true`], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      REPO_DIR: repo,
      WT_MONO: root,
      WT_BOX_ROOT: path.join(root, "boxes"),
    },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /transition failed; restored issues\/features\/fixture\.md/);
  assert.equal(fs.readFileSync(issue, "utf8"), content);
  assert.equal(fs.existsSync(path.join(root, "issues", "closed", "features", "fixture.md")), false);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");
});
