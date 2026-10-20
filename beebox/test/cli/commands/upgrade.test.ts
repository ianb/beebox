// # `bbx upgrade` — orchestration + the Ghost-lesson revert (Track E)
//
// `runUpgrade` composes existing machinery (`git`, `pnpm install`, the box's own
// `bbx migrate`/`bbx init`/`tsc`) behind a single `runCommand` injection point —
// see the module doc comment in `src/cli/commands/upgrade.ts`. Everything else
// (the git snapshot, the working tree, `package.json`, `node_modules/`) is
// real: these tests exercise a real git repo in a temp dir with a fake
// `runCommand` standing in for pnpm/the new engine's subprocesses, so the
// revert path's real effect (working tree back to the snapshot, previous
// engine "reinstalled") can be observed directly rather than asserted about a
// mock. All the fake-runner logic lives here in setup (module scope) — example
// blocks stay to single calls + assertions.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, instanceOf } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { runUpgrade, UpgradeStepFailedError, DirtyWorkingTreeError, type CommandRunner, type RunCommandArgs } from "../../../src/cli/commands/upgrade.js";
import { BoxShapeError } from "../../../src/lib/box-shape.js";
import { acquireBoxWork, boxMaintenanceStatus, boxWorkEnvironment, withoutBoxWork } from "../../../src/lib/box-maintenance/admission.js";
import { getStatus, getHead, getLog } from "../../../src/lib/git/core/operations.js";

async function waitForClosed(boxRoot: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await boxMaintenanceStatus(boxRoot)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("upgrade did not close admission");
}

const OLD_VERSION = "0.1.0";
const NEW_VERSION = "0.2.0";

async function writeInstalledVersion(boxRoot: string, version: string) {
  await fs.mkdir(path.join(boxRoot, "node_modules/beebox"), { recursive: true });
  await fs.writeFile(
    path.join(boxRoot, "node_modules/beebox/package.json"),
    JSON.stringify({ version }),
  );
}

async function readInstalledVersion(boxRoot: string): Promise<string> {
  const raw = await fs.readFile(path.join(boxRoot, "node_modules/beebox/package.json"), "utf-8");
  return JSON.parse(raw).version;
}

async function readPinnedSpec(boxRoot: string): Promise<string> {
  const raw = await fs.readFile(path.join(boxRoot, "package.json"), "utf-8");
  return JSON.parse(raw).dependencies["beebox"];
}

/** A real git repo shaped like a shapeVersion-3 box: `_config/`,
 *  package.json pinning beebox and recording the shape, and a (gitignored, like a real box)
 *  node_modules/beebox/package.json standing in for the installed
 *  engine. */
async function makeV3Fixture() {
  const boxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-upgrade-fixture-"));
  await fs.mkdir(path.join(boxRoot, "_config/schedules"), { recursive: true });
  await fs.writeFile(path.join(boxRoot, "_config/schedules/.gitkeep"), "");
  // Real boxes gitignore .beebox/ at the box root (box.ts's own
  // .gitignore template) — without it, the revert's log write below would
  // read as working-tree dirt and fail the "clean again" assertion for a
  // reason that isn't the thing under test.
  await fs.writeFile(
    path.join(boxRoot, "package.json"),
    JSON.stringify({ name: "fixture-box", dependencies: { "beebox": OLD_VERSION }, beebox: { shapeVersion: 3, created: "2026-01-01T00:00:00.000Z" } }, null, 2),
  );
  await writeInstalledVersion(boxRoot, OLD_VERSION);
  // node_modules is gitignored, same as a real box (scaffoldBoxRoot's
  // ROOT_GITIGNORE) — a real `pnpm install` isn't tracked, so reverting it
  // is the fake "pnpm-install-restore" step's job, not git's.
  await fs.writeFile(path.join(boxRoot, ".gitignore"), ".beebox/\nnode_modules/\n");
  execSync("git init -q -b main && git add -A && git commit -q -m init", { cwd: boxRoot });
  return boxRoot;
}

/** A quiet `bbx health --json` report: the shape the real command prints. */
const HEALTH_OK = JSON.stringify({ boxChecks: [{ name: "plugin-config", ok: true, message: "", severity: "error" }] });

/** A fake `runCommand`: records every step's label in `calls`, simulates
 *  `pnpm install` resolving `NEW_VERSION` and `pnpm-install-restore`
 *  reverting to `OLD_VERSION` (the two steps with a real filesystem side
 *  effect in production), answers `bbx health --json` with a quiet report,
 *  fails the step named in `failLabel` (if any) with `failOutput`, and
 *  returns `outputs[label]` verbatim for a step that should exit 0 with
 *  specific output (a validate report with warnings, a health report with
 *  failing rows). */
interface FakeRunnerOptions {
  boxRoot: string;
  calls: string[];
  failLabel?: string;
  failOutput?: string;
  junkFile?: string;
  outputs?: Record<string, string>;
}

function makeFakeRunner({ boxRoot, calls, failLabel, failOutput, junkFile, outputs }: FakeRunnerOptions): CommandRunner {
  return async ({ label }) => {
    calls.push(label);
    if (label === failLabel) {
      // A real template/migration write can scaffold a never-tracked file before failing.
      if (junkFile) await fs.writeFile(path.join(boxRoot, junkFile), "junk");
      return { code: 1, output: failOutput ?? "" };
    }
    const canned = outputs?.[label];
    if (canned !== undefined) return { code: 0, output: canned };
    if (label === "pnpm-install") await writeInstalledVersion(boxRoot, NEW_VERSION);
    if (label === "pnpm-install-restore") await writeInstalledVersion(boxRoot, OLD_VERSION);
    if (label === "bbx-health") return { code: 0, output: HEALTH_OK };
    return { code: 0, output: "" };
  };
}

function upgrade(boxRoot: string, runCommand: CommandRunner) {
  return runUpgrade({ to: NEW_VERSION }, { runCommand, startPath: boxRoot });
}

/** The error an upgrade that must fail throws. */
async function upgradeError(boxRoot: string, runCommand: CommandRunner): Promise<unknown> {
  try {
    await upgrade(boxRoot, runCommand);
  } catch (e) {
    return e;
  }
  throw new Error("upgrade did not fail");
}

// ## Happy path: every step runs in order, the commit carries the trailer
//
// The commit carries the `Upgraded-To` trailer with the ACTUALLY-installed
// version (read from `node_modules/beebox/package.json`), not the `--to` spec
// string:
void test("The commit carries the Upgraded-To trailer with the ACTUALLY-installed versio...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(boxRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const boxRoot = await makeV3Fixture();
  const calls: string[] = [];
  const result = await upgrade(boxRoot, makeFakeRunner({ boxRoot, calls }));
  t.check(result.installedVersion, "0.2.0");

  t.check(calls, [
    "preflight-validate",
    "pnpm-install",
    "bbx-migrate",
    "bbx-init",
    "tsc",
    "bbx-validate",
    "bbx-health",
  ]);

  t.check((await getLog(boxRoot, 1))[0]?.trailers, {
    "Upgraded-To": "beebox@0.2.0",
  });

  // A box that validates under the new engine, with its plugin health quiet,
  // reports nothing:

  t.check(({ validationIssues: result.validationIssues, pluginHealth: result.pluginHealth }), {
    validationIssues: null,
    pluginHealth: [],
  });
});

// ## Validation issues are reported, never a revert
//
// `bbx validate` under the new engine runs after typecheck so cards a plugin base
// change made invalid are listed by file. Its exit code does not decide anything:
// the upgrade commits and the result carries the output for the summary
// (boxholder decision 2026-10-10; `docs/plugins.md`, "Health").
void test("bbx validate under the new engine runs after typecheck so cards a plugin base...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(boxRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const boxRoot = await makeV3Fixture();
  const calls: string[] = [];
  const result = await upgrade(boxRoot, makeFakeRunner({ boxRoot, calls, failLabel: "bbx-validate", failOutput: "content/Acids.course.card: missing required field learner" }));
  t.check(result.validationIssues, "content/Acids.course.card: missing required field learner");

  t.check(calls, [
    "preflight-validate",
    "pnpm-install",
    "bbx-migrate",
    "bbx-init",
    "tsc",
    "bbx-validate",
    "bbx-health",
  ]);

  t.check((await getLog(boxRoot, 1))[0]?.trailers, {
    "Upgraded-To": "beebox@0.2.0",
  });
});

// A warning is kept too. A card whose type has no schema (a course card in a box
// that never wrote the courseware stubs) is a validate WARNING with exit 0, so the
// exit code alone would print success over it:
void test("A warning is kept too.", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(boxRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const boxRoot = await makeV3Fixture();
  const warned = "content/Acids.course.card\n  warning: no schema registered for card type \"course\" — card not validated\n1 file checked, 1 warning in 1 file\n";
  const result = await upgrade(boxRoot, makeFakeRunner({ boxRoot, calls: [], outputs: { "bbx-validate": warned } }));
  t.check(result.validationIssues?.split("\n")[1]?.trim(), "warning: no schema registered for card type \"course\" — card not validated");
});

// ## Plugin health under the new engine is reported, never a revert
//
// After validate, `bbx health --json` runs under the new engine and the failing
// plugin rows (`plugin-*`, `legacy-exposition-rules`, `skill-name-conflict`;
// `docs/plugins.md`, "Health") are carried into the result for the summary's
// `Plugin health after upgrade:` section. Other rows, and passing rows, are left
// out; a nonzero exit (health exits 1 on any error row) does not revert.
void test("After validate, bbx health --json runs under the new engine and the failing p...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(boxRoot, { recursive: true, force: true });
      await fs.rm(boxRoot2, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const boxRoot = await makeV3Fixture();
  const report = JSON.stringify({ boxChecks: [
    { name: "plugin-config", ok: true, message: "Every plugins entry in _config/box.json names an installed plugin", severity: "error" },
    { name: "plugin-type-unprovided", ok: false, message: "2 cards of type course have no schema. The courseware plugin provides it: `bbx plugins list`, then its README.", severity: "error" },
    { name: "legacy-exposition-rules", ok: false, message: "content/Acids.attach/Plan.exposition-plan.card still carries rules", severity: "warning" },
    { name: "google-auth", ok: false, message: "Google authorization expired", severity: "warning" },
  ] });
  const runner = makeFakeRunner({ boxRoot, calls: [], outputs: {} });
  const result = await upgrade(boxRoot, async (request: RunCommandArgs) => request.label === "bbx-health" ? { code: 1, output: report } : runner(request));
  t.check(result.pluginHealth, [
    "plugin-type-unprovided (error): 2 cards of type course have no schema. The courseware plugin provides it: `bbx plugins list`, then its README.",
    "legacy-exposition-rules (warning): content/Acids.attach/Plan.exposition-plan.card still carries rules",
  ]);

  t.check((await getLog(boxRoot, 1))[0]?.trailers, {
    "Upgraded-To": "beebox@0.2.0",
  });

  // Output that is not the health JSON (the new engine's `bbx health` crashed) is
  // one line in the same list rather than silence:

  const boxRoot2 = await makeV3Fixture();
  const broken = await upgrade(boxRoot2, async (request: RunCommandArgs) => request.label === "bbx-health" ? { code: 1, output: "TypeError: boom\n    at health.ts:1" } : makeFakeRunner({ boxRoot: boxRoot2, calls: [] })(request));
  t.check(broken.pluginHealth.map((line) => line.replace(/\(.*\)/, "(...)")), [
    "bbx health --json exited 1 without a JSON report (...): TypeError: boom",
  ]);
});

// ## Revert on failure: code + data revert as ONE unit (the Ghost lesson)
//
// `bbx-migrate` fails partway through, after scaffolding a new, never-tracked
// file (the shape a real template/migration write would take). The revert path
// must: `git reset --hard` the box root (undoing the `package.json` dependency
// bump), remove the untracked file (`git reset --hard` alone only reverts TRACKED
// changes), re-run `pnpm install` to restore the previous engine, log the
// failure, and leave the box in EXACTLY its pre-upgrade state — not just its
// pre-upgrade commit.
void test("bbx-migrate fails partway through, after scaffolding a new, never-tracked fil...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(boxRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const boxRoot = await makeV3Fixture();
  const snapshotSha = await getHead(boxRoot);
  const calls: string[] = [];
  const runCommand = makeFakeRunner({ boxRoot, calls, failLabel: "bbx-migrate", failOutput: "boom: migration blew up", junkFile: "untracked-scaffold.txt" });
  const thrown = await upgradeError(boxRoot, runCommand);
  t.check(thrown, instanceOf(UpgradeStepFailedError));

  t.check(calls, [
    "preflight-validate",
    "pnpm-install",
    "bbx-migrate",
    "pnpm-install-restore",
  ]);

  // The dependency bump is gone (`package.json` reverted by `git reset --hard`),
  // and the previous engine is back (the fake restore step's write, standing in
  // for a real `pnpm install`):

  t.check(await readPinnedSpec(boxRoot), "0.1.0");

  t.check(await readInstalledVersion(boxRoot), "0.1.0");

  // HEAD never moved (nothing had been committed yet), the untracked file is gone,
  // and the working tree is clean again — not just "no tracked diff", but
  // genuinely restored:

  t.check(await getHead(boxRoot), snapshotSha);

  t.check(await fs.access(path.join(boxRoot, "untracked-scaffold.txt")).then(() => true, () => false), false);

  t.check(await getStatus(boxRoot), { staged: [], modified: [], untracked: [], clean: true });

  // The failure is logged to `.beebox/logs/upgrade.log`:

  const logText = await fs.readFile(path.join(boxRoot, ".beebox/logs/upgrade.log"), "utf-8");
  t.check(logText, any(String).includes("boom: migration blew up"));
});

// ## Refusals before anything runs
//
// A dirty working tree refuses to start (nothing to snapshot against); a box that
// predates the one-root layout refuses with a clear error:
void test("A dirty working tree refuses to start (nothing to snapshot against); a box th...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(boxRoot, { recursive: true, force: true });
      await fs.rm(legacyRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const boxRoot = await makeV3Fixture();
  await fs.writeFile(path.join(boxRoot, "README.md"), "uncommitted\n");
  const dirty = await upgradeError(boxRoot, makeFakeRunner({ boxRoot, calls: [] }));

  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-upgrade-legacy-"));
  await fs.mkdir(path.join(legacyRoot, ".beebox"), { recursive: true });
  await fs.writeFile(path.join(legacyRoot, ".beebox/box.json"), "");
  execSync("git init -q -b main && git add -A && git commit -q -m init --allow-empty", { cwd: legacyRoot });
  const legacy = await upgradeError(legacyRoot, makeFakeRunner({ boxRoot: legacyRoot, calls: [] }));

  t.check([dirty instanceof DirtyWorkingTreeError, legacy instanceof BoxShapeError], [
    true,
    true,
  ]);
});

// ## Upgrade closes admission before preflight and drains accepted work
//
// The fake installer checks the real gate while the dependency has changed.
// The child migration joins its owner's maintenance window, and completion opens
// admission only after the final commit. No installer or live box is contacted.
void test("The fake installer checks the real gate while the dependency has changed.", async (t) => {
  t.teardown(async () => {
    try {
      await active.release();
      await fs.rm(boxRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const boxRoot = await makeV3Fixture();
  const active = await acquireBoxWork(boxRoot, { reason: "test" });
  const calls: string[] = [];
  let denied = false;
  let childJoins = false;
  let maintenancePermit = false;
  const fake = makeFakeRunner({ boxRoot, calls });
  const runCommand = async (request: RunCommandArgs) => {
    if (request.label === "pnpm-install") {
      denied = await withoutBoxWork(() => acquireBoxWork(boxRoot, { reason: "test" })).then(async work => { await work.release(); return false; }, () => true);
      maintenancePermit = JSON.parse(boxWorkEnvironment().BBX_BOX_WORK ?? "").maintenance;
    }
    if (request.label === "bbx-migrate") childJoins = request.args.includes("--within-maintenance");
    return fake(request);
  };
  const upgrading = upgrade(boxRoot, runCommand);
  await waitForClosed(boxRoot);
  t.check(calls, []);

  await active.release();
  const result = await upgrading;
  t.check(({ version: result.installedVersion, denied, childJoins, maintenancePermit, phase: await boxMaintenanceStatus(boxRoot) }), {
    version: "0.2.0",
    denied: true,
    childJoins: true,
    maintenancePermit: true,
    phase: null,
  });
});

// ## Reverted mutation remains closed until recovery validates the box
//
// The existing rollback restores tracked code and data and reinstalls the old
// engine. It does not validate that restored engine, so it cannot reopen work.
void test("The existing rollback restores tracked code and data and reinstalls the old e...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(boxRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const boxRoot = await makeV3Fixture();
  const result = await upgradeError(boxRoot, makeFakeRunner({ boxRoot, calls: [], failLabel: "tsc", failOutput: "bad types" }));
  t.check(result, instanceOf(UpgradeStepFailedError));
  t.check(({ phase: (await boxMaintenanceStatus(boxRoot))?.phase, version: await readPinnedSpec(boxRoot) }), {
    phase: "exclusive",
    version: "0.1.0",
  });
});
