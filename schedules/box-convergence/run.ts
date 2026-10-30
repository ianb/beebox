/** Hourly convergence uses the box CLI's shared admission, recovery and repair. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";
import { z } from "zod";
import { execChild } from "../../bin/lib/schedules-exec.js";
import { localTargets, optionalText } from "./targets.js";
import { checkFailure, connectorWarnings, framedCommand, prodBoxCommand, reportPlan, resultDetail, shellQuote, sshUnreachable, unreachableDetail } from "./results.js";

class ConvergenceScheduleError extends Error {
  constructor() {
    super("Box convergence must run from the main checkout on main");
    this.name = "ConvergenceScheduleError";
  }
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
const scheduled = Boolean(process.env["SCHEDULE_RUN_ID"]);
const BOX_TIMEOUT_MS = 25 * 60_000; // ten-minute drain plus fifteen-minute execution
const SSH_TIMEOUT_MS = 26 * 60_000;
const deadline = Date.now() + 4 * 60 * 60_000 - 30_000;
const findings: string[] = [];
/** Checks that could not run, as distinct from boxes that answered unconverged. */
const checkFailures: string[] = [];
/** Whether every box's convergence check ran. */
let convergenceCoverage = true;
/** Quiet or failing connectors on production boxes, one line each. */
const connectorFindings: string[] = [];
const HEALTH_TIMEOUT_MS = 2 * 60_000;
const env: NodeJS.ProcessEnv = { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" };
delete env.NODE_COMPILE_CACHE;
delete env.BBX_BOX_WORK; // A periodic pass is independent work, never a descendant.
const ssh = path.join(REPO_ROOT, "beebox/deploy/prod-ssh");

function convergenceCheckFailed(line: string): void {
  checkFailures.push(line);
  convergenceCoverage = false;
}

async function git(args: string[]): Promise<string> {
  return (await execa("git", ["-C", REPO_ROOT, ...args], { timeout: 30_000 })).stdout.trim();
}

/** Returns the ssh diagnostic when production could not be reached, else null. */
async function inspectOrApply(root: string, where: "local" | "prod"): Promise<string | null> {
  if (deadline - Date.now() < SSH_TIMEOUT_MS) {
    convergenceCheckFailed(`${where} ${root}: unchecked; whole-run time budget exhausted`);
    return null;
  }
  // `migrate` lives under `bbx engine` (beebox/src/cli/entry/surface-data.ts): it acts
  // on a box's installation, not its content, so it is not the agent's verb.
  const args = dryRun
    ? ["engine", "migrate", "--status", "--json"]
    : ["engine", "migrate", "--sweep", "--repair", "--yield", "--json"];
  // Direct entrypoint avoids the CLI launcher's rebuild and compile-cache writes
  // during dry-run.
  const local = [process.execPath, "--import", import.meta.resolve("tsx"), path.join(REPO_ROOT, "beebox/src/cli/entry/run.ts"), ...args].map(shellQuote).join(" ");
  const outcome = await execChild(where === "local"
    ? { file: "bash", args: ["-c", framedCommand(local)] }
    : { file: ssh, args: [prodBoxCommand(root, { cliArgs: args, timeoutSeconds: 1500 })] }, {
    cwd: where === "local" ? root : REPO_ROOT, env,
    timeoutMs: where === "local" ? BOX_TIMEOUT_MS : SSH_TIMEOUT_MS,
    input: null, logFile: null,
  });
  const unreachable = where === "prod" ? sshUnreachable(outcome.exitCode, outcome.output) : null;
  if (unreachable !== null) return unreachable;
  if (outcome.timedOut) {
    findings.push(`${where} ${root}: Timed out; migration remains incomplete`);
    return null;
  }
  const failure = checkFailure(outcome.output, outcome.exitCode);
  if (failure !== null) {
    convergenceCheckFailed(`${where} ${root}: ${failure}`);
    return null;
  }
  const detail = resultDetail(outcome.output, outcome.exitCode);
  if (detail !== null) findings.push(`${where} ${root}: ${detail}`);
  return null;
}

class ProdRegistryReadError extends Error {
  constructor(readonly exitCode: number | null, readonly stderr: string) {
    super("Production registry read failed");
    this.name = "ProdRegistryReadError";
  }
  override toString(): string {
    return `${this.name}: ${this.message} (exit ${String(this.exitCode)}): ${this.stderr.slice(-1500)}`;
  }
}

class ProdUnreachableError extends Error {
  constructor(readonly line: string) {
    super("Production server unreachable");
    this.name = "ProdUnreachableError";
  }
}

async function prodTargets(): Promise<string[]> {
  const script = `const fs = require('node:fs'); const path = require('node:path');
const file = '/home/beebox/.config/beebox/hub.json';
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!config.boxes || Array.isArray(config.boxes) || typeof config.boxes !== 'object') throw Error('Invalid hub registry');
const roots = Object.values(config.boxes).map(entry => {
  if (typeof entry.path !== 'string' || !entry.path) throw Error('Invalid hub box path');
  return fs.realpathSync(path.resolve(path.dirname(file), entry.path));
});
process.stdout.write(JSON.stringify([...new Set(roots)]));`;
  const result = await execa(ssh, [`sudo -u beebox -H node -e ${shellQuote(script)}`], {
    timeout: 30_000, env, reject: false,
  });
  const unreachable = sshUnreachable(result.exitCode ?? null, result.stderr);
  if (unreachable !== null) throw new ProdUnreachableError(unreachable);
  if (result.failed) throw new ProdRegistryReadError(result.exitCode ?? null, result.stderr);
  return z.array(z.string().min(1)).parse(JSON.parse(result.stdout));
}

/**
 * Read one production box's connector warnings from `bbx health --json` into
 * `connectorFindings`. Returns whether the read produced health JSON: a box
 * that could not be read keeps the condition open rather than resolving it.
 */
async function readConnectorHealth(root: string): Promise<boolean> {
  // The convergence pass already reports an exhausted budget; unread health just keeps the condition.
  if (deadline - Date.now() < HEALTH_TIMEOUT_MS) return false;
  const outcome = await execChild({ file: ssh, args: [prodBoxCommand(root, { cliArgs: ["health", "--json", "--box", root], timeoutSeconds: 100 })] }, {
    cwd: REPO_ROOT, env, timeoutMs: HEALTH_TIMEOUT_MS, input: null, logFile: null,
  });
  const warnings = connectorWarnings(outcome.output);
  if (warnings === null) {
    checkFailures.push(`prod ${root}: health unreadable (exit ${String(outcome.exitCode)}${outcome.timedOut ? ", timed out" : ""}): ${outcome.output.slice(-300)}`);
    return false;
  }
  connectorFindings.push(...warnings.map((warning) => `${root}: ${warning}`));
  return true;
}

/** Offline is routine on a laptop: note it, and report it only once it has
 *  lasted a day. Returns that report, or null. */
async function trackReachability(unreachable: string | null): Promise<string | null> {
  const stateDir = process.env["SCHEDULE_STATE_DIR"];
  if (dryRun || !scheduled || !stateDir) {
    if (unreachable !== null) process.stdout.write(`[box-convergence] production unreachable; skipped: ${unreachable}\n`);
    return null;
  }
  const file = path.join(stateDir, "prod-unreachable.json");
  if (unreachable === null) {
    await fs.rm(file, { force: true });
    return null;
  }
  const text = await optionalText(file);
  const since = text === null ? Date.now() : z.object({ since: z.number() }).parse(JSON.parse(text)).since;
  if (text === null) await fs.writeFile(file, JSON.stringify({ since }));
  process.stdout.write(`[box-convergence] production unreachable since ${new Date(since).toISOString()}: ${unreachable}\n`);
  return unreachableDetail(since, { now: Date.now(), line: unreachable });
}

/** Findings always reach the run log — the 2026-09-16 incident's second run
 *  was deduped into an empty log while every box was unusable. The alerts are
 *  standing conditions the store updates in place, so no repeat state lives
 *  here. */
async function report(input: {
  unreachableDetail: string | null;
  connectorCoverage: boolean;
}): Promise<void> {
  const plan = reportPlan({ findings, checkFailures, convergenceCoverage, connectorFindings, ...input });
  const logged = plan.alerts.map((alert) => alert.message).join("\n");
  if (logged) process.stdout.write(`[box-convergence] ${dryRun ? "status only" : "report"}\n${logged}\n`);
  if (dryRun || !scheduled) return;
  const cli = path.join(REPO_ROOT, "bin/schedules");
  for (const alert of plan.alerts) {
    await execa(cli, ["alert", "--priority", "normal", "--condition", alert.condition,
      "--title", alert.title, "--message", alert.message], { stdout: "inherit", stderr: "inherit" });
  }
  await execa(cli, ["resolve", ...plan.keep.flatMap((condition) => ["--except", condition])], { stdout: "inherit", stderr: "inherit" });
}

async function main(): Promise<void> {
  const mainRoot = path.dirname(await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  if (await fs.realpath(mainRoot) !== await fs.realpath(REPO_ROOT) || await git(["branch", "--show-current"]) !== "main") {
    if (!dryRun) throw new ConvergenceScheduleError();
    process.stdout.write("[box-convergence] status only: a real run would refuse this worktree; no boxes contacted\n");
    return;
  }
  try {
    const inventory = await git(["worktree", "list", "--porcelain", "-z"]);
    const worktrees = inventory.split("\0").filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9));
    const targets = await localTargets({ mainRoot, worktrees, home: os.homedir(),
      clonesRoot: path.join(os.homedir(), "src/box-worktrees"),
      configDir: path.join(process.env.BBX_STATE_DIR ?? path.join(os.homedir(), ".cache/beebox"), "hub-configs") });
    for (const detail of targets.unreadable) convergenceCheckFailed(`Local box unreadable: ${detail}`);
    for (const root of targets.excluded) findings.push(`local ${root}: excluded; owned by a worktree`);
    for (const root of targets.eligible) {
      try { await inspectOrApply(root, "local"); }
      catch (error) { convergenceCheckFailed(`local ${root}: ${String(error)}`); }
    }
  } catch (error) { convergenceCheckFailed(`Local coverage unavailable: ${String(error)}`); }
  let unreachable: string | null = null;
  // Complete only when the inventory and every box's health read succeeded.
  let connectorCoverage = false;
  try {
    connectorCoverage = true;
    for (const root of await prodTargets()) {
      try { unreachable = await inspectOrApply(root, "prod"); }
      catch (error) { convergenceCheckFailed(`prod ${root}: ${String(error)}`); }
      if (unreachable !== null) break;
      try { if (!await readConnectorHealth(root)) connectorCoverage = false; }
      catch (error) {
        connectorCoverage = false;
        checkFailures.push(`prod ${root}: health unreadable: ${String(error)}`);
      }
    }
  } catch (error) {
    connectorCoverage = false;
    if (error instanceof ProdUnreachableError) unreachable = error.line;
    else convergenceCheckFailed(`Production coverage unavailable: ${String(error)}`);
  }
  if (unreachable !== null) {
    connectorCoverage = false;
    convergenceCoverage = false;
  }
  await report({ unreachableDetail: await trackReachability(unreachable), connectorCoverage });
}
await main();
