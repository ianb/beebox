/**
 * cb tick - Evaluate and run due scheduled scripts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { getBoxTime } from "../lib/time.js";
import { parseXml } from "cardworks";
import {
  parseScheduledScript,
  isDue,
  isWithinBudget,
  type ScheduledScript,
} from "../../schemas/scheduled-script.js";
import { checkMissingConnectors } from "../../connectors/requirements.js";
import {
  loadScriptState,
  saveScriptState,
  recordRun,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
} from "../../core/schedule-state.js";
import { execWithTimeout, handleCreateAfterSuccess } from "./tick-utils.js";
import { stageAll, commit, getStatus } from "../lib/git.js";
import { buildScriptEnv } from "../../core/script-env.js";

const SCRIPT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RUN_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h default pruning window
const SLEEP_THRESHOLD_MS = 5_000; // wall vs monotonic drift > 5s = sleep

export interface TickOptions {
  dryRun?: boolean;
  script?: string;
  /** When true, capture subprocess output instead of inheriting stdio */
  quiet?: boolean;
}

export interface ScriptResult {
  name: string;
  status: "ran" | "skipped" | "error";
  command?: string;
  durationMs?: number;
  error?: string;
}

export interface TickResult {
  ranCount: number;
  skipCount: number;
  errorCount: number;
  scripts: ScriptResult[];
}

export async function runTick(boxRoot: string, options: TickOptions): Promise<TickResult> {
  const schedulesDir = path.join(boxRoot, "config/schedules");
  const now = getBoxTime(boxRoot);

  let files: string[];
  try {
    files = (await fs.readdir(schedulesDir)).filter((f) =>
      f.endsWith(".scheduled-script.card")
    );
  } catch {
    if (!options.quiet) console.log("No schedules directory found.");
    return { ranCount: 0, skipCount: 0, errorCount: 0, scripts: [] };
  }

  if (options.script) {
    files = files.filter(
      (f) => f.replace(".scheduled-script.card", "") === options.script
    );
    if (files.length === 0) {
      console.error(`Script not found: ${options.script}`);
      process.exit(1);
    }
  }

  let ranCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const scripts: ScriptResult[] = [];

  // Load currently running scripts for lock-group conflict detection
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
      if (!options.quiet) console.error(`  Error parsing ${file}: ${(err as Error).message}`);
      errorCount++;
      scripts.push({ name: scriptName, status: "error", error: `parse: ${(err as Error).message}` });
      continue;
    }

    const state = await loadScriptState(boxRoot, scriptName);
    const due = isDue(parsed, { lastRun: state.lastRun, now });

    if (!due) {
      skipCount++;
      scripts.push({ name: scriptName, status: "skipped" });
      continue;
    }

    // Requirements check: skip if required connectors are missing
    if (parsed.requires) {
      const missing = await checkMissingConnectors(boxRoot, parsed.requires);
      if (missing.length > 0) {
        if (!options.quiet) console.log(`  Skipping ${scriptName}: missing connectors: ${missing.join(", ")}`);
        skipCount++;
        scripts.push({ name: scriptName, status: "skipped" });
        continue;
      }
    }

    // Budget check: skip if cumulative runtime within window is exceeded
    if (parsed.budget) {
      const check = isWithinBudget(parsed.budget, { recentRuns: state.recentRuns, now });
      if (!check.allowed) {
        if (!options.quiet) console.log(`  Skipping ${scriptName}: budget exceeded (${Math.round(check.usedMs / 1000)}s used)`);
        skipCount++;
        scripts.push({ name: scriptName, status: "skipped" });
        continue;
      }
    }

    // Lock-group check: skip if another script in the same group is already running
    if (parsed.lockGroup) {
      const conflict = [...running.entries()].find(
        ([name, lock]) => lock.lockGroup === parsed.lockGroup && name !== scriptName
      );
      if (conflict) {
        if (!options.quiet) console.log(`  Skipping ${scriptName}: lock-group "${parsed.lockGroup}" held by ${conflict[0]}`);
        skipCount++;
        scripts.push({ name: scriptName, status: "skipped" });
        continue;
      }
    }

    if (options.dryRun) {
      if (!options.quiet) console.log(`Would run: ${scriptName} → ${parsed.runs}`);
      ranCount++;
      scripts.push({ name: scriptName, status: "ran", command: parsed.runs });
      continue;
    }

    if (!options.quiet) console.log(`Running ${scriptName}...`);
    // Snapshot mtime before execution so we can detect if the script recreated itself
    let preRunMtimeMs = 0;
    try {
      const stat = await fs.stat(cardPath);
      preRunMtimeMs = stat.mtimeMs;
    } catch {
      // file may have been deleted between readdir and here
    }
    await acquireScriptLock({ boxRoot, scriptName, triggeredBy: "schedule", ...(parsed.lockGroup ? { lockGroup: parsed.lockGroup } : {}) });
    const wallStart = Date.now();
    const monoStart = performance.now();
    try {
      const scriptEnv = await buildScriptEnv(boxRoot, {
        CB_TRIGGERED_BY: "schedule",
      });
      await execWithTimeout(parsed.runs, {
        cwd: boxRoot,
        stdio: options.quiet ? "ignore" : "inherit",
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
      state.lastDurationMs = durationMs;
      state.runCount++;
      const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
      recordRun(state, { record: { ts: now.toISOString(), durationMs, ...(sleepAffected ? { sleepAffected: true } : {}) }, windowMs, now });
      await saveScriptState({ boxRoot, scriptName, state });
      ranCount++;

      scripts.push({ name: scriptName, status: "ran", command: parsed.runs, durationMs });

      await handleCreateAfterSuccess({ boxRoot, parsed, scriptName });

      // Handle once: delete the card after success — but only if the script
      // didn't recreate the file during execution (e.g. archive re-triggering)
      if (parsed.once) {
        let shouldDelete = true;
        try {
          const postStat = await fs.stat(cardPath);
          if (postStat.mtimeMs > preRunMtimeMs) {
            // File was recreated/modified during execution — leave it for next tick
            shouldDelete = false;
            if (!options.quiet) console.log(`  One-shot script recreated during execution, keeping: ${file}`);
          }
        } catch {
          // File already gone — nothing to delete
          shouldDelete = false;
        }
        if (shouldDelete) {
          await fs.unlink(cardPath);
          if (!options.quiet) console.log(`  Deleted one-shot script: ${file}`);
        }
      }

      // Commit housekeeping changes (once deletion, createAfterSuccess files)
      const postStatus = await getStatus(boxRoot);
      if (!postStatus.clean) {
        await stageAll(boxRoot);
        const parts: string[] = [];
        if (parsed.once) parts.push(`remove one-shot ${scriptName}`);
        if (parsed.createAfterSuccess.length > 0) parts.push(`chain ${parsed.createAfterSuccess.map((c) => path.basename(c.path)).join(", ")}`);
        await commit(boxRoot, {
          message: `Tick: ${parts.join(", ") || "housekeeping"}`,
          trailers: { "Triggered-By": "cb tick" },
        });
      }
    } catch (err) {
      const wallElapsed = Date.now() - wallStart;
      const monoElapsed = performance.now() - monoStart;
      const sleepAffected = Math.abs(wallElapsed - monoElapsed) > SLEEP_THRESHOLD_MS;
      const durationMs = sleepAffected ? Math.round(monoElapsed) : wallElapsed;

      state.lastRun = now.toISOString();
      state.lastResult = "failure";
      state.lastError = (err as Error).message;
      state.lastDurationMs = durationMs;
      state.runCount++;
      const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
      recordRun(state, { record: { ts: now.toISOString(), durationMs, ...(sleepAffected ? { sleepAffected: true } : {}) }, windowMs, now });
      await saveScriptState({ boxRoot, scriptName, state });
      if (!options.quiet) console.error(`  Failed: ${(err as Error).message}`);
      errorCount++;
      scripts.push({ name: scriptName, status: "error", command: parsed.runs, durationMs, error: (err as Error).message });
    } finally {
      await releaseScriptLock({ boxRoot, scriptName });
    }
  }

  if (!options.quiet) {
    if (options.dryRun) {
      console.log(`\n${ranCount} script(s) would run, ${skipCount} not due.`);
    } else {
      console.log(
        `\nTick complete: ${ranCount} ran, ${skipCount} skipped, ${errorCount} errors.`
      );
    }
  }

  return { ranCount, skipCount, errorCount, scripts };
}

export const tickCommand = new Command("tick")
  .description("Evaluate and run due scheduled scripts")
  .option("--dry-run", "Show what would run without executing")
  .option("--script <name>", "Only evaluate a specific script (by filename stem)")
  .option("--box <path>", "Box root path (defaults to current directory)")
  .action(async (options: TickOptions & { box?: string }) => {
    const boxRoot = options.box ?? await requireBoxRoot();
    await runTick(boxRoot, options);
  });
