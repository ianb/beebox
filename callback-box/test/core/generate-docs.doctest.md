# `generateDocs`'s template-sync commit — v2 path normalization

`commitTemplateSyncChanges` (in `src/core/generate-docs.ts`) runs at the
package root and filters `git status` output through `isTemplateManagedPath`
(`src/core/install-template-file.ts`) before committing — so only files the
`install*`/`generateRules` helpers actually manage get swept up, leaving any
other in-progress user work untouched.

`isTemplateManagedPath`'s patterns are written in the boxRoot-relative
`relPath` convention (plain paths for files under `boxRoot`, `../...` for the
handful a v2 box owns at the package root, e.g. `src/schemas/CLAUDE.md`). But
`getStatus` reports paths relative to the *package root* — for a v2 box
that's one level above `boxRoot` (`content/`), so every reported path carried
an unstripped `content/` (or bare `src/...`) prefix that never matched any
pattern. `commitTemplateSyncChanges` now normalizes each git-reported path
into the boxRoot-relative convention before filtering — this doctest exercises
that normalization directly, without going through the full `generateDocs`
pipeline (which would also install a real, executable `.git/hooks/pre-commit`
that shells out to a `cb` binary — an unrelated hazard in a repo-in-a-repo
dev/test environment).

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { commitTemplateSyncChanges } from "../../src/core/generate-docs.js";
import { getStatus, getLog } from "../../src/cli/lib/git.js";

/** A real git repo shaped like a v2 box package root, matching
 *  `getBoxShapeOrLegacyFallback`'s expectations: a `content/.cb-box`
 *  shapeVersion-2 marker and a `package.json` declaring the `callback-box`
 *  dependency (see `requireCallbackBoxDependency` in `box-shape.ts`). */
async function makeV2Fixture() {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cb-gendocs-v2-"));
  const boxRoot = path.join(packageRoot, "content");
  await fs.mkdir(boxRoot, { recursive: true });
  await fs.writeFile(path.join(boxRoot, ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
  await fs.writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "fixture", dependencies: { "callback-box": "0.1.0" } }, null, 2),
  );
  await fs.writeFile(path.join(packageRoot, ".gitignore"), "node_modules/\n");
  execSync("git init -q && git add -A && git commit -q -m init", { cwd: packageRoot });
  return { packageRoot, boxRoot };
}

/** A real git repo shaped like a legacy (shapeVersion 1) box — repo root IS
 *  boxRoot, so the sync path's normalization should be a no-op. */
async function makeLegacyFixture() {
  const boxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cb-gendocs-v1-"));
  await fs.writeFile(path.join(boxRoot, ".cb-box"), "");
  execSync("git init -q && git add -A && git commit -q -m init --allow-empty", { cwd: boxRoot });
  return { boxRoot };
}

async function tracked(repoRoot) {
  return execSync("git ls-files", { cwd: repoRoot }).toString().trim().split("\n").sort().join("\n");
}
```

## v2 box: template-managed files (including a package-root scaffold) get committed; an unrelated dirty file doesn't

Simulate what the `install*` helpers would have dirtied: a box-root template
(`config/template-versions.json`, `briefing.briefing.card`) and a
package-root-level scaffold (`src/schemas/CLAUDE.md`, reached via v2's
`../src/schemas/CLAUDE.md` `relPath` convention) — plus one unrelated file a
boxholder is mid-edit on.

```ts
const { packageRoot, boxRoot } = await makeV2Fixture();
await fs.mkdir(path.join(boxRoot, "config"), { recursive: true });
await fs.writeFile(path.join(boxRoot, "config/template-versions.json"), "{}\n");
await fs.writeFile(path.join(boxRoot, "briefing.briefing.card"), "---\n---\nhi\n");
await fs.mkdir(path.join(packageRoot, "src/schemas"), { recursive: true });
await fs.writeFile(path.join(packageRoot, "src/schemas/CLAUDE.md"), "# schemas\n");
await fs.writeFile(path.join(boxRoot, "notes.md"), "unrelated dirty file\n");

await commitTemplateSyncChanges(boxRoot);

await tracked(packageRoot)
=>
.gitignore
content/.cb-box
content/briefing.briefing.card
content/config/template-versions.json
package.json
src/schemas/CLAUDE.md
```

The unrelated file is left exactly as it was — untracked, uncommitted:

```ts continue
const status = await getStatus(packageRoot);
JSON.stringify(status.untracked)
=> ["content/notes.md"]
```

The commit lands with the expected subject and trailer:

```ts continue
const log = await getLog(packageRoot, 1);
log[0].subject
=> Sync templates from upstream

JSON.stringify(log[0].trailers)
=> {"Triggered-By":"generateDocs"}
```

```ts cleanup
await fs.rm(packageRoot, { recursive: true, force: true });
```

## v1 (legacy) box: behavior is unchanged — repo root IS boxRoot, so normalization is a no-op

```ts
const { boxRoot } = await makeLegacyFixture();
await fs.mkdir(path.join(boxRoot, "config"), { recursive: true });
await fs.writeFile(path.join(boxRoot, "config/calendar.guide.card"), "---\n---\nhi\n");
await fs.writeFile(path.join(boxRoot, "notes.md"), "unrelated dirty file\n");

await commitTemplateSyncChanges(boxRoot);

await tracked(boxRoot)
=>
.cb-box
config/calendar.guide.card
```

```ts continue
const status = await getStatus(boxRoot);
JSON.stringify(status.untracked)
=> ["notes.md"]

const log = await getLog(boxRoot, 1);
log[0].subject
=> Sync templates from upstream
```

```ts cleanup
await fs.rm(boxRoot, { recursive: true, force: true });
```
