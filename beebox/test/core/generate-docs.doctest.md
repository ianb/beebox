# `generateDocs`'s template-sync commit — v2 path normalization

`commitTemplateSyncChanges` (in `src/core/docs-gen/index.ts`) runs at the
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
that shells out to a `bbx` binary — an unrelated hazard in a repo-in-a-repo
dev/test environment).

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { commitTemplateSyncChanges } from "../../src/core/docs-gen/index.js";
import { getStatus, getLog } from "../../src/lib/git.js";

/** A real git repo shaped like a v2 box package root, matching
 *  `getBoxShape`'s expectations: a `content/.beebox/box.json` shapeVersion-2 marker
 *  and a `package.json` declaring the `beebox` dependency (see
 *  `requireBeeBoxDependency` in `box-shape.ts`). */
async function makeV2Fixture() {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-gendocs-v2-"));
  const boxRoot = path.join(packageRoot, "content");
  await fs.mkdir(path.join(boxRoot, ".beebox"), { recursive: true });
  await fs.writeFile(path.join(boxRoot, ".beebox/box.json"), JSON.stringify({ shapeVersion: 2 }));
  await fs.writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "fixture", dependencies: { "beebox": "0.1.0" } }, null, 2),
  );
  await fs.writeFile(path.join(packageRoot, ".gitignore"), "node_modules/\n");
  execSync("git init -q -b main && git add -A && git commit -q -m init", { cwd: packageRoot });
  return { packageRoot, boxRoot };
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
content/.beebox/box.json
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
