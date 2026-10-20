// # Box Init Command: v3 (one-root) scaffolding
//
// `bbx init` on a path with no existing box scaffolds the one-root layout
// (`docs/implemented-plans/one-root-box-layout.md`): the target path becomes the ONE root
// — `package.json`, `tsconfig.json`, `.claude/`, `src/`, AND the operational
// areas (`_content/`, `_config/`, `_bookkeeping/`, `_publish/`, `_tmp/`) all
// live there together. shapeVersion 3 is the only box shape.
//
// This mirrors what `src/cli/commands/init.ts`'s action does, without going
// through Commander — same style as `test/core/box/structure.init.test.ts`'s `fullInit`
// helper. It deliberately skips `symlinkClaudeMemory` (the one installer with a
// REAL global side effect — it touches `~/.claude/projects/`), since a
// filesystem test shouldn't leave litter outside its own tmpdir.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, instanceOf, str } from "@ianbicking/tap-check/check";
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
// behaviour, not this test's subject. The hook's CONTENT is verified
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
  const target = await makeTmpDir();
  const { mode, boxRoot } = await fullInit(target);

  t.check(mode, "fresh");

  t.check(boxRoot, target);

  // Fresh boxes keep map refresh, run cleanup, and the retrospective enabled, while
  // connector sync and chat review are opt-in. The retrospective is on by default
  // because it only spawns an agent once a human chat session has gone quiet — on a
  // box nobody chats with, its scan precheck skips and it costs nothing:

  const seededScheduleNames = (await fs.readdir(path.join(boxRoot, "_config/schedules")))
    .filter((name) => name.endsWith(".scheduled-script.card"))
    .map((name) => name.slice(0, -".scheduled-script.card".length))
    .toSorted();
  const enabledScheduleNames: string[] = [];
  const disabledScheduleNames: string[] = [];
  for (const name of seededScheduleNames) {
    const content = await fs.readFile(path.join(boxRoot, "_config/schedules", `${name}.scheduled-script.card`), "utf8");
    const fields = parseFrontmatterObject(content);
    if (fields === null) throw new Error(`Could not parse seeded schedule ${name}`);
    if (fields.enabled === false) disabledScheduleNames.push(name);
    else enabledScheduleNames.push(name);
  }

  t.check(
    { seeded: seededScheduleNames, enabled: enabledScheduleNames, disabled: disabledScheduleNames },
    {
      seeded: [
        "chat-review",
        "check-calendar",
        "check-drive",
        "check-email",
        "gc-procedure-runs",
        "process-retrospective",
        "refresh-maps",
        "todo-review",
      ],
      enabled: ["gc-procedure-runs", "process-retrospective", "refresh-maps", "todo-review"],
      disabled: ["chat-review", "check-calendar", "check-drive", "check-email"],
    },
  );

  // The Drive seed names the connector by its registered name (`google-drive`; the
  // `--connector` match is exact) and requires `drive` — the `google` requirement
  // is the legacy alias for calendar, so a Drive card must not use it:

  const driveFields = parseFrontmatterObject(
    await fs.readFile(path.join(boxRoot, "_config/schedules/check-drive.scheduled-script.card"), "utf8"),
  );
  t.check(
    { runs: driveFields?.runs, enabled: driveFields?.enabled, requires: driveFields?.requires },
    { runs: "bbx engine wakeup --connector google-drive", enabled: false, requires: { connectors: ["drive"] } },
  );

  // Reinstalling the templates does not undo a boxholder's explicit choice. `enabled`
  // is a box-owned field, so whatever the box has set survives a template update —
  // here an explicit opt-OUT of the retrospective, which the seeded default now
  // leaves on:

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

  t.check({ reinstall, retro: preservedRetroEnabled }, { reinstall: [], retro: false });

  // `package.json` at the box root names the package after its basename and
  // declares `beebox`, `react`, `react-dom`, and `zod` as dependencies. `zod` is a
  // dependency, not a nicety: every box-local card schema imports it, and a box
  // scaffolded without it loaded those schemas to a bare `Cannot find package 'zod'`
  // warning while cards of that type silently validated as if no schema existed:

  const pkg = await readJson(path.join(boxRoot, "package.json"));
  t.check(pkg.name, path.basename(boxRoot));

  t.check(Object.keys(pkg.dependencies), [
    "beebox",
    "react",
    "react-dom",
    "zod",
  ]);

  // The `beebox` spec is the portable `link:.beebox/engine`, the same on
  // every machine; `.beebox/engine` is the gitignored link to the running
  // engine (`src/core/box/engine-link.ts`). Install tools that pin a tarball
  // override via `BBX_INIT_BEEBOX_SPEC` (see `scaffoldPackageRoot`):

  t.check(pkg.dependencies["beebox"], "link:.beebox/engine");

  t.check(await fs.readlink(path.join(boxRoot, ".beebox/engine")), PACKAGE_ROOT);

  // `devDependencies` carries `typescript`/`@types/node`/`@types/react` — the
  // box's own `pnpm exec tsc` needs these to typecheck `src/` without a
  // symlink-only install providing them (Track F's real `pnpm install` is what
  // actually resolves them):

  t.check(Object.keys(pkg.devDependencies).toSorted(), [
    "@types/node",
    "@types/react",
    "typescript",
  ]);

  // The box's `typescript` is the TypeScript 7 version the engine itself runs:
  // the engine names it `@typescript/native` (its own `typescript` name is the 6.0
  // package typescript-eslint needs), and a box, which has no typescript-eslint,
  // takes the plain name:

  t.check(pkg.devDependencies.typescript, "7.0.2");

  // `node_modules/beebox` links through the engine link, as `pnpm install`
  // would make it — `pnpm install` was NOT run:
  //
  // No real install happened (no pnpm store dir), but the link resolves to the
  // engine's own `PACKAGE_ROOT`:

  t.check(await fs.readlink(path.join(boxRoot, "node_modules", "beebox")), "../.beebox/engine");

  t.check(await exists(path.join(boxRoot, "node_modules", ".pnpm")), false);

  t.check(await fs.realpath(path.join(boxRoot, "node_modules", "beebox")), await fs.realpath(PACKAGE_ROOT));

  // The generated `connector-calendar` rule's `paths:` glob is `_content/calendar/…` — the underscore area, not the legacy `store/`:

  const calendarRule = await fs.readFile(
    path.join(boxRoot, ".claude/rules/connector-calendar.md"),
    "utf-8"
  );
  // A generated rule file: the glob is the contract here.
  t.check(calendarRule, any(String).includes('"_content/calendar/**/*.ics"'));

  // A merged root `.gitignore` (covering both the npm namespace and the
  // operational rules) exists — `fullInit` here doesn't call `generateDocs`, so
  // it doesn't produce a root `AGENTS.md` (that's `ensureAgentContext`'s job,
  // covered by `test/core/agent-context-mirrors.test.ts`):

  const gitignore = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
  // A large generated file: the two entries named above are the contract.
  t.check(gitignore, any(String).includes("node_modules/"));

  t.check(gitignore, any(String).includes("_tmp/"));
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
  const conflictDir = await makeTmpDir();
  await fs.writeFile(path.join(conflictDir, "package.json"), '{"name":"unrelated-project"}');

  const err = await scaffoldPackageRoot(conflictDir).catch((e) => e);
  t.check(err, instanceOf(BoxPackageConflictError));

  t.check(err, {
    name: "BoxPackageConflictError",
    message: str`Cannot initialize a beebox package at ${conflictDir}: it already has a package.json. Fresh \`bbx engine init\` scaffolds a new coding-session package there and won't overwrite an existing one — remove it first, or run \`bbx engine init\` on the directory only after confirming it's meant to become a box package.`,
  });

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
  const partialDir = await makeTmpDir();
  await fs.writeFile(path.join(partialDir, "tsconfig.json"), '{"extends":"./custom.json"}');

  await scaffoldPackageRoot(partialDir);

  await t.checkText((await fs.readFile(path.join(partialDir, "tsconfig.json"), "utf-8")), "{\"extends\":\"./custom.json\"}");

  // `package.json` itself was still created fresh, since it was the one file
  // absent:

  const partialPkg = await readJson(path.join(partialDir, "package.json"));
  t.check(partialPkg.name, path.basename(partialDir));
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
  const target = await makeTmpDir();
  const { boxRoot } = await fullInit(target);

  const shape = await getBoxShape(boxRoot);
  t.check(shape, { shapeVersion: 3, boxRoot });


  // A schema dropped into `src/schemas/` loads via native `node_modules`
  // resolution — the same `node_modules/beebox` symlink `scaffoldPackageRoot`
  // created above serves `beebox/cards` and `beebox/schema`, no resolve-hook
  // fakery:

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
