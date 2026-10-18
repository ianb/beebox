// # Box Init Command: v3 (one-root) scaffolding
//
// `bbx init` on a path with no existing box scaffolds the one-root layout
// (`docs/implemented-plans/one-root-box-layout.md`): the target path becomes the ONE root
// — `package.json`, `tsconfig.json`, `.claude/`, `src/`, AND the operational
// areas (`_content/`, `_config/`, `_bookkeeping/`, `_publish/`, `_tmp/`) all
// live there together. shapeVersion 3 is the only box shape.
//
// This mirrors what `src/cli/commands/init.ts`'s action does, without going
// through Commander — same style as `test/core/box/structure.init.doctest.md`'s `fullInit`
// helper. It deliberately skips `symlinkClaudeMemory` (the one installer with a
// REAL global side effect — it touches `~/.claude/projects/`), since a
// filesystem doctest shouldn't leave litter outside its own tmpdir.

import { test } from "tap";
import "agent-doctest/tap";
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
} from "../../../src/core/box/structure/core.js";
import {
  detectBoxTarget,
  scaffoldPackageRoot,
  scaffoldBoxRoot,
  BoxPackageConflictError,
} from "../../../src/core/box/package.js";
import { generateRules } from "../../../src/core/init-rules.js";
import { generateSkills } from "../../../src/core/box/guidance-sync/skills/core.js";
import { installValidationHooks } from "../../../src/core/install-validation-hooks.js";
import { stageAll, isRepo, initRepo } from "../../../src/lib/git/core/operations.js";
import { getBoxShape } from "../../../src/lib/box-shape.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { loadBoxSchemas, invalidateBoxSchemas } from "../../../src/schemas.js";
import { parseFrontmatterObject } from "../../../src/cards/frontmatter.js";

const execFileP = promisify(execFile);

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-init-v3-test-"));
}

// Replicates cli/commands/init.ts's action: detect → scaffold (fresh only) →
// the installers → git init + commit at the box root (fresh only).
//
// The commit deliberately bypasses hooks (`--no-verify`), unlike production
// `bbx init`: the hook would run a full `bbx` process (the box's own engine,
// via the `node_modules/beebox` link `scaffoldBoxRoot` creates — see
// `resolveBbxBin` in `install-validation-hooks.ts`), which is the hook's
// behaviour, not this doctest's subject. The hook's CONTENT is verified
// statically instead of executing it.
async function fullInit(targetPath: string) {
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

async function readJson(p: string) {
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

async function exists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch (_e) {
    return false;
  }
}

// ## Fresh init produces the v3 one-root layout
void test("Fresh init produces the v3 one-root layout", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L113
  const target = await makeTmpDir();
  const { mode, boxRoot } = await fullInit(target);

  // doctest:L116
  t.check(mode, "fresh");

  // doctest:L119
  await t.checkText(boxRoot === target, "true");

  // Fresh boxes keep map refresh, run cleanup, and the retrospective enabled, while
  // connector sync and chat review are opt-in. The retrospective is on by default
  // because it only spawns an agent once a human chat session has gone quiet — on a
  // box nobody chats with, its scan precheck skips and it costs nothing:

  // doctest:L129
  const seededScheduleNames = (await fs.readdir(path.join(boxRoot, "_config/schedules")))
    .filter((name) => name.endsWith(".scheduled-script.card"))
    .map((name) => name.slice(0, -".scheduled-script.card".length))
    .toSorted();
  const enabledScheduleNames = [];
  const disabledScheduleNames = [];
  for (const name of seededScheduleNames) {
    const content = await fs.readFile(path.join(boxRoot, "_config/schedules", `${name}.scheduled-script.card`), "utf8");
    const fields = parseFrontmatterObject(content);
    if (fields === null) throw new Error(`Could not parse seeded schedule ${name}`);
    if (fields.enabled === false) disabledScheduleNames.push(name);
    else enabledScheduleNames.push(name);
  }

  // doctest:L145
  t.check(`count=${seededScheduleNames.length}; enabled=${enabledScheduleNames.join(",")}; disabled=${disabledScheduleNames.join(",")}`, "count=8; enabled=gc-procedure-runs,process-retrospective,refresh-maps,todo-review; disabled=chat-review,check-calendar,check-drive,check-email");

  // The Drive seed names the connector by its registered name (`google-drive`; the
  // `--connector` match is exact) and requires `drive` — the `google` requirement
  // is the legacy alias for calendar, so a Drive card must not use it:

  // doctest:L154
  const driveFields = parseFrontmatterObject(
    await fs.readFile(path.join(boxRoot, "_config/schedules/check-drive.scheduled-script.card"), "utf8"),
  );
  t.check(`runs=${driveFields?.runs}; enabled=${String(driveFields?.enabled)}; requires=${JSON.stringify(driveFields?.requires)}`, "runs=bbx engine wakeup --connector google-drive; enabled=false; requires={\"connectors\":[\"drive\"]}");

  // Reinstalling the templates does not undo a boxholder's explicit choice. `enabled`
  // is a box-owned field, so whatever the box has set survives a template update —
  // here an explicit opt-OUT of the retrospective, which the seeded default now
  // leaves on:

  // doctest:L167
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

  // doctest:L181
  t.check(`reinstall=${reinstall.join("|") || "none"}; retro=${String(preservedRetroEnabled)}`, "reinstall=none; retro=false");

  // `package.json` at the box root names the package after its basename and
  // declares `beebox`, `react`, `react-dom`, and `zod` as dependencies. `zod` is a
  // dependency, not a nicety: every box-local card schema imports it, and a box
  // scaffolded without it loaded those schemas to a bare `Cannot find package 'zod'`
  // warning while cards of that type silently validated as if no schema existed:

  // doctest:L192
  const pkg = await readJson(path.join(boxRoot, "package.json"));
  await t.checkText(pkg.name === path.basename(boxRoot), "true");

  // doctest:L196
  t.check(Object.keys(pkg.dependencies), [
    "beebox",
    "react",
    "react-dom",
    "zod",
  ]);

  // The `beebox` spec defaults to `link:<engine checkout>` when the
  // running engine is a source checkout (this test run) — a bare `^<version>`
  // range is unresolvable off-registry and would abort the box's own
  // `pnpm install` with a 404. Install tools that pin a tarball override via
  // `BBX_INIT_BBX_BOX_SPEC` (see `scaffoldPackageRoot`):

  // doctest:L212
  await t.checkText(pkg.dependencies["beebox"] === `link:${PACKAGE_ROOT}`, "true");

  // `devDependencies` carries `typescript`/`@types/node`/`@types/react` — the
  // box's own `pnpm exec tsc` needs these to typecheck `src/` without a
  // symlink-only install providing them (Track F's real `pnpm install` is what
  // actually resolves them):

  // doctest:L222
  t.check(Object.keys(pkg.devDependencies).toSorted(), [
    "@types/node",
    "@types/react",
    "typescript",
  ]);

  // The box's `typescript` is the TypeScript 7 version the engine itself runs:
  // the engine names it `@typescript/native` (its own `typescript` name is the 6.0
  // package typescript-eslint needs), and a box, which has no typescript-eslint,
  // takes the plain name:

  // doctest:L236
  t.check(pkg.devDependencies.typescript, "7.0.2");

  // `node_modules/beebox` is a symlink straight at the running engine
  // (Track F's real install replaces it) — `pnpm install` was NOT run:
  //
  // No real install happened (no pnpm store dir), but the symlink target — the
  // engine's own `PACKAGE_ROOT` — is real:

  // doctest:L247
  const link = await fs.readlink(path.join(boxRoot, "node_modules", "beebox"));

  // doctest:L249
  t.check(await exists(path.join(boxRoot, "node_modules", ".pnpm")), false);

  // doctest:L252
  t.check(await exists(link), true);

  // The generated `connector-calendar` rule's `paths:` glob is `_content/calendar/…` — the underscore area, not the legacy `store/`:

  // doctest:L259
  const calendarRule = await fs.readFile(
    path.join(boxRoot, ".claude/rules/connector-calendar.md"),
    "utf-8"
  );
  await t.checkText(calendarRule.includes('"_content/calendar/**/*.ics"'), "true");

  // A merged root `.gitignore` (covering both the npm namespace and the
  // operational rules) exists — `fullInit` here doesn't call `generateDocs`, so
  // it doesn't produce a root `AGENTS.md` (that's `ensureAgentContext`'s job,
  // covered by `test/core/agent-context-mirrors.doctest.md`):

  // doctest:L273
  const gitignore = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
  await t.checkText(gitignore.includes("node_modules/"), "true");

  // doctest:L277
  await t.checkText(gitignore.includes("_tmp/"), "true");
});

// ## `scaffoldPackageRoot` refuses to clobber an existing `package.json`
//
// A directory that already has a `package.json` (an unrelated project, or a
// box that's already been scaffolded) is a hard conflict — fresh `bbx
// init` must not silently overwrite it:
void test("A directory that already has a package.json (an unrelated project, or a box t...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(conflictDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L292
  const conflictDir = await makeTmpDir();
  await fs.writeFile(path.join(conflictDir, "package.json"), '{"name":"unrelated-project"}');

  // doctest:L295
  const err = await scaffoldPackageRoot(conflictDir).catch((e) => e);
  await t.checkText(err instanceof BoxPackageConflictError, "true");

  // doctest:L299
  await t.checkText(err.message.includes("package.json"), "true");

  // doctest:L302
  await t.checkText(err.message.includes(conflictDir), "true");
});

// When `package.json` is absent but `tsconfig.json` already exists,
// `scaffoldPackageRoot` leaves its content untouched — that file is
// create-if-absent, not a hard conflict:
void test("When package.json is absent but tsconfig.json already exists, scaffoldPackage...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(partialDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L315
  const partialDir = await makeTmpDir();
  await fs.writeFile(path.join(partialDir, "tsconfig.json"), '{"extends":"./custom.json"}');

  // doctest:L318
  await scaffoldPackageRoot(partialDir);

  // doctest:L320
  await t.checkText((await fs.readFile(path.join(partialDir, "tsconfig.json"), "utf-8")), "{\"extends\":\"./custom.json\"}");

  // `package.json` itself was still created fresh, since it was the one file
  // absent:

  // doctest:L328
  const partialPkg = await readJson(path.join(partialDir, "package.json"));
  await t.checkText(partialPkg.name === path.basename(partialDir), "true");
});

// ## `getBoxShape` resolves the fresh box, and its schemas load natively
void test("`getBoxShape` resolves the fresh box, and its schemas load natively", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L340
  const target = await makeTmpDir();
  const { boxRoot } = await fullInit(target);

  // doctest:L343
  const shape = await getBoxShape(boxRoot);
  t.check(shape.shapeVersion, 3);

  // doctest:L347
  await t.checkText(shape.boxRoot === boxRoot, "true");

  // A schema dropped into `src/schemas/` loads via native `node_modules`
  // resolution — the same `node_modules/beebox` symlink `scaffoldPackageRoot`
  // created above serves `beebox/cards` and `beebox/schema`, no resolve-hook
  // fakery:

  // doctest:L357
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
  t.check(schemas.cardSchemas.map((s) => s.type), [
    "widget",
  ]);
});
