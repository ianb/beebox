# Box Init Command: v2 (package-layout) scaffolding

`cb init` on a path with no existing box now always scaffolds the v2 package
layout (see "The box repository" in `docs/plans/boxes-as-packages-v2.md`):
the target path becomes the PACKAGE root (`package.json`, `tsconfig.json`, a
thin root `CLAUDE.md`, `.claude/`, `src/`), and the operational box lives at
`<target>/content/`. `cb init` on an EXISTING legacy box stays legacy —
conversion to v2 is a later migration (Track H), not init's job.

This mirrors what `src/cli/commands/init.ts`'s action does, without going
through Commander — same style as `test/cli/lib/init.doctest.md`'s `fullInit`
helper for the legacy path. It deliberately skips `symlinkClaudeMemory` (the
one installer with a REAL global side effect — it touches
`~/.claude/projects/`), since a filesystem doctest shouldn't leave litter
outside its own tmpdir.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  initBox,
  installProcedures,
  installGuides,
  installSchedules,
  installPersonality,
} from "../../../src/core/box.js";
import { detectBoxTarget, scaffoldPackageRoot } from "../../../src/core/box-package.js";
import { generateRules } from "../../../src/core/init-rules.js";
import { generateSkills } from "../../../src/core/box-skills.js";
import { installValidationHooks } from "../../../src/core/install-validation-hooks.js";
import { stageAll, getLog, getStatus, isRepo, initRepo } from "../../../src/cli/lib/git.js";
import { getBoxShape } from "../../../src/cli/lib/box-shape.js";
import { loadBoxSchemas, invalidateBoxSchemas } from "../../../src/schemas/registry.js";

const execFileP = promisify(execFile);

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "cb-init-v2-test-"));
}

// Replicates cli/commands/init.ts's action: detect → scaffold the package
// half (fresh only) → initBox the operational half → the installers → git
// init + commit at the PACKAGE root (fresh only).
//
// The commit deliberately bypasses hooks (`--no-verify`), unlike production
// `cb init`: `installValidationHooks` embeds whichever `cb` `resolveCbBin()`
// resolves to, which — inside a linked git worktree — is the STABLE MAIN
// CHECKOUT's `cb` (by design, so a hook never points at an ephemeral
// worktree; see `install-validation-hooks.ts`'s module doc). That main
// checkout may not have this branch's fix yet, so letting the real
// pre-commit hook fire here would make the doctest's pass/fail depend on
// unrelated, unmerged state rather than the code under test. The "v2
// git-hooks trap" section below verifies the hook's CONTENT statically
// instead of executing it.
async function fullInit(targetPath) {
  const { mode, boxRoot, packageRoot } = await detectBoxTarget(targetPath);
  const isFresh = mode === "fresh";

  if (isFresh) await scaffoldPackageRoot(packageRoot);

  const { isUpdate } = await initBox(boxRoot, {
    skipGit: true,
    branch: "main",
    shapeVersion: isFresh ? 2 : undefined,
  });

  if (isFresh && !(await isRepo(packageRoot))) {
    await initRepo(packageRoot, "main");
  }

  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installSchedules(boxRoot);
  await installPersonality(boxRoot);
  await generateRules(boxRoot);
  await generateSkills(boxRoot);
  await installValidationHooks(boxRoot);

  if (isFresh) {
    await stageAll(packageRoot);
    await execFileP(
      "git",
      ["commit", "--no-verify", "-m", "Initialize callback box\n\nCreated-By: cb init"],
      { cwd: packageRoot }
    );
  }

  return { mode, boxRoot, packageRoot, isUpdate };
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
```

## Fresh init produces the v2 layout

```ts
const target = await makeTmpDir();
const { mode, boxRoot, packageRoot } = await fullInit(target);

mode
=> fresh

boxRoot
=> «*»/content

packageRoot === target
=> true
```

The marker at `content/.cb-box` declares `shapeVersion: 2`:

```ts continue
const marker = await readJson(path.join(boxRoot, ".cb-box"));
marker.shapeVersion
=> 2
```

`package.json` at the package root names the package after its basename,
declares `callback-box` as a dependency, and is a private ESM package:

```ts continue
const pkg = await readJson(path.join(packageRoot, "package.json"));
pkg.name === path.basename(packageRoot)
=> true

pkg.private
=> true

pkg.type
=> module

Object.keys(pkg.dependencies)
=> [
  "callback-box"
]
```

`tsconfig.json` extends the shipped base and includes `src`:

```ts continue
const tsconfig = await readJson(path.join(packageRoot, "tsconfig.json"));
JSON.stringify(tsconfig)
=> {"extends":"callback-box/tsconfig.base.json","include":["src"]}
```

`node_modules/callback-box` is a symlink straight at the running engine
(Track F's real install replaces it) — `pnpm install` was NOT run:

No real install happened (no pnpm store dir), but the symlink target — the
engine's own `PACKAGE_ROOT` — is real:

```ts continue
const link = await fs.readlink(path.join(packageRoot, "node_modules", "callback-box"));

await exists(path.join(packageRoot, "node_modules", ".pnpm"))
=> false

await exists(link)
=> true
```

`src/schemas/`, `src/views/`, and `src/tricks/` exist with their `CLAUDE.md`
scaffolds, path-adjusted for the package layout:

```ts continue
(await fs.readFile(path.join(packageRoot, "src/schemas/CLAUDE.md"), "utf-8")).includes("src/schemas/")
=> true

(await exists(path.join(packageRoot, "src/views/CLAUDE.md")))
=> true

(await fs.readFile(path.join(packageRoot, "src/tricks/scripts/CLAUDE.md"), "utf-8")).includes("src/tricks/")
=> true
```

`.claude/` lives at the package root, not under `content/` — rules, skills,
and the validation hooks all landed there:

```ts continue
(await exists(path.join(boxRoot, ".claude", "rules")))
=> false

(await exists(path.join(packageRoot, ".claude", "rules", "card-memo.md")))
=> true

(await exists(path.join(packageRoot, ".claude", "skills", "views", "SKILL.md")))
=> true
```

A thin root `CLAUDE.md` and a root `.gitignore` (`node_modules/`) exist
alongside the package files:

```ts continue
(await fs.readFile(path.join(packageRoot, "CLAUDE.md"), "utf-8")).includes("content/")
=> true

(await fs.readFile(path.join(packageRoot, ".gitignore"), "utf-8")).includes("node_modules/")
=> true
```

Git lives at the package root, with one initial commit covering the whole
tree (package files AND `content/`):

```ts continue
await isRepo(packageRoot)
=> true

const status = await getStatus(packageRoot);
status.clean
=> true

const log = await getLog(packageRoot, 5);
log.length
=> 1

log[0].subject
=> Initialize callback box
```

```ts cleanup
await fs.rm(target, { recursive: true, force: true });
```

## The v2 git-hooks trap: hooks `cd` into `content/`

`.git` sits at the package root, but git always invokes hooks with cwd = the
package root too (regardless of where `git commit` was run from) — so a hook
that just ran `cb validate --staged` without first `cd`-ing into `content/`
would never find `content/.cb-box` (`requireBoxRoot()` only walks UP). Both
the pre-commit and post-commit hooks bake in an explicit `cd "content"`
before invoking `cb`:

```ts
const target = await makeTmpDir();
const { packageRoot } = await fullInit(target);

const preCommit = await fs.readFile(path.join(packageRoot, ".git/hooks/pre-commit"), "utf-8");
preCommit.includes('cd "content"')
=> true

const postCommit = await fs.readFile(path.join(packageRoot, ".git/hooks/post-commit"), "utf-8");
postCommit.includes('cd "content"')
=> true
```

The `.claude/settings.json` PostToolUse hook needs no such fix — Claude Code
invokes it with cwd = the operating agent's own cwd (`content/` or a
subdirectory), which already resolves correctly without a `cd`:

```ts continue
const settings = await readJson(path.join(packageRoot, ".claude/settings.json"));
settings.hooks.PostToolUse[0].hooks[0].command.endsWith(" validate --hook")
=> true
```

(A live end-to-end run of the installed pre-commit hook via a real `git
commit` isn't exercised here — spawning the real `cb` binary through tsx from
inside a doctest is slow and an unnecessary source of flakiness for what the
static hook-body assertions above already prove. The hooks' actual git
plumbing — `git diff --cached --name-only --relative`, which is what makes
`listStagedCards`/`listStagedMarkdown` report `content/`-relative paths
correctly once cwd has already been `cd`'d there — is exercised for both
shapes by the pre-existing `validate.ts`/`validate-markdown.ts` doctests.)

```ts cleanup
await fs.rm(target, { recursive: true, force: true });
```

## `getBoxShape` resolves the fresh box, and its schemas load natively

```ts
const target = await makeTmpDir();
const { boxRoot } = await fullInit(target);

const shape = await getBoxShape(boxRoot);
shape.shapeVersion
=> 2

shape.boxRoot === boxRoot
=> true
```

A schema dropped into `src/schemas/` (the package root's code dir) loads via
native `node_modules` resolution — the same `node_modules/callback-box`
symlink `scaffoldPackageRoot` created above serves `callback-box/cards` and
`callback-box/schema`, no resolve-hook fakery:

```ts continue
await fs.writeFile(
  path.join(shape.packageRoot, "src/schemas/widget.ts"),
  `import { body, cardSchema } from "callback-box/cards";
import { z } from "callback-box/schema";

export default cardSchema("widget", {
  fields: { size: z.number(), body: body(z.string()) },
});
`
);
invalidateBoxSchemas(boxRoot);
const schemas = await loadBoxSchemas(boxRoot);
schemas.cardSchemas.map((s) => s.type)
=> [
  "widget"
]
```

```ts cleanup
await fs.rm(target, { recursive: true, force: true });
```

## Legacy box re-init is byte-stable — no v2 artifacts appear

An existing legacy box (no `content/` nesting) run through the same `cb
init` flow stays legacy: `detectBoxTarget` reports `update-legacy`, and none
of the package-scaffold files (`package.json`, `tsconfig.json`,
`node_modules/`, `src/`) appear alongside it.

```ts
const legacyBox = await makeTmpDir();
// shapeVersion defaults to 1 (legacy) when not specified.
await initBox(legacyBox, { branch: "main" });
await installProcedures(legacyBox);

const before = (await fs.readFile(path.join(legacyBox, ".cb-box"), "utf-8"));

const { mode, boxRoot, packageRoot } = await fullInit(legacyBox);

mode
=> update-legacy

boxRoot === legacyBox
=> true

packageRoot === legacyBox
=> true
```

The marker is untouched (re-init doesn't rewrite an existing marker) and no
v2 scaffold files were written:

```ts continue
(await fs.readFile(path.join(legacyBox, ".cb-box"), "utf-8")) === before
=> true

(await exists(path.join(legacyBox, "package.json")))
=> false

(await exists(path.join(legacyBox, "tsconfig.json")))
=> false

(await exists(path.join(legacyBox, "node_modules")))
=> false

(await exists(path.join(legacyBox, "src")))
=> false
```

Rules and skills still land at the legacy location (`boxRoot/.claude`, since
`packageRoot === boxRoot` here) — the shape-aware installers didn't move
anything for a legacy box:

```ts continue
(await exists(path.join(legacyBox, ".claude/rules/card-memo.md")))
=> true
```

```ts cleanup
await fs.rm(legacyBox, { recursive: true, force: true });
```
