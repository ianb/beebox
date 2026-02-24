/**
 * cb tick - Evaluate and run due scheduled scripts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { getBoxTime } from "../lib/time.js";
import { parseXml } from "cardworks";
import {
  parseScheduledScript,
  isDue,
  type ScheduledScript,
} from "../../schemas/scheduled-script.js";
import {
  loadScriptState,
  saveScriptState,
} from "../../core/schedule-state.js";
import { handleCreateAfterSuccess } from "./tick-utils.js";

const SCRIPT_TIMEOUT = 10 * 60 * 1000; // 10 minutes

/**
 * Run a command with a reliable timeout. Uses spawn with a process group
 * so we can kill the entire tree on timeout (execSync timeout doesn't
 * reliably kill grandchild processes).
 */
function execWithTimeout(
  command: string,
  options: { cwd: string; stdio: "inherit" | "ignore"; timeout: number; env: NodeJS.ProcessEnv }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      cwd: options.cwd,
      stdio: options.stdio,
      env: options.env,
      detached: true, // create process group so we can kill the tree
    });

    const timer = setTimeout(() => {
      // Kill entire process group (negative pid)
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already dead */ }
      reject(new Error(`Command timed out after ${options.timeout}ms`));
    }, options.timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

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

    if (options.dryRun) {
      if (!options.quiet) console.log(`Would run: ${scriptName} → ${parsed.runs}`);
      ranCount++;
      scripts.push({ name: scriptName, status: "ran", command: parsed.runs });
      continue;
    }

    if (!options.quiet) console.log(`Running ${scriptName}...`);
    const startTime = Date.now();
    try {
      await execWithTimeout(parsed.runs, {
        cwd: boxRoot,
        stdio: options.quiet ? "ignore" : "inherit",
        timeout: SCRIPT_TIMEOUT,
        env: { ...process.env, CB_TRIGGERED_BY: "schedule" },
      });

      const durationMs = Date.now() - startTime;
      state.lastRun = now.toISOString();
      state.lastResult = "success";
      state.lastError = null;
      state.runCount++;
      await saveScriptState({ boxRoot, scriptName, state });
      ranCount++;

      scripts.push({ name: scriptName, status: "ran", command: parsed.runs, durationMs });

      await handleCreateAfterSuccess({ boxRoot, parsed, scriptName });

      // Handle once: delete the card after success
      if (parsed.once) {
        await fs.unlink(cardPath);
        if (!options.quiet) console.log(`  Deleted one-shot script: ${file}`);
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      state.lastRun = now.toISOString();
      state.lastResult = "failure";
      state.lastError = (err as Error).message;
      state.runCount++;
      await saveScriptState({ boxRoot, scriptName, state });
      if (!options.quiet) console.error(`  Failed: ${(err as Error).message}`);
      errorCount++;
      scripts.push({ name: scriptName, status: "error", command: parsed.runs, durationMs, error: (err as Error).message });
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
