/**
 * The individual preflight checks (`bin/doctor.ts` runs them). Each is
 * `(deps: Pick<DoctorDeps, …>) => CheckResult | Promise<CheckResult>` — the
 * only I/O is `deps.run` and `deps.fileExists`, so `bin/doctor.test.ts` fakes
 * both without touching the real filesystem or spawning real processes.
 *
 * Split out of `doctor.ts` purely for size; the shared substrate is
 * `bin/doctor-lib.ts` and the runner/CLI is `bin/doctor.ts`.
 */

import * as path from "node:path";
import { isRecord } from "../beebox/src/lib/is-record.js";
import { diskHealthFromBytes } from "../beebox/src/hub/disk-health.js";
import { schedulesStoreRoot, storeStateSchema } from "./lib/schedules.js";
import { fail, pass, satisfiesRange, type CheckResult, type DoctorDeps } from "./doctor-lib.js";

/** The one launchd label the schedules tick runs under (bin/lib/schedules-launchd.ts). */
const SCHEDULES_LABEL = "com.beebox.schedules";

export function checkNodeVersion(deps: Pick<DoctorDeps, "nodeVersion" | "engines">): CheckResult {
  const name = "Node version";
  try {
    const ok = satisfiesRange(deps.nodeVersion, deps.engines);
    if (ok) return pass(name, `${deps.nodeVersion} satisfies "${deps.engines}"`);
    return fail(name, {
      detail: `${deps.nodeVersion} does not satisfy "${deps.engines}"`,
      remedy: `install a Node version matching "${deps.engines}" (see root .nvmrc)`,
    });
  } catch (e) {
    return fail(name, {
      detail: `could not parse Node version/engines range: ${e instanceof Error ? e.message : String(e)}`,
      remedy: "check root package.json's engines.node field",
    });
  }
}

export async function checkPnpm(deps: Pick<DoctorDeps, "run" | "packageManager">): Promise<CheckResult> {
  const name = "pnpm";
  const result = await deps.run("pnpm", ["--version"]);
  if (!result.spawned) {
    return fail(name, {
      detail: "not found on PATH",
      remedy: "install pnpm (https://pnpm.io/installation) or enable it via `corepack enable`",
    });
  }
  const installedVersion = result.stdout.trim();
  const expectedVersion = deps.packageManager.split("@")[1];
  const expectedMajor = expectedVersion?.split(".")[0];
  const installedMajor = installedVersion.split(".")[0];
  if (expectedMajor === undefined) {
    return fail(name, {
      detail: `root packageManager field is malformed: "${deps.packageManager}"`,
      remedy: "fix packageManager in root package.json",
    });
  }
  if (installedMajor === expectedMajor) {
    return pass(name, `${installedVersion} (matches packageManager major ${expectedMajor})`);
  }
  return fail(name, {
    detail: `${installedVersion} does not match packageManager major ${expectedMajor} ("${deps.packageManager}")`,
    remedy: `run \`corepack use pnpm@${expectedVersion}\` (or install pnpm ${expectedMajor}.x directly)`,
  });
}

export function checkWorkspaceInstalled(deps: Pick<DoctorDeps, "fileExists" | "repoRoot">): CheckResult {
  const name = "Workspace installed";
  const hoistedDir = path.join(deps.repoRoot, "node_modules", ".pnpm");
  if (deps.fileExists(hoistedDir)) {
    return pass(name, `${hoistedDir} exists`);
  }
  return fail(name, {
    detail: `${hoistedDir} is missing`,
    remedy: "run `pnpm install` at the repo root",
  });
}

interface BinaryCheckSpec {
  displayName: string;
  binary: string;
  versionArgs: string[];
  remedy: string;
}

const EXTERNAL_TOOL_CHECKS: BinaryCheckSpec[] = [
  { displayName: "pandoc", binary: "pandoc", versionArgs: ["--version"], remedy: "install pandoc (brew install pandoc / apt-get install pandoc)" },
  { displayName: "magick", binary: "magick", versionArgs: ["-version"], remedy: "install ImageMagick (brew install imagemagick / apt-get install imagemagick)" },
  { displayName: "pdftotext", binary: "pdftotext", versionArgs: ["-v"], remedy: "install poppler-utils (brew install poppler / apt-get install poppler-utils)" },
];

async function checkBinaryOnPath(deps: Pick<DoctorDeps, "run">, spec: BinaryCheckSpec): Promise<CheckResult> {
  const result = await deps.run(spec.binary, spec.versionArgs);
  if (!result.spawned) {
    return fail(spec.displayName, { detail: "not found on PATH", remedy: spec.remedy });
  }
  const firstLine = (result.stdout || result.stderr).split("\n")[0]?.trim() ?? "";
  return pass(spec.displayName, firstLine !== "" ? firstLine : "found on PATH");
}

export async function checkExternalTools(deps: Pick<DoctorDeps, "run">): Promise<CheckResult[]> {
  return Promise.all(EXTERNAL_TOOL_CHECKS.map((spec) => checkBinaryOnPath(deps, spec)));
}

export async function checkGitLfs(deps: Pick<DoctorDeps, "run">): Promise<CheckResult> {
  const name = "git-lfs";
  const binaryResult = await deps.run("git-lfs", ["version"]);
  if (!binaryResult.spawned) {
    return fail(name, {
      detail: "not found on PATH",
      remedy: "install git-lfs (brew install git-lfs / apt-get install git-lfs)",
    });
  }
  const filterResult = await deps.run("git", ["config", "--get", "filter.lfs.clean"]);
  const filterInstalled = filterResult.spawned && filterResult.code === 0 && filterResult.stdout.trim() !== "";
  if (filterInstalled) {
    return pass(name, `binary present; filter.lfs.clean = "${filterResult.stdout.trim()}"`);
  }
  return fail(name, {
    detail: "binary present but LFS filters are not installed",
    remedy: "run `git lfs install`",
  });
}

export async function checkClaudeAuth(deps: Pick<DoctorDeps, "run">): Promise<CheckResult> {
  const name = "Claude auth";
  const which = await deps.run("claude", ["--version"]);
  if (!which.spawned) {
    return fail(name, {
      detail: "the `claude` CLI is not on PATH",
      remedy: "install the Claude Code CLI (https://code.claude.com) then run `claude auth login`",
    });
  }
  const status = await deps.run("claude", ["auth", "status"]);
  // Tolerant parse, mirroring beebox/src/services/claude-cli.ts's
  // authStatus(): stdout should be JSON, but fall back gracefully if not.
  let parsed: Record<string, unknown> | null = null;
  try {
    const raw: unknown = JSON.parse(status.stdout || "");
    parsed = isRecord(raw) ? raw : null;
  } catch (_e) {
    /* ignore: non-JSON output is the documented fallback path, not an error */
    parsed = null;
  }
  const loggedIn = parsed?.["loggedIn"] === true;
  if (loggedIn) {
    const email = typeof parsed?.["email"] === "string" ? parsed["email"] : undefined;
    return pass(name, email !== undefined ? `logged in as ${email}` : "logged in");
  }
  return fail(name, { detail: "not logged in", remedy: "run `claude auth login`" });
}

export async function checkNativeSqlite(deps: Pick<DoctorDeps, "loadBetterSqlite3">): Promise<CheckResult> {
  const name = "Native modules (better-sqlite3)";
  try {
    const detail = await deps.loadBetterSqlite3();
    return pass(name, detail);
  } catch (e) {
    const firstLine = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
    return fail(name, {
      detail: `better-sqlite3 failed to load: ${firstLine}`,
      remedy:
        "the compiled binary doesn't match this Node (ABI drift) — run `pnpm install` (or `pnpm rebuild better-sqlite3`) under the pinned Node version",
    });
  }
}

export function checkSdkBinary(deps: Pick<DoctorDeps, "resolveSdkBinary">): CheckResult {
  const name = "Agent SDK binary";
  const resolved = deps.resolveSdkBinary();
  if (resolved !== null) return pass(name, resolved);
  return fail(name, {
    detail: "no bundled Claude Code binary resolves for this platform",
    remedy:
      "reinstall dependencies (`pnpm install`) so the matching @anthropic-ai/claude-agent-sdk-* subpackage is present",
  });
}

export function checkFrontendBuild(deps: Pick<DoctorDeps, "fileExists" | "repoRoot">): CheckResult {
  const name = "Frontend build";
  const indexHtml = path.join(deps.repoRoot, "beebox", "src", "frontend", "dist", "index.html");
  if (deps.fileExists(indexHtml)) return pass(name, `${indexHtml} exists`);
  return fail(name, {
    detail: `${indexHtml} is missing`,
    remedy: "run `pnpm --dir beebox build:frontend`",
  });
}

/**
 * The deploy target this machine is configured for, as `user@host`, or null
 * when it has none.
 *
 * `beebox/deploy/deploy-target.sh` owns the answer — it is the same opt-in
 * layer the deploy and the commit hooks consult, so the doctor cannot form its
 * own opinion about which server is "production". Spawned through `deps.run`
 * rather than `bin/deploy-target.ts` because every check here is driven by a
 * fake `run` in the tests; the module and this share the one script.
 *
 * The config lives in the MAIN checkout (worktrees have their own, absent,
 * copy), which is why callers pass the shared-git-dir root, not `repoRoot`.
 */
async function deployTarget(
  deps: Pick<DoctorDeps, "run">,
  mainRoot: string,
): Promise<string | null> {
  const result = await deps.run(path.join(mainRoot, "beebox", "deploy", "deploy-target.sh"), ["ssh-target"]);
  if (!result.spawned || result.code !== 0) return null;
  const target = result.stdout.trim();
  return target === "" ? null : target;
}

/**
 * Is main's HEAD actually live on the server?
 *
 * A deploy killed outright — OOM, closed terminal — never runs deploy.sh's EXIT
 * trap, so it emits no "Deploy failed" line and no notification. Main then sits
 * undeployed with nothing anywhere saying so (observed 2026-08-10; the run died
 * during dependency reconciliation under memory pressure and was found only
 * because someone thought to ask).
 *
 * `deploy/.last-deployed-sha` is written by deploy.sh only past the healthcheck,
 * so it means "this shipped and answered", not "we started shipping it". The
 * marker lives in the MAIN checkout — worktrees each have their own gitignored
 * (absent) copy — so resolve it through the shared git dir rather than
 * `repoRoot`, which is whatever tree doctor was invoked from.
 *
 * Reports only on drift from `main`. A checkout sitting on a feature branch is
 * the normal case and says nothing about what's deployed.
 */
export async function checkDeployCurrency(deps: Pick<DoctorDeps, "run" | "fileExists">): Promise<CheckResult> {
  const name = "Deploy currency";
  const common = await deps.run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.spawned || common.stdout.trim() === "") return pass(name, "not a git checkout — skipped");
  const mainRoot = path.dirname(common.stdout.trim());
  // No deploy/target.env means this machine doesn't deploy at all (a fresh
  // clone, a contributor's checkout). Nothing to be stale about. This check is
  // also the drift net the commit hooks used to be: they now skip silently when
  // unconfigured, so a machine that DOES deploy and quietly stopped is caught
  // here rather than in every commit's output.
  if ((await deployTarget(deps, mainRoot)) === null) {
    return pass(name, "this checkout does not deploy — skipped");
  }

  const shaFile = path.join(mainRoot, "beebox", "deploy", ".last-deployed-sha");
  if (!deps.fileExists(shaFile)) {
    return pass(name, "no completed deploy recorded yet (marker added 2026-08-10)");
  }
  const [deployed, head] = await Promise.all([
    deps.run("cat", [shaFile]),
    deps.run("git", ["rev-parse", "main"]),
  ]);
  const deployedSha = deployed.stdout.trim();
  const headSha = head.stdout.trim();
  if (deployedSha === "" || headSha === "") return pass(name, "could not resolve both shas — skipped");
  if (deployedSha === headSha) return pass(name, `main ${headSha.slice(0, 8)} is live`);

  const behind = await deps.run("git", ["rev-list", "--count", `${deployedSha}..main`]);
  const count = behind.stdout.trim();
  return fail(name, {
    detail: `main is ${count === "" ? "ahead" : `${count} commit(s) ahead`} of the last completed deploy (${deployedSha.slice(0, 8)})`,
    remedy:
      "re-run `beebox/deploy/deploy.sh --ref $(git rev-parse main)` from the main checkout, then check deploy/.last-deploy.log",
  });
}

/**
 * Free space on the deployed host, against the threshold the hub itself uses.
 *
 * A full production disk truncated every large response with nothing saying so
 * (issues/closed/bugs/2026-08-28-disk-full-truncated-every-large-response.md).
 * The threshold comes from `beebox/src/hub/disk-health.ts` so the doctor
 * and the hub's own health route cannot disagree about what "low" means.
 *
 * Skips machines with no configured deploy target, same as `checkDeployCurrency`.
 */
export async function checkProductionDisk(
  deps: Pick<DoctorDeps, "run">,
): Promise<CheckResult> {
  const name = "Production disk";
  const common = await deps.run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.spawned || common.stdout.trim() === "") return pass(name, "not a git checkout — skipped");
  const mainRoot = path.dirname(common.stdout.trim());
  const sshTarget = await deployTarget(deps, mainRoot);
  if (sshTarget === null) return pass(name, "this checkout does not deploy — skipped");

  const disk = await deps.run("ssh", [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    sshTarget,
    "df", "-Pk", "/",
  ]);
  if (!disk.spawned || disk.code !== 0) {
    return fail(name, {
      detail: "could not query free space on production /",
      remedy: `check SSH access to ${sshTarget}, then rerun bin/doctor`,
    });
  }
  const fields = disk.stdout.trim().split("\n").at(-1)?.trim().split(/\s+/);
  const totalKib = Number(fields?.[1]);
  const freeKib = Number(fields?.[3]);
  if (!Number.isFinite(totalKib) || !Number.isFinite(freeKib)) {
    return fail(name, {
      detail: "production df output was unparseable",
      remedy: `run \`ssh ${sshTarget} df -Pk /\` and inspect the output`,
    });
  }
  const health = diskHealthFromBytes(freeKib * 1024, totalKib * 1024);
  const detail = `${health.freeGiB.toFixed(1)} GiB free on / (threshold: ${health.thresholdGiB.toFixed(1)} GiB)`;
  if (health.status === "ok") return pass(name, detail);
  return fail(name, { detail, remedy: "free production disk space before the next deploy" });
}

/**
 * Is the scheduler actually ticking, and is its launchd job loaded?
 *
 * This is the mitigation for the plan's critical gap: every schedule's
 * due-ness lives in the store, so a store that stopped being written (plist
 * booted out by an OS update, never installed, disk gone) stops every job with
 * nothing saying so. `<store>/state.json` is stamped by every tick, and the
 * plist is checked directly rather than inferred from it.
 *
 * `launchctl` unavailable is reported, not failed — this check must not turn a
 * Linux checkout or a sandbox into a red doctor.
 */
export async function checkSchedulesTick(
  deps: Pick<DoctorDeps, "run" | "fileExists" | "nowMs">,
): Promise<CheckResult> {
  const name = "Schedules tick";
  const common = await deps.run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.spawned || common.stdout.trim() === "") return pass(name, "not a git checkout — skipped");
  const storeRoot = schedulesStoreRoot(path.dirname(common.stdout.trim()));
  if (!deps.fileExists(storeRoot)) {
    return pass(name, `no schedule store at ${storeRoot} — no schedules installed on this machine`);
  }

  const state = await deps.run("cat", [path.join(storeRoot, "state.json")]);
  const parsed = state.stdout.trim() === ""
    ? null
    : storeStateSchema.safeParse(JSON.parse(state.stdout));
  if (parsed === null || !parsed.success) {
    return fail(name, {
      detail: `${storeRoot}/state.json is missing or unreadable — the scheduler has never ticked`,
      remedy: "run `bin/schedules install` from the main checkout, then `bin/schedules tick`",
    });
  }
  const ageMs = deps.nowMs - Date.parse(parsed.data.lastTickAt);
  const ageText = `${String(Math.round(ageMs / 60000))} min ago`;
  if (ageMs >= 60 * 60 * 1000) {
    return fail(name, {
      detail: `last tick ${ageText} (over an hour; the tick runs every 15 min)`,
      remedy:
        "check ~/Library/Logs/beebox-schedules.log, then `bin/schedules install` from the main checkout",
    });
  }

  const uid = await deps.run("id", ["-u"]);
  if (!uid.spawned) return pass(name, `last tick ${ageText} (could not check launchd)`);
  const loaded = await deps.run("launchctl", ["print", `gui/${uid.stdout.trim()}/${SCHEDULES_LABEL}`]);
  if (!loaded.spawned) return pass(name, `last tick ${ageText} (launchctl unavailable)`);
  if (loaded.code !== 0) {
    return fail(name, {
      detail: `last tick ${ageText}, but ${SCHEDULES_LABEL} is not loaded in launchd`,
      remedy: "run `bin/schedules install` from the main checkout",
    });
  }
  return pass(name, `last tick ${ageText}; ${SCHEDULES_LABEL} loaded`);
}
