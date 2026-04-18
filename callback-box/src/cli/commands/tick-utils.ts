/**
 * Shared utilities for scheduled script execution.
 * Used by both `cb tick` and `cb wakeup`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { parseXml } from "cardworks";
import {
  parseScheduledScript,
  isDueForWakeup,
  isWithinBudget,
  checkMissingConnectors,
  type ScheduledScript,
  type ParsedScheduledScript,
} from "../../schemas/scheduled-script.js";
import {
  loadScriptState,
  saveScriptState,
  recordRun,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
} from "../../core/schedule-state.js";
import { parseCardName } from "../lib/paths.js";
import { getDefaultTemplate } from "../../schemas/templates.js";
import { buildScriptEnv } from "../../core/script-env.js";

const SCRIPT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RUN_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h default pruning window
const SLEEP_THRESHOLD_MS = 5_000; // wall vs monotonic drift > 5s = sleep

/**
 * Run a command with a reliable timeout. Uses spawn with a process group
 * so we can kill the entire tree on timeout (execSync timeout doesn't
 * reliably kill grandchild processes).
 *
 * Captures stderr (last 500 chars) to include in error messages.
 * When verbose, stdout/stderr also go to the parent process.
 */
export function execWithTimeout(
  command: string,
  options: { cwd: string; stdio: "inherit" | "ignore"; timeout: number; env: NodeJS.ProcessEnv }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env,
      detached: true,
    });

    let stderrBuf = "";
    const MAX_STDERR = 500;

    if (child.stdout) {
      if (options.stdio === "inherit") {
        child.stdout.pipe(process.stdout);
      } else {
        child.stdout.resume();
      }
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrBuf += text;
        if (stderrBuf.length > MAX_STDERR * 2) {
          stderrBuf = stderrBuf.slice(-MAX_STDERR);
        }
        if (options.stdio === "inherit") {
          process.stderr.write(chunk);
        }
      });
    }

    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already dead */ }
      reject(new Error(`Command timed out after ${options.timeout}ms`));
    }, options.timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const detail = stderrBuf.trim().slice(-MAX_STDERR);
        const msg = detail
          ? `Command failed with exit code ${code}: ${detail}`
          : `Command failed with exit code ${code}`;
        reject(new Error(msg));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Run all on-wakeup scheduled scripts that are due.
 * Returns the number of scripts that ran.
 */
export async function runOnWakeupScripts(boxRoot: string, now: Date): Promise<number> {
  const schedulesDir = path.join(boxRoot, "config/schedules");

  let files: string[];
  try {
    files = (await fs.readdir(schedulesDir)).filter((f) =>
      f.endsWith(".scheduled-script.card")
    );
  } catch {
    return 0;
  }

  let ranCount = 0;
  const running = await loadRunningScripts(boxRoot);

  for (const file of files) {
    const scriptName = file.replace(".scheduled-script.card", "");
    const cardPath = path.join(schedulesDir, file);

    let parsed;
    try {
      const content = await fs.readFile(cardPath, "utf-8");
      const root = await parseXml(content, file);
      parsed = parseScheduledScript(root as ScheduledScript);
    } catch (err) {
      console.error(`  Error parsing ${file}: ${(err as Error).message}`);
      continue;
    }

    const state = await loadScriptState(boxRoot, scriptName);
    if (!isDueForWakeup(parsed, { lastRun: state.lastRun, now })) {
      continue;
    }

    // Requirements check
    if (parsed.requires) {
      const missing = checkMissingConnectors(boxRoot, parsed.requires);
      if (missing.length > 0) {
        console.log(`  Skipping ${scriptName}: missing connectors: ${missing.join(", ")}`);
        continue;
      }
    }

    // Budget check
    if (parsed.budget) {
      const check = isWithinBudget(parsed.budget, { recentRuns: state.recentRuns, now });
      if (!check.allowed) {
        console.log(`  Skipping ${scriptName}: budget exceeded (${Math.round(check.usedMs / 1000)}s used)`);
        continue;
      }
    }

    // Lock-group check: skip if another script in the same group is already running
    if (parsed.lockGroup) {
      const conflict = [...running.entries()].find(
        ([name, lock]) => lock.lockGroup === parsed.lockGroup && name !== scriptName
      );
      if (conflict) {
        console.log(`  Skipping ${scriptName}: lock-group "${parsed.lockGroup}" held by ${conflict[0]}`);
        continue;
      }
    }

    console.log(`  Running ${scriptName}...`);
    await acquireScriptLock({ boxRoot, scriptName, triggeredBy: "wakeup", ...(parsed.lockGroup ? { lockGroup: parsed.lockGroup } : {}) });
    const wallStart = Date.now();
    const monoStart = performance.now();
    try {
      const scriptEnv = await buildScriptEnv(boxRoot, {
        CB_TRIGGERED_BY: "wakeup",
      });
      await execWithTimeout(parsed.runs, {
        cwd: boxRoot,
        stdio: "inherit",
        timeout: SCRIPT_TIMEOUT,
        env: scriptEnv,
      });

      const wallElapsed = Date.now() - wallStart;
      const monoElapsed = performance.now() - monoStart;
      const sleepAffected = Math.abs(wallElapsed - monoElapsed) > SLEEP_THRESHOLD_MS;
      const durationMs = sleepAffected ? Math.round(monoElapsed) : wallElapsed;

      state.lastRun = now.toISOString();
      state.lastResult = "success";
      state.lastError = null;
      state.runCount++;
      const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
      recordRun(state, { record: { ts: now.toISOString(), durationMs, ...(sleepAffected ? { sleepAffected: true } : {}) }, windowMs, now });
      await saveScriptState({ boxRoot, scriptName, state });
      ranCount++;

      await handleCreateAfterSuccess({ boxRoot, parsed, scriptName });
    } catch (err) {
      const wallElapsed = Date.now() - wallStart;
      const monoElapsed = performance.now() - monoStart;
      const sleepAffected = Math.abs(wallElapsed - monoElapsed) > SLEEP_THRESHOLD_MS;
      const durationMs = sleepAffected ? Math.round(monoElapsed) : wallElapsed;

      state.lastRun = now.toISOString();
      state.lastResult = "failure";
      state.lastError = (err as Error).message;
      state.runCount++;
      const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
      recordRun(state, { record: { ts: now.toISOString(), durationMs, ...(sleepAffected ? { sleepAffected: true } : {}) }, windowMs, now });
      await saveScriptState({ boxRoot, scriptName, state });
      console.error(`  Failed: ${(err as Error).message}`);
    } finally {
      await releaseScriptLock({ boxRoot, scriptName });
    }
  }

  return ranCount;
}

/**
 * After a script succeeds, create any chained cards declared via <create-after-success>.
 * Skips if the target file already exists (idempotent).
 */
export async function handleCreateAfterSuccess(
  { boxRoot, parsed, scriptName }: { boxRoot: string; parsed: ParsedScheduledScript; scriptName: string },
): Promise<void> {
  for (const chain of parsed.createAfterSuccess) {
    const fullPath = path.join(boxRoot, chain.path);

    // Skip if already exists (idempotent)
    try {
      await fs.access(fullPath);
      console.log(`  Chain: ${chain.path} already exists, skipping`);
      continue;
    } catch {
      // doesn't exist, proceed
    }

    const basename = path.basename(chain.path);
    const cardName = parseCardName(basename);
    if (!cardName) {
      console.error(`  Chain: cannot parse card name from ${chain.path}`);
      continue;
    }

    const template = getDefaultTemplate(cardName.type);
    if (!template) {
      console.error(`  Chain: no default template for type "${cardName.type}"`);
      continue;
    }

    const parseResult = template.argsSchema.safeParse(chain.args);
    if (!parseResult.success) {
      console.error(`  Chain: invalid args for ${chain.path}: ${parseResult.error.message}`);
      continue;
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, template.generate(parseResult.data));
    console.log(`  Chain: created ${chain.path} (from ${scriptName})`);
  }
}
