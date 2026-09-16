# The unattended generated-docs refresh

`refreshGeneratedDocs` is what `deploy.sh` runs per box after `bbx migrate --sweep`
(as `bbx docs refresh`): regenerate the box's agent docs, card rules, and managed
skills if the engine that wrote them has moved on, commit the result, and leave
a box that needs a human alone. See `src/core/docs-refresh.ts`.

```ts setup
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { rm, writeFile, mkdir, chmod, access } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { refreshGeneratedDocs } from "../../src/core/docs-refresh.js";
import { acquireBoxWork, boxMaintenanceStatus } from "../../src/lib/box-maintenance.js";
import { GENERATE_MARKER } from "../../src/core/docs-gen/index.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";

// This runs a real, executable `.git/hooks/pre-commit`. In a linked worktree,
// `resolveBbxBin` (install-validation-hooks.ts) would otherwise stamp the
// MAIN checkout's `bbx` — which can lag behind whatever this worktree is
// actively developing — so pin it to this checkout's own freshly-built binary.
process.env["BBX_HOOK_BIN"] = join(PACKAGE_ROOT, "bin", "bbx");

/** A committed, clean box shaped enough like a real one for a full doc run:
 *  the box `.gitignore` a real box gets from `bbx init` (without it, the
 *  deliberately gitignored `_content/docs/generated/` and `.beebox/` read as
 *  untracked and every run would look dirty) and a CLAUDE.md for the generator
 *  to add its @-includes to. */
async function makeCleanBox() {
  const box = await makeTmpBox({ git: true });
  await box.write(".gitignore", ".beebox/\n_content/docs/generated/\n");
  await box.write("CLAUDE.md", "# Box\n");
  box.commitAll("seed box");
  return box;
}

function git(box, ...args) {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}
```

## A stale box is regenerated, and the result is committed

The first run on a box that has never generated: rules and skills land together
(they share one path now — `syncTemplatesFromSource` calls `generateRules` and
`generateSkills` side by side), and the generated output is committed together.

```ts
const box = await makeCleanBox();

const result = await refreshGeneratedDocs({ boxRoot: box.root });
JSON.stringify({
  status: result.status,
  rules: git(box, "ls-files", ".claude/rules").includes("card-pdf.md"),
  skills: git(box, "ls-files", ".claude/skills").includes("skills/views/SKILL.md"),
  clean: git(box, "status", "--porcelain") === "",
})
=> {"status":"refreshed","rules":true,"skills":true,"clean":true}
```

One measured output commit carries the refresh attribution.

```ts continue
git(box, "log", "-1", "--format=%s|%(trailers:key=Created-By,valueonly)")
=> Refresh generated docs|docs-refresh
```

```ts cleanup
await box.cleanup();
```

## A box whose docs are current is a silent no-op

This runs against every box on every deploy, so the quiet path has to stay
quiet. The cache (input mtimes + the running engine's version) is left in place
rather than forced — a box someone chatted with between the deploy and this step
already regenerated.

```ts
const box = await makeCleanBox();
await refreshGeneratedDocs({ boxRoot: box.root });
const before = Number(git(box, "rev-list", "--count", "HEAD"));

const result = await refreshGeneratedDocs({ boxRoot: box.root });
JSON.stringify({
  status: result.status,
  newCommits: Number(git(box, "rev-list", "--count", "HEAD")) - before,
})
=> {"status":"current","newCommits":0}
```

Quiet also means the gate never closed. With live work admitted, a refresh that
closed first would wait in its drain; this one answers while the work is still
running and leaves no maintenance phase behind.

```ts continue
const busy = await acquireBoxWork(box.root, { reason: "live chat run" });
const quiet = refreshGeneratedDocs({ boxRoot: box.root }).then((outcome) => outcome.status);
await Promise.race([quiet, new Promise((resolve) => setTimeout(() => resolve("still draining"), 3000))])
=> current

await boxMaintenanceStatus(box.root)
=> null

await busy.release();
```

```ts cleanup
await box.cleanup();
```

## Stale rules and skills are rewritten once the cache is invalidated

What the deploy step exists for: the engine moved, so the generated guidance the
box carries is wrong. Dropping the marker stands in for the version bump the
deploy stamp gives on the real path.

```ts
const box = await makeCleanBox();
await refreshGeneratedDocs({ boxRoot: box.root });

await writeFile(box.path(".claude/rules/card-pdf.md"), "stale rule\n");
await writeFile(box.path(".claude/skills/views/SKILL.md"), "stale skill\n");
await rm(box.path(GENERATE_MARKER));
box.commitAll("box carries stale generated guidance");

const result = await refreshGeneratedDocs({ boxRoot: box.root });
const rule = await box.read(".claude/rules/card-pdf.md");
const skill = await box.read(".claude/skills/views/SKILL.md");
JSON.stringify({
  status: result.status,
  rule: rule.startsWith("stale"),
  skill: skill.startsWith("stale"),
  clean: git(box, "status", "--porcelain") === "",
})
=> {"status":"refreshed","rule":false,"skill":false,"clean":true}
```

```ts cleanup
await box.cleanup();
```

## Dirty input remains outside the generated-output commit

```ts
const box = await makeCleanBox();
await box.write("_content/notes.md", "work in progress\n");
git(box, "add", "_content/notes.md");
const result = await refreshGeneratedDocs({ boxRoot: box.root });
JSON.stringify({ status: result.status, staged: git(box, "diff", "--cached", "--name-only"), committed: git(box, "ls-tree", "--name-only", "HEAD", "_content/notes.md") })
=> {"status":"refreshed","staged":"_content/notes.md","committed":""}
```

```ts cleanup
await box.cleanup();
```

## Rejected output invalidates the cache and retains its original recovery baseline

The failed generation has already written files. Retrying must commit those
files, rather than treating them as unrelated dirt in a fresh snapshot.

```ts
const box = await makeCleanBox();
const hooks = join(git(box, "rev-parse", "--absolute-git-dir"), "reject-hooks");
await mkdir(hooks);
await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
await chmod(join(hooks, "pre-commit"), 0o755);
git(box, "config", "core.hooksPath", hooks);
await refreshGeneratedDocs({ boxRoot: box.root })
=> throws DocsRefreshError

await access(box.path(GENERATE_MARKER))
=> throws Error

const pending = git(box, "rev-parse", "refs/bbx/migrations/docs-refresh/pending");
pending.length > 0
=> true

git(box, "config", "--unset", "core.hooksPath");
const result = await refreshGeneratedDocs({ boxRoot: box.root, recover: true });
JSON.stringify({ status: result.status, rules: git(box, "ls-files", ".claude/rules").includes("card-pdf.md"), pending: git(box, "for-each-ref", "--format=%(objectname)", "refs/bbx/migrations/docs-refresh/pending"), clean: git(box, "status", "--porcelain") === "" })
=> {"status":"refreshed","rules":true,"pending":"","clean":true}
```

```ts cleanup
await box.cleanup();
```
