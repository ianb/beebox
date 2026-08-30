# The unattended generated-docs refresh

`refreshGeneratedDocs` is what `deploy.sh` runs per box after `bbx migrate --sweep`
(as `bbx docs refresh`): regenerate the box's agent docs, card rules, and managed
skills if the engine that wrote them has moved on, commit the result, and leave
a box that needs a human alone. See `src/core/docs-refresh.ts`.

```ts setup
import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { refreshGeneratedDocs } from "../../src/core/docs-refresh.js";
import { GENERATE_MARKER } from "../../src/core/docs-gen/index.js";

/** A committed, clean box shaped enough like a real one for a full doc run:
 *  the box `.gitignore` a real box gets from `bbx init` (without it, the
 *  deliberately gitignored `docs/generated/` and `.beebox/` read as
 *  untracked and every run would look dirty) and a CLAUDE.md for the generator
 *  to add its @-includes to. */
async function makeCleanBox() {
  const box = await makeTmpBox({ git: true });
  await box.write(".gitignore", ".beebox/\ndocs/generated/\n");
  await box.write("CLAUDE.md", "# Box\n");
  box.commitAll("seed box");
  return box;
}

function git(box, ...args) {
  return execFileSync("git", args, { cwd: box.packageRoot }).toString().trim();
}

/** `.claude/` lives at the PACKAGE root for a v2 box, not under `content/`. */
function packagePath(box, rel) {
  return join(box.packageRoot, rel);
}
```

## A stale box is regenerated, and the result is committed

The first run on a box that has never generated: rules and skills land together
(they share one path now — `syncTemplatesFromSource` calls `generateRules` and
`generateSkills` side by side), and the tree is left **clean**. Clean is the
load-bearing part: a dirty box is one this step and the migration sweep both
skip, so a refresh that parked the box dirty would converge it exactly once.

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

Two commits, carrying the attribution of the two writers involved:
`generateDocs`'s own selective template-sync commit, then the sweep of what the
rest of the run wrote.

```ts continue
// `valueonly` still emits the trailer block's trailing newline, so drop blanks.
git(box, "log", "--format=%s|%(trailers:key=Triggered-By,valueonly)%(trailers:key=Created-By,valueonly)", "-2")
  .split("\n").filter((l) => l !== "")
=> [
  "Refresh generated docs|docs-refresh",
  "Sync templates from upstream|generateDocs"
]
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

await writeFile(packagePath(box, ".claude/rules/card-pdf.md"), "stale rule\n");
await writeFile(packagePath(box, ".claude/skills/views/SKILL.md"), "stale skill\n");
await rm(box.path(GENERATE_MARKER));
box.commitAll("box carries stale generated guidance");

const result = await refreshGeneratedDocs({ boxRoot: box.root });
const rule = await box.read("../.claude/rules/card-pdf.md");
const skill = await box.read("../.claude/skills/views/SKILL.md");
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

## A dirty box is skipped, not refreshed

Same bargain `sweepMigrations` makes: uncommitted changes mean someone's work is
in flight, and this runs where nobody can be asked. The skip is reported and the
next deploy retries.

```ts
const box = await makeCleanBox();
await box.write("box/notes.md", "work in progress\n");

const result = await refreshGeneratedDocs({ boxRoot: box.root });
JSON.stringify({
  status: result.status,
  generated: git(box, "ls-files", ".claude/rules") !== "",
})
=> {"status":"skipped-dirty","generated":false}
```

```ts cleanup
await box.cleanup();
```
