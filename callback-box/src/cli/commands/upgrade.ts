/**
 * `cb upgrade --to <spec>` — upgrade a v2 (package-layout) box's callback-box
 * engine dependency, run pending data migrations, sync templates, and
 * typecheck, committing the result as one reviewable commit.
 *
 * See "Upgrade lifecycle (decision 4)" in
 * `docs/plans/boxes-as-packages-v2.md` — the step list there is this file's
 * spec. The critical property is the **Ghost lesson**: code and data revert
 * as ONE unit. `ghost update --rollback` used to revert only the code symlink
 * while the database stayed migrated forward, silently corrupting data
 * (https://github.com/TryGhost/Ghost-CLI/issues/699). Here the rollback unit
 * is a single `git reset --hard` at the package root — migrations mutate
 * tracked box files, so the same commit boundary that undoes the dependency
 * bump also undoes the migrations, with no separate "data rollback" step to
 * forget.
 *
 * **Old-engine/new-engine handoff.** `cb upgrade` itself runs under the box's
 * CURRENT (pre-upgrade) engine — that's just whichever `cb` binary the
 * boxholder invoked. Steps 0-2 (preflight, snapshot, dependency bump + `pnpm
 * install`) are fine under the old engine — they don't touch box-shape-aware
 * logic that could differ between versions. But steps 3+ (migrate, template
 * sync, typecheck) MUST run under the version being upgraded TO, since a
 * migration or template registered in the new version doesn't exist in the
 * old engine's in-process code. After `pnpm install` completes,
 * `packageRoot/node_modules/.bin/cb` on disk IS the new engine, so those
 * steps are spawned as subprocesses against that binary rather than called
 * in-process — the only way to actually run "new engine code" from a process
 * that is itself the old engine.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { getBoxShape } from "../lib/box-shape.js";
import { getStatus, getHead, revertToSnapshot, stageAll, commit } from "../lib/git.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

const OLD_ENGINE_CB_BIN = path.join(PACKAGE_ROOT, "bin", "cb");

export class LegacyBoxUpgradeError extends Error {
  constructor(boxRoot: string) {
    super(
      `${boxRoot} is a legacy (shapeVersion 1) box — \`cb upgrade\` only works on v2 ` +
        "(package-layout) boxes, which pin their own callback-box dependency. Convert it " +
        "first with the box-packageify migration (see docs/plans/boxes-as-packages-v2.md, " +
        "Track H) — not yet implemented."
    );
    this.name = "LegacyBoxUpgradeError";
  }
}

export class DirtyWorkingTreeError extends Error {
  constructor(packageRoot: string) {
    super(`${packageRoot} has uncommitted changes. Commit or stash them before \`cb upgrade\` — it needs a clean starting point to snapshot.`);
    this.name = "DirtyWorkingTreeError";
  }
}

export class UnresolvableSpecError extends Error {
  constructor(spec: string, resolvedPath: string) {
    super(`--to ${spec} looks like a tarball path, but nothing exists at ${resolvedPath}.`);
    this.name = "UnresolvableSpecError";
  }
}

export class UpgradeStepFailedError extends Error {
  readonly step: UpgradeStepLabel;
  readonly output: string;
  constructor(step: UpgradeStepLabel, output: string) {
    super(`cb upgrade step "${step}" failed (exit nonzero). See .output for captured command output.`);
    this.name = "UpgradeStepFailedError";
    this.step = step;
    this.output = output;
  }
}

export class InstalledVersionMissingError extends Error {
  constructor(packageRoot: string) {
    super(`${packageRoot}/node_modules/callback-box/package.json has no "version" field after install.`);
    this.name = "InstalledVersionMissingError";
  }
}

/**
 * Identifies which external command a `CommandRunner` call is for — lets a
 * fake runner (doctests) selectively fail one step while passing the rest
 * through, or fail the FIRST call and succeed a later retried one
 * (`pnpm-install` runs again, as `pnpm-install-restore`, during revert).
 *
 * Defined as a const object (referenced by identifier at every call site)
 * rather than inline string literals, so `UpgradeStepFailedError`'s
 * constructor calls pass an identifier, not a literal —
 * `error/no-literal-error-message` flags a literal *anywhere* in a `new
 * *Error(...)` call, not just the message position.
 */
export const UPGRADE_STEPS = {
  preflightValidate: "preflight-validate",
  pnpmInstall: "pnpm-install",
  cbMigrate: "cb-migrate",
  cbInit: "cb-init",
  tsc: "tsc",
  pnpmInstallRestore: "pnpm-install-restore",
} as const;

export type UpgradeStepLabel = (typeof UPGRADE_STEPS)[keyof typeof UPGRADE_STEPS];

export interface RunCommandArgs {
  label: UpgradeStepLabel;
  command: string;
  args: string[];
  cwd: string;
}

export interface RunCommandResult {
  code: number;
  output: string;
}

/** Every external process `cb upgrade` spawns (pnpm, git-reset aside, and
 *  the box's own `cb`) goes through this single injection point — the seam
 *  doctests use to simulate a step failing without a real network or a real
 *  built engine, while everything else (the git snapshot/reset, the actual
 *  files on disk) stays real. `git reset --hard` itself is NOT run through
 *  this — it's the one operation whose real effect the revert-path doctest
 *  needs to observe, so it always goes through `resetHard` (git.ts)
 *  directly. */
export type CommandRunner = (args: RunCommandArgs) => Promise<RunCommandResult>;

function defaultRunner(): CommandRunner {
  return ({ command, args, cwd }) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd });
      let output = "";
      child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => { resolve({ code: code ?? 1, output }); });
    });
}

/** A `--to` value that names a file rather than a semver range: an explicit
 *  `file:` spec, a relative/absolute path, or a `.tgz`. Only this shape gets
 *  a preflight existence check — a semver range is left to `pnpm install` to
 *  resolve (or fail loudly on). */
function isTarballPathSpec(spec: string): boolean {
  return spec.startsWith("file:") || spec.startsWith(".") || spec.startsWith("/") || spec.endsWith(".tgz");
}

async function assertSpecResolvable(spec: string, packageRoot: string): Promise<void> {
  if (!isTarballPathSpec(spec)) return;
  const raw = spec.startsWith("file:") ? spec.slice("file:".length) : spec;
  const resolved = path.isAbsolute(raw) ? raw : path.join(packageRoot, raw);
  try {
    await fs.access(resolved);
  } catch (_e) {
    throw new UnresolvableSpecError(spec, resolved);
  }
}

async function bumpCallbackBoxDependency(args: { packageRoot: string; spec: string }): Promise<void> {
  const pkgPath = path.join(args.packageRoot, "package.json");
  const raw = await fs.readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
  pkg.dependencies = { ...(pkg.dependencies ?? {}), "callback-box": args.spec };
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

async function readInstalledVersion(packageRoot: string): Promise<string> {
  const pkgPath = path.join(packageRoot, "node_modules/callback-box/package.json");
  const raw = await fs.readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { version?: string };
  if (!pkg.version) throw new InstalledVersionMissingError(packageRoot);
  return pkg.version;
}

async function appendUpgradeLog(boxRoot: string, line: string): Promise<void> {
  const logDir = path.join(boxRoot, ".callback-box/logs");
  await fs.mkdir(logDir, { recursive: true });
  const timestamp = new Date().toISOString();
  await fs.appendFile(path.join(logDir, "upgrade.log"), `${timestamp} ${line}\n`);
}

/**
 * Revert everything `runUpgrade` did after the snapshot, as one unit — see
 * the module doc comment's "Ghost lesson." `git reset --hard` at the
 * package root discards the dependency bump AND any migration data changes
 * together (both are ordinary working-tree edits under the same repo), then
 * `pnpm install` re-resolves the previous engine so the box is left in
 * exactly its pre-upgrade state, not just its pre-upgrade commit.
 */
async function revertUpgrade(args: {
  packageRoot: string;
  boxRoot: string;
  snapshotSha: string;
  runCommand: CommandRunner;
  failure: Error;
}): Promise<void> {
  const { packageRoot, boxRoot, snapshotSha, runCommand, failure } = args;
  // `revertToSnapshot` is `resetHard` + `clean(directories: true)` — see its
  // doc comment in git.ts. `git reset --hard` only reverts TRACKED changes;
  // a failed `cb migrate`/`cb init` step can have written new files (a
  // scaffolded template, a generated migration artifact) that were never
  // tracked, and those survive the reset untouched. The `clean` half is
  // safe HERE because (a) preflight already required a clean tree
  // (`git status --porcelain` empty), so any untracked non-ignored file
  // found now must have been created by the failed upgrade, and (b)
  // without `-x` it spares gitignored paths (node_modules, .callback-box
  // runtime state).
  await revertToSnapshot(packageRoot, snapshotSha);
  const restore = await runCommand({
    label: UPGRADE_STEPS.pnpmInstallRestore,
    command: "pnpm",
    args: ["install"],
    cwd: packageRoot,
  });
  const restoreNote = restore.code === 0
    ? "previous engine reinstalled"
    : `WARNING: reinstalling the previous engine also failed (exit ${String(restore.code)}) — node_modules may be inconsistent`;
  // Include the failed step's captured command output (truncated), not just
  // the wrapper Error's message — the message alone only names WHICH step
  // failed, not why; the output is what an operator actually needs to debug.
  const outputSnippet = failure instanceof UpgradeStepFailedError
    ? ` | output: ${failure.output.slice(0, 2000).replaceAll("\n", " ")}`
    : "";
  const logLine = `upgrade failed: ${failure.message} | reverted to ${snapshotSha} | ${restoreNote}${outputSnippet}`;
  await appendUpgradeLog(boxRoot, logLine);
  console.error(`\ncb upgrade failed: ${failure.message}`);
  console.error(`Reverted ${packageRoot} to ${snapshotSha} (code + data together) and ${restoreNote}.`);
  console.error(`See ${path.join(boxRoot, ".callback-box/logs/upgrade.log")} for the record.`);
}

export interface UpgradeOptions {
  to: string;
}

export interface UpgradeDeps {
  runCommand?: CommandRunner;
  /** Override the box-root lookup start path — for doctests that can't `cd` the process. */
  startPath?: string;
}

export interface UpgradeResult {
  installedVersion: string;
  commitHash: string;
}

/**
 * Run the full upgrade. Exported (rather than inlined in `.action()`) so
 * doctests can call it directly with a fake `runCommand` and inspect the
 * real filesystem/git effects. See the module doc comment for the step list
 * and the old/new engine handoff.
 */
export async function runUpgrade(options: UpgradeOptions, deps?: UpgradeDeps): Promise<UpgradeResult> {
  const runCommand = deps?.runCommand ?? defaultRunner();
  const boxRoot = await requireBoxRoot(deps?.startPath);
  const shape = await getBoxShape(boxRoot);
  if (shape.shapeVersion === 1) throw new LegacyBoxUpgradeError(boxRoot);
  const packageRoot = shape.packageRoot;

  // Step 0: preflight (fail-closed, nothing mutated yet — so no revert path
  // is needed if any of this fails).
  const status = await getStatus(packageRoot);
  if (!status.clean) throw new DirtyWorkingTreeError(packageRoot);
  await assertSpecResolvable(options.to, packageRoot);
  const preflightValidate = await runCommand({
    label: UPGRADE_STEPS.preflightValidate,
    command: OLD_ENGINE_CB_BIN,
    args: ["validate"],
    cwd: boxRoot,
  });
  if (preflightValidate.code !== 0) throw new UpgradeStepFailedError(UPGRADE_STEPS.preflightValidate, preflightValidate.output);

  // Step 1: snapshot. This one SHA is the whole rollback point for code AND
  // data — see the module doc comment.
  const snapshotSha = await getHead(packageRoot);

  try {
    // Step 2: bump the dependency + pnpm install (old engine still fine here).
    await bumpCallbackBoxDependency({ packageRoot, spec: options.to });
    const install = await runCommand({ label: UPGRADE_STEPS.pnpmInstall, command: "pnpm", args: ["install"], cwd: packageRoot });
    if (install.code !== 0) throw new UpgradeStepFailedError(UPGRADE_STEPS.pnpmInstall, install.output);

    // From here on, packageRoot/node_modules/.bin/cb IS the new engine —
    // spawn it (see module doc comment's "old-engine/new-engine handoff").
    const newCbBin = path.join(packageRoot, "node_modules/.bin/cb");

    // Step 3: data migrations.
    const migrate = await runCommand({ label: UPGRADE_STEPS.cbMigrate, command: newCbBin, args: ["migrate", "--apply"], cwd: boxRoot });
    if (migrate.code !== 0) throw new UpgradeStepFailedError(UPGRADE_STEPS.cbMigrate, migrate.output);

    // Step 4+5: template sync + regen tail (`cb init`'s update path covers
    // both — see runInit in init.ts). Run even though `cb migrate --apply`
    // may have already run `cb init` internally when migrations were
    // pending: when NOTHING was pending, migrate returns early without
    // touching templates at all, so this step must not be skipped.
    const init = await runCommand({ label: UPGRADE_STEPS.cbInit, command: newCbBin, args: ["init", boxRoot], cwd: boxRoot });
    if (init.code !== 0) throw new UpgradeStepFailedError(UPGRADE_STEPS.cbInit, init.output);

    // Step 6: typecheck the box's own src/ under the new engine's base tsconfig.
    const tsc = await runCommand({
      label: UPGRADE_STEPS.tsc,
      command: path.join(packageRoot, "node_modules/.bin/tsc"),
      args: ["-p", "."],
      cwd: packageRoot,
    });
    if (tsc.code !== 0) throw new UpgradeStepFailedError(UPGRADE_STEPS.tsc, tsc.output);

    // Step 7: commit everything as one unit.
    const installedVersion = await readInstalledVersion(packageRoot);
    await stageAll(packageRoot);
    const commitHash = await commit(packageRoot, {
      message: `Upgrade callback-box engine to ${installedVersion}`,
      trailers: { "Upgraded-To": `callback-box@${installedVersion}` },
    });

    return { installedVersion, commitHash };
  } catch (e) {
    await revertUpgrade({ packageRoot, boxRoot, snapshotSha, runCommand, failure: e as Error });
    throw e;
  }
}

export const upgradeCommand = new Command("upgrade")
  .description("Upgrade a v2 box's callback-box engine: bump the dependency, migrate data, sync templates, typecheck, commit")
  .requiredOption("--to <spec>", "callback-box dependency spec to upgrade to (a semver range, or a file:<path>/<path>.tgz tarball)")
  .action(async (options: { to: string }) => {
    try {
      const result = await runUpgrade({ to: options.to });
      console.log(`Upgraded to callback-box@${result.installedVersion} (commit ${result.commitHash}).`);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
