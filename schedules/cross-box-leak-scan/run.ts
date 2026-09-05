/**
 * The weekly cross-box leak scan: two mechanical legs — a static sweep of
 * beebox's HTTP surface (`static-sweep.ts`) and a host-state audit
 * (`host-audit.ts`), run both locally and against the deployed server — plus
 * a presence check for the dynamic probe doctest another workstream is
 * authoring. Only what is NEW against last week's report gets handed off,
 * knip-sweep style — except the very first run, which has no baseline to
 * diff against and hands off the whole standing report (see
 * {@link describeFirstRun}).
 *
 * Why the prod ssh happens here rather than only from the main checkout: a
 * worktree checkout (where this schedule's own session runs) has no
 * `beebox/deploy/target.env` — that file is deliberately per-real-checkout
 * (see `beebox/deploy/deploy.sh`), so `bin/schedules run` executing this
 * script from whatever checkout it was invoked in is what makes the prod leg
 * possible at all. `run` (this script) does the ssh; the *session* this
 * schedule hands off to runs in its own worktree and never touches prod
 * directly. A real run (not `--dry-run`) is expected to happen from a
 * checkout that HAS a deploy target — see {@link prodAuditGate}'s refusal when
 * it's missing outside a dry run.
 *
 * A watch that cannot watch must refuse (root CLAUDE.md / the authoring
 * skill): an ssh failure is a run failure (non-zero exit), not a skipped
 * check.
 *
 * The decision helpers ({@link prodAuditGate}, {@link describeFirstRun}) are
 * pure and exported so the test file can cover their branches without
 * spawning ssh or `bin/schedules`; everything else lives behind `main()`,
 * guarded the same way `host-audit.ts` guards its own CLI entry, so
 * importing this module for those tests doesn't run the real scan.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";

import { deployTarget } from "../../bin/deploy-target.js";

import { runStaticSweep } from "./static-sweep.js";

const SCHEDULE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCHEDULE_DIR, "..", "..");
/** The audit and its only local import — everything the prod leg needs. */
const PROD_AUDIT_FILES = ["host-audit.ts", "box-manifest.ts"] as const;
const SCHEDULES_CLI = path.join(REPO_ROOT, "bin", "schedules");
const DRY_RUN = process.env["SCHEDULE_DRY_RUN"] === "1";
const PROBE_DOCTEST = path.join(REPO_ROOT, "beebox", "test", "webapp", "cross-box-probe.doctest.md");

function refuse(message: string): never {
  process.stderr.write(`cross-box-leak-scan: ${message}\n`);
  process.exit(2);
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * What to do about the prod leg, given whether a deploy target is configured
 * and whether this is a dry run: `"run"` proceeds with the ssh; `"skip"` is
 * the ONLY case a missing target is tolerated (a worktree rehearsal);
 * `"refuse"` means a real run found itself on a checkout without a prod deploy
 * target, which is a broken watch, not a quiet no-op.
 */
export function prodAuditGate(input: { deployTargetConfigured: boolean; dryRun: boolean }): "run" | "skip" | "refuse" {
  if (input.deployTargetConfigured) return "run";
  return input.dryRun ? "skip" : "refuse";
}

/** Local leg: this checkout's own home. */
async function runLocalHostAudit(): Promise<string[]> {
  const hostAudit = path.join(SCHEDULE_DIR, "host-audit.ts");
  const result = await execa("node", ["--import", "tsx", hostAudit], { cwd: REPO_ROOT, reject: false, all: true });
  if (result.exitCode !== 0) refuse(`local host-audit exited ${String(result.exitCode)}: ${result.all ?? ""}`);
  return (result.all ?? "").split("\n").filter((line) => line !== "");
}

/**
 * Prod leg. `deploy.sh` ships only the deployed subprojects, never
 * `schedules/`, so the audit cannot be found on the server: the two audit
 * sources are copied to a throwaway directory there (with a `"type":
 * "module"` manifest, or tsx compiles them as CJS and rejects the top-level
 * await), run as the `beebox` service user from the deployed monorepo root
 * (`/opt/beebox`, whose node_modules provide tsx), and removed. Read-only on
 * the host apart from that scratch directory. Gated by {@link prodAuditGate}.
 */
async function runProdHostAudit(): Promise<string[]> {
  const target = deployTarget(REPO_ROOT);
  const gate = prodAuditGate({ deployTargetConfigured: target !== null, dryRun: DRY_RUN });
  if (gate === "skip") {
    console.log("[cross-box-leak-scan] dry run: prod audit skipped (no deploy target configured)");
    return [];
  }
  if (gate === "refuse" || target === null) {
    refuse("no deploy target configured (beebox/deploy/target.env) — this schedule must run from the real checkout that has one, not one lacking a prod deploy target");
  }
  const remoteDir = `/tmp/cross-box-leak-scan-${process.pid}`;
  const sshTarget = target.sshTarget;
  const ship = await execa(
    "rsync",
    ["-a", "-e", "ssh -o ConnectTimeout=12", ...PROD_AUDIT_FILES.map((name) => path.join(SCHEDULE_DIR, name)), `${sshTarget}:${remoteDir}/`],
    { reject: false, all: true },
  );
  if (ship.exitCode !== 0) refuse(`could not copy the host audit to prod: ${(ship.all ?? "").slice(-2000)}`);
  const remoteScript = [
    `printf '{"type":"module"}' > ${remoteDir}/package.json`,
    `chown -R ${target.serviceUser} ${remoteDir}`,
    `sudo -u ${target.serviceUser} -H bash -lc 'cd ${target.installDir} && node --import tsx ${remoteDir}/host-audit.ts'`,
    "status=$?",
    `rm -rf ${remoteDir}`,
    "exit $status",
  ].join("; ");
  const result = await execa("ssh", ["-o", "ConnectTimeout=12", sshTarget, remoteScript], { reject: false, all: true });
  if (result.exitCode !== 0) {
    refuse(`prod host-audit over ssh exited ${String(result.exitCode)}: ${(result.all ?? "").slice(-2000)}`);
  }
  return (result.all ?? "").split("\n").filter((line) => line !== "");
}

async function checkProbeDoctest(): Promise<string[]> {
  if (await fileExists(PROBE_DOCTEST)) return [];
  return ["probe  missing  beebox/test/webapp/cross-box-probe.doctest.md"];
}

/**
 * What the FIRST run (no prior baseline) should report. A diff against last
 * week is meaningless when there is no "last week" — sending only an `fyi`
 * alert either way would let real findings present at first deployment
 * become "known" (baselined) without any session ever adjudicating them. So
 * a non-empty first report is a handoff of the WHOLE standing report, not a
 * diff; only a genuinely clean first report gets the quiet `fyi`.
 */
export type FirstRunOutcome =
  | { kind: "clean"; alertTitle: string; alertMessage: string }
  | { kind: "handoff"; handoffTitle: string; handoffBody: string };

export function describeFirstRun(current: string[]): FirstRunOutcome {
  if (current.length === 0) {
    return {
      kind: "clean",
      alertTitle: "cross-box-leak-scan baseline recorded, clean",
      alertMessage:
        "First run of this schedule: no findings. The (empty) report is now the baseline, and later runs hand off "
        + "only what is new against it.",
    };
  }
  const handoffBody = [
    `First run of this schedule: ${String(current.length)} finding${current.length === 1 ? "" : "s"} in the `
      + "standing report, none yet adjudicated (there is no prior baseline, so this is the full report, not a diff):",
    "",
    "```",
    ...current,
    "```",
    "",
    "Later runs hand off only what's new against the baseline this run recorded.",
    "",
  ].join("\n");
  return { kind: "handoff", handoffTitle: `cross-box-leak-scan: initial ${String(current.length)} findings to adjudicate`, handoffBody };
}

async function main(): Promise<void> {
  const rawStateDir = process.env["SCHEDULE_STATE_DIR"];
  if (rawStateDir === undefined || rawStateDir === "") refuse("SCHEDULE_STATE_DIR is not set");
  const stateDir: string = rawStateDir;
  const baselineFile = path.join(stateDir, "last-report.txt");

  const staticLines = await runStaticSweep(REPO_ROOT);
  const localHostLines = (await runLocalHostAudit()).map((line) => `local ${line}`);
  const prodHostLines = (await runProdHostAudit()).map((line) => `prod ${line}`);
  const probeLines = await checkProbeDoctest();

  const current = [...staticLines, ...localHostLines, ...prodHostLines, ...probeLines].toSorted();

  const previous = await fs.readFile(baselineFile, "utf8").then(
    (text) => text.split("\n").filter((line) => line !== ""),
    (e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : refuse(`cannot read ${baselineFile}: ${e.message}`)),
  );

  async function recordBaseline(): Promise<void> {
    if (DRY_RUN) {
      console.log(`[cross-box-leak-scan] dry run: would record ${String(current.length)} lines as the baseline.`);
      return;
    }
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(baselineFile, current.length === 0 ? "" : `${current.join("\n")}\n`, "utf8");
  }

  function printReport(): void {
    if (current.length === 0) {
      console.log("cross-box-leak-scan: clean — no static, host, or probe findings.");
      return;
    }
    console.log(current.join("\n"));
  }

  if (previous === null) {
    await recordBaseline();
    if (DRY_RUN || current.length > 0) printReport();
    const outcome = describeFirstRun(current);
    if (outcome.kind === "clean") {
      await execa(
        SCHEDULES_CLI,
        ["alert", "--priority", "fyi", "--title", outcome.alertTitle, "--message", outcome.alertMessage],
        { stdout: "inherit", stderr: "inherit" },
      );
      process.exit(0);
    }
    if (DRY_RUN) console.log("[cross-box-leak-scan] dry run: the handoff below is printed, not recorded.");
    await execa(SCHEDULES_CLI, ["handoff", "--title", outcome.handoffTitle, "--body", "-"], {
      input: outcome.handoffBody,
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(0);
  }

  const known = new Set(previous);
  const added = current.filter((line) => !known.has(line));
  await recordBaseline();

  if (DRY_RUN || added.length > 0) printReport();

  if (added.length === 0) process.exit(0);

  const body = [
    `The cross-box leak scan found ${String(added.length)} finding${added.length === 1 ? "" : "s"} not in last week's report:`,
    "",
    "```",
    ...added,
    "```",
    "",
    "Everything else in this run's full report (above in the run log) was already there last week.",
    "",
  ].join("\n");

  if (DRY_RUN) console.log("[cross-box-leak-scan] dry run: the handoff below is printed, not recorded.");
  await execa(
    SCHEDULES_CLI,
    ["handoff", "--title", `${String(added.length)} new cross-box leak finding${added.length === 1 ? "" : "s"}`, "--body", "-"],
    { input: body, stdout: "inherit", stderr: "inherit" },
  );
}

// Only run as a script — the test file imports the pure helpers above directly.
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, "run.ts");
if (isMain) {
  await main();
}
