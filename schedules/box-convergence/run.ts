/** Hourly convergence uses the box CLI's shared admission, recovery and repair. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";
import { z } from "zod";
import { execChild } from "../../bin/lib/schedules-exec.js";
import { localTargets, optionalText } from "./targets.js";
import { framedCommand, resultDetail, shellQuote } from "./results.js";

class ConvergenceScheduleError extends Error {
  constructor(opts: { reason: "state" | "checkout" }) {
    super(opts.reason === "state" ? "Scheduled convergence requires SCHEDULE_STATE_DIR" : "Box convergence must run from the main checkout on main");
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
const env: NodeJS.ProcessEnv = { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" };
delete env.NODE_COMPILE_CACHE;
delete env.BBX_BOX_WORK; // A periodic pass is independent work, never a descendant.
const ssh = path.join(REPO_ROOT, "beebox/deploy/prod-ssh");

async function git(args: string[]): Promise<string> {
  return (await execa("git", ["-C", REPO_ROOT, ...args], { timeout: 30_000 })).stdout.trim();
}

async function inspectOrApply(root: string, where: "local" | "prod"): Promise<void> {
  if (deadline - Date.now() < SSH_TIMEOUT_MS) {
    findings.push(`${where} ${root}: unchecked; whole-run time budget exhausted`);
    return;
  }
  const args = dryRun ? ["migrate", "--status", "--json"] : ["migrate", "--sweep", "--repair", "--json"];
  // Direct entrypoints avoid the CLI launcher's rebuild and compile-cache writes
  // during dry-run. Production always uses this box's installed engine registry.
  const command = where === "local"
    ? [process.execPath, "--import", import.meta.resolve("tsx"), path.join(REPO_ROOT, "beebox/src/cli/index.ts"), ...args].map(shellQuote).join(" ")
    : ["node", path.join(root, "node_modules/beebox/dist/cli.mjs"), ...args].map(shellQuote).join(" ");
  const script = framedCommand(command);
  const remote = `set -a; source /home/beebox/.env || exit; set +a; unset BBX_BOX_WORK NODE_COMPILE_CACHE; export NODE_DISABLE_COMPILE_CACHE=1; cd ${shellQuote(root)} || exit; timeout --kill-after=5s 1500s bash -c ${shellQuote(script)}`;
  const outcome = await execChild(where === "local"
    ? { file: "bash", args: ["-c", script] }
    : { file: ssh, args: [`sudo -u beebox -H bash -lc ${shellQuote(remote)}`] }, {
    cwd: where === "local" ? root : REPO_ROOT, env,
    timeoutMs: where === "local" ? BOX_TIMEOUT_MS : SSH_TIMEOUT_MS,
    input: null, logFile: null,
  });
  const detail = outcome.timedOut ? "Timed out; migration remains incomplete" : resultDetail(outcome.output, outcome.exitCode);
  if (detail !== null) findings.push(`${where} ${root}: ${detail}`);
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
    timeout: 30_000, env,
  });
  return z.array(z.string().min(1)).parse(JSON.parse(result.stdout));
}

async function report(): Promise<void> {
  const message = findings.join("\n");
  if (dryRun || !scheduled) {
    if (message) process.stdout.write(`[box-convergence] ${dryRun ? "status only" : "report"}\n${message}\n`);
    return;
  }
  const stateDir = process.env["SCHEDULE_STATE_DIR"];
  if (!stateDir) throw new ConvergenceScheduleError({ reason: "state" });
  const baseline = path.join(stateDir, "last-report.json");
  const oldText = await optionalText(baseline);
  const old = oldText === null ? null : z.object({ message: z.string(), reportedAt: z.number() }).parse(JSON.parse(oldText));
  if (message && (old?.message !== message || Date.now() - old.reportedAt >= 24 * 60 * 60_000)) {
    await execa(path.join(REPO_ROOT, "bin/schedules"), ["alert", "--priority", "important",
      "--title", "Box convergence needs attention", "--message", message], { stdout: "inherit", stderr: "inherit" });
    await fs.writeFile(baseline, JSON.stringify({ message, reportedAt: Date.now() }));
  } else if (!message && old?.message) {
    await fs.writeFile(baseline, JSON.stringify({ message: "", reportedAt: Date.now() }));
  }
}

async function main(): Promise<void> {
  const mainRoot = path.dirname(await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  if (await fs.realpath(mainRoot) !== await fs.realpath(REPO_ROOT) || await git(["branch", "--show-current"]) !== "main") {
    if (!dryRun) throw new ConvergenceScheduleError({ reason: "checkout" });
    process.stdout.write("[box-convergence] status only: a real run would refuse this worktree; no boxes contacted\n");
    return;
  }
  try {
    const inventory = await git(["worktree", "list", "--porcelain", "-z"]);
    const worktrees = inventory.split("\0").filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9));
    const targets = await localTargets({ mainRoot, worktrees, home: os.homedir(),
      clonesRoot: path.join(os.homedir(), "src/box-worktrees"),
      configDir: path.join(process.env.BBX_STATE_DIR ?? path.join(os.homedir(), ".cache/beebox"), "hub-configs") });
    for (const detail of targets.unreadable) findings.push(`Local box unreadable: ${detail}`);
    for (const root of targets.excluded) findings.push(`local ${root}: excluded; owned by a worktree`);
    for (const root of targets.eligible) {
      try { await inspectOrApply(root, "local"); }
      catch (error) { findings.push(`local ${root}: ${String(error)}`); }
    }
  } catch (error) { findings.push(`Local coverage unavailable: ${String(error)}`); }
  try {
    for (const root of await prodTargets()) {
      try { await inspectOrApply(root, "prod"); }
      catch (error) { findings.push(`prod ${root}: ${String(error)}`); }
    }
  } catch (error) { findings.push(`Production coverage unavailable: ${String(error)}`); }
  await report();
}
await main();
