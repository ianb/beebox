# Confirming manual workstream tests

Boxholder confirmation removes only the `manual-testing` need. When no other
needs remain, the issue is marked implemented and can move to the closed queue.

```ts setup
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { confirmTestedContent } from "../../../bin/confirm-tested.js";
```

The last need closes the issue and records who performed the acceptance step.

```ts
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
```

Other needs keep the issue open. Both flow and block YAML lists accepted by the
frontmatter validator are supported.

```ts
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
assert.match(flow.content, /needs: \[decision\]/);
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
assert.match(block.content, /needs:\n  - decision/);
assert.doesNotMatch(block.content, /manual-testing/);
```

An issue not awaiting manual testing cannot be confirmed through this path.

```ts
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
```

The shell transaction runs doc-check after moving the issue. If validation
fails, both the issue and Git index return exactly to their original state.

```ts
const root = fs.mkdtempSync(path.join(os.tmpdir(), "confirm-tested-"));
t.teardown(() => fs.rmSync(root, { recursive: true, force: true }));
const issueDirectory = path.join(root, "issues", "features");
const beeBox = path.join(root, "beebox");
fs.mkdirSync(issueDirectory, { recursive: true });
fs.mkdirSync(beeBox);
fs.writeFileSync(path.join(beeBox, "package.json"), JSON.stringify({
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

const repo = path.resolve(process.cwd(), "..");
const run = spawnSync("bash", ["-c", [
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
assert.notEqual(run.status, 0);
assert.match(run.stderr, /transition failed; restored issues\/features\/fixture\.md/);
assert.equal(fs.readFileSync(issue, "utf8"), content);
assert.equal(fs.existsSync(path.join(root, "issues", "closed", "features", "fixture.md")), false);
JSON.stringify(execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}))
=> ""
```
