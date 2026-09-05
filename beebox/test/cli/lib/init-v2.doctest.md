# Box Init Command: v3 (one-root) scaffolding

`bbx init` on a path with no existing box scaffolds the one-root layout
(`docs/implemented-plans/one-root-box-layout.md`): the target path becomes the ONE root
— `package.json`, `tsconfig.json`, `.claude/`, `src/`, AND the operational
areas (`_content/`, `_config/`, `_bookkeeping/`, `_publish/`, `_tmp/`) all
live there together. shapeVersion 3 is the only box shape.

This mirrors what `src/cli/commands/init.ts`'s action does, without going
through Commander — same style as `test/cli/lib/init.doctest.md`'s `fullInit`
helper. It deliberately skips `symlinkClaudeMemory` (the one installer with a
REAL global side effect — it touches `~/.claude/projects/`), since a
filesystem doctest shouldn't leave litter outside its own tmpdir.

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
} from "../../../src/core/box/index.js";
import {
  detectBoxTarget,
  scaffoldPackageRoot,
  scaffoldBoxRoot,
  BoxPackageConflictError,
} from "../../../src/core/box/package.js";
import { generateRules } from "../../../src/core/init-rules.js";
import { generateSkills } from "../../../src/core/box/skills.js";
import { installValidationHooks } from "../../../src/core/install-validation-hooks.js";
import { stageAll, getLog, getStatus, isRepo, initRepo } from "../../../src/lib/git.js";
import { getBoxShape } from "../../../src/lib/box-shape.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { loadBoxSchemas, invalidateBoxSchemas } from "../../../src/schemas/registry.js";
import { parseFrontmatterObject } from "../../../src/cards/frontmatter.js";

const execFileP = promisify(execFile);

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-init-v3-test-"));
}

// Replicates cli/commands/init.ts's action: detect → scaffold (fresh only) →
// the installers → git init + commit at the box root (fresh only).
//
// The commit deliberately bypasses hooks (`--no-verify`), unlike production
// `bbx init`: `installValidationHooks` embeds whichever `bbx` `resolveBbxBin()`
// resolves to, which — inside a linked git worktree — is the STABLE MAIN
// CHECKOUT's `bbx` (by design, so a hook never points at an ephemeral
// worktree; see `install-validation-hooks.ts`'s module doc). That main
// checkout may not have this branch's fix yet, so letting the real
// pre-commit hook fire here would make the doctest's pass/fail depend on
// unrelated, unmerged state rather than the code under test. The hook's
// CONTENT is verified statically instead of executing it.
async function fullInit(targetPath) {
  const { mode, boxRoot } = await detectBoxTarget(targetPath);
  const isFresh = mode === "fresh";

  let isUpdate;
  if (isFresh) {
    // Same shared builder cli/commands/init.ts's action uses: scaffold the
    // npm-package half + initBox + node_modules/beebox, all at boxRoot.
    await scaffoldBoxRoot(boxRoot, { deps: true });
    isUpdate = false;
  } else {
    ({ isUpdate } = await initBox(boxRoot, { skipGit: true, branch: "main" }));
  }

  if (isFresh && !(await isRepo(boxRoot))) {
    await initRepo(boxRoot, "main");
  }

  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installSchedules(boxRoot);
  await installPersonality(boxRoot);
  await generateRules(boxRoot);
  await generateSkills(boxRoot);
  await installValidationHooks(boxRoot);

  if (isFresh) {
    await stageAll(boxRoot);
    await execFileP(
      "git",
      ["commit", "--no-verify", "-m", "Initialize Bee Box\n\nCreated-By: bbx init"],
      { cwd: boxRoot }
    );
  }

  return { mode, boxRoot, isUpdate };
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

## Fresh init produces the v3 one-root layout

```ts
const target = await makeTmpDir();
const { mode, boxRoot } = await fullInit(target);

mode
=> fresh

boxRoot === target
=> true
```

Fresh boxes keep map refresh, run cleanup, and the retrospective enabled, while
connector sync and chat review are opt-in. The retrospective is on by default
because it only spawns an agent once a human chat session has gone quiet — on a
box nobody chats with, its scan precheck skips and it costs nothing:

```ts continue
const seededScheduleNames = (await fs.readdir(path.join(boxRoot, "_config/schedules")))
  .filter((name) => name.endsWith(".scheduled-script.card"))
  .map((name) => name.slice(0, -".scheduled-script.card".length))
  .sort();
const enabledScheduleNames = [];
const disabledScheduleNames = [];
for (const name of seededScheduleNames) {
  const content = await fs.readFile(path.join(boxRoot, "_config/schedules", `${name}.scheduled-script.card`), "utf8");
  const fields = parseFrontmatterObject(content);
  if (fields === null) throw new Error(`Could not parse seeded schedule ${name}`);
  if (fields.enabled === false) disabledScheduleNames.push(name);
  else enabledScheduleNames.push(name);
}
```

```ts continue
`count=${seededScheduleNames.length}; enabled=${enabledScheduleNames.join(",")}; disabled=${disabledScheduleNames.join(",")}`
=> count=6; enabled=gc-procedure-runs,process-retrospective,refresh-maps; disabled=chat-review,check-calendar,check-email
```

Reinstalling the templates does not undo a boxholder's explicit choice. `enabled`
is a box-owned field, so whatever the box has set survives a template update —
here an explicit opt-OUT of the retrospective, which the seeded default now
leaves on:

```ts continue
const retroPath = path.join(boxRoot, "_config/schedules/process-retrospective.scheduled-script.card");
const retroContent = await fs.readFile(retroPath, "utf8");
await fs.writeFile(retroPath, retroContent.replace("---\n", "---\nenabled: false\n"));
let reinstall: string[] = [];
let preservedRetroEnabled: unknown = null;
try {
  reinstall = await installSchedules(boxRoot);
  preservedRetroEnabled = parseFrontmatterObject(await fs.readFile(retroPath, "utf8"))?.enabled;
} finally {
  await fs.writeFile(retroPath, retroContent);
}
```

```ts continue
`reinstall=${reinstall.join("|") || "none"}; retro=${String(preservedRetroEnabled)}`
=> reinstall=none; retro=false
```

The marker at `.beebox/box.json` declares `shapeVersion: 3`:

```ts continue
const marker = await readJson(path.join(boxRoot, ".beebox/box.json"));
marker.shapeVersion
=> 3
```

`package.json` at the box root names the package after its basename,
declares `beebox` as a dependency, and is a private ESM package:

```ts continue
const pkg = await readJson(path.join(boxRoot, "package.json"));
pkg.name === path.basename(boxRoot)
=> true

pkg.private
=> true

pkg.type
=> module

Object.keys(pkg.dependencies)
=> [
  "beebox",
  "react",
  "react-dom"
]
```

The `beebox` spec defaults to `link:<engine checkout>` when the
running engine is a source checkout (this test run) — a bare `^<version>`
range is unresolvable off-registry and would abort the box's own
`pnpm install` with a 404. Install tools that pin a tarball override via
`BBX_INIT_BBX_BOX_SPEC` (see `scaffoldPackageRoot`):

```ts continue
pkg.dependencies["beebox"] === `link:${PACKAGE_ROOT}`
=> true
```

`devDependencies` carries `typescript`/`@types/node`/`@types/react` — the
box's own `pnpm exec tsc` needs these to typecheck `src/` without a
symlink-only install providing them (Track F's real `pnpm install` is what
actually resolves them):

```ts continue
Object.keys(pkg.devDependencies).sort()
=> [
  "@types/node",
  "@types/react",
  "typescript"
]
```

`tsconfig.json` extends the shipped base and includes `src`:

```ts continue
const tsconfig = await readJson(path.join(boxRoot, "tsconfig.json"));
JSON.stringify(tsconfig)
=> {"extends":"beebox/tsconfig.base.json","include":["src"]}
```

`node_modules/beebox` is a symlink straight at the running engine
(Track F's real install replaces it) — `pnpm install` was NOT run:

No real install happened (no pnpm store dir), but the symlink target — the
engine's own `PACKAGE_ROOT` — is real:

```ts continue
const link = await fs.readlink(path.join(boxRoot, "node_modules", "beebox"));

await exists(path.join(boxRoot, "node_modules", ".pnpm"))
=> false

await exists(link)
=> true
```

`src/schemas/`, `src/views/`, and `src/tricks/` exist with their `CLAUDE.md`
scaffolds:

```ts continue
const schemasGuide = await fs.readFile(path.join(boxRoot, "src/schemas/CLAUDE.md"), "utf-8");
schemasGuide.includes("src/schemas/")
=> true

(await exists(path.join(boxRoot, "src/views/CLAUDE.md")))
=> true

(await fs.readFile(path.join(boxRoot, "src/tricks/scripts/CLAUDE.md"), "utf-8")).includes("src/tricks/")
=> true
```

The schemas guide teaches `import { z } from "beebox/schema"` (and
`stringifyYaml` from the same specifier) — not the bare `zod`/`yaml`
specifiers, which `src/schemas/` can't resolve (only `beebox/*` resolves
there, via the box's own `node_modules`; see
`test/schemas/box-schemas-v2.doctest.md`'s "bare zod import fails" case):

```ts continue
schemasGuide.includes('from "beebox/schema"')
=> true

schemasGuide.includes('from "zod"')
=> false

schemasGuide.includes('from "yaml"')
=> false
```

`.claude/` lives at the (one) box root — rules, skills, and the validation
hooks all landed there:

```ts continue
(await exists(path.join(boxRoot, ".claude", "rules", "card-memo.md")))
=> true

(await exists(path.join(boxRoot, ".claude", "skills", "views", "SKILL.md")))
=> true
```

The generated `connector-calendar` rule's `paths:` glob is `_content/calendar/…` — the underscore area, not the legacy `store/`:

```ts continue
const calendarRule = await fs.readFile(
  path.join(boxRoot, ".claude/rules/connector-calendar.md"),
  "utf-8"
);
calendarRule.includes('"_content/calendar/**/*.ics"')
=> true
```

A merged root `.gitignore` (covering both the npm namespace and the
operational rules) exists — `fullInit` here doesn't call `generateDocs`, so
it doesn't produce a root `CLAUDE.md` (that's `ensureAgentContext`'s job,
covered by `test/core/agent-context-mirrors.doctest.md`):

```ts continue
const gitignore = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
gitignore.includes("node_modules/")
=> true

gitignore.includes("_tmp/")
=> true
```

Git lives at the box root, with one initial commit covering the whole tree:

```ts continue
await isRepo(boxRoot)
=> true

const status = await getStatus(boxRoot);
status.clean
=> true

const log = await getLog(boxRoot, 5);
log.length
=> 1

log[0].subject
=> Initialize Bee Box
```

```ts cleanup
await fs.rm(target, { recursive: true, force: true });
```

## `scaffoldPackageRoot` refuses to clobber an existing `package.json`

A directory that already has a `package.json` (an unrelated project, or a
box that's already been scaffolded) is a hard conflict — fresh `bbx
init` must not silently overwrite it:

```ts
const conflictDir = await makeTmpDir();
await fs.writeFile(path.join(conflictDir, "package.json"), '{"name":"unrelated-project"}');

const err = await scaffoldPackageRoot(conflictDir).catch((e) => e);
err instanceof BoxPackageConflictError
=> true

err.message.includes("package.json")
=> true

err.message.includes(conflictDir)
=> true
```

```ts cleanup
await fs.rm(conflictDir, { recursive: true, force: true });
```

When `package.json` is absent but `tsconfig.json` already exists,
`scaffoldPackageRoot` leaves its content untouched — that file is
create-if-absent, not a hard conflict:

```ts
const partialDir = await makeTmpDir();
await fs.writeFile(path.join(partialDir, "tsconfig.json"), '{"extends":"./custom.json"}');

await scaffoldPackageRoot(partialDir);

(await fs.readFile(path.join(partialDir, "tsconfig.json"), "utf-8"))
=> {"extends":"./custom.json"}
```

`package.json` itself was still created fresh, since it was the one file
absent:

```ts continue
const partialPkg = await readJson(path.join(partialDir, "package.json"));
partialPkg.name === path.basename(partialDir)
=> true
```

```ts cleanup
await fs.rm(partialDir, { recursive: true, force: true });
```

## `getBoxShape` resolves the fresh box, and its schemas load natively

```ts
const target = await makeTmpDir();
const { boxRoot } = await fullInit(target);

const shape = await getBoxShape(boxRoot);
shape.shapeVersion
=> 3

shape.boxRoot === boxRoot
=> true
```

A schema dropped into `src/schemas/` loads via native `node_modules`
resolution — the same `node_modules/beebox` symlink `scaffoldPackageRoot`
created above serves `beebox/cards` and `beebox/schema`, no resolve-hook
fakery:

```ts continue
await fs.writeFile(
  path.join(shape.boxRoot, "src/schemas/widget.ts"),
  `import { body, cardSchema } from "beebox/cards";
import { z } from "beebox/schema";

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
