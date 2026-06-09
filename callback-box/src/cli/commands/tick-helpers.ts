/**
 * Internal helpers for `cb tick` (see tick.ts). Extracted to keep tick.ts
 * within the per-function and per-file size limits; not shared with wakeup.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  isDue,
  isWithinBudget,
} from "../../schemas/scheduled-script.js";
import type { ParsedScheduledScript } from "../../schemas/scheduled-script.js";
import { checkMissingConnectors } from "../../connectors/requirements.js";
import {
  saveScriptState,
  recordRun,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningProcedures,
  loadActiveChats,
  DEFAULT_RUN_WINDOW_MS,
} from "../../core/schedule-state.js";
import type {
  loadScriptState,
  loadRunningScripts,
} from "../../core/schedule-state.js";
import { execWithTimeout, SCRIPT_TIMEOUT } from "../../lib/exec-with-timeout.js";
import { fallbackTiming, handleCreateAfterSuccess } from "./tick-utils.js";
import { stageAll, commit, getStatus } from "../lib/git.js";
import { buildScriptEnv } from "../../core/script-env.js";
import type { TickOptions, ScriptResult } from "./tick.js";

type RunningScripts = Awaited<ReturnType<typeof loadRunningScripts>>;
type ScriptState = Awaited<ReturnType<typeof loadScriptState>>;
type ParsedScript = ParsedScheduledScript;

/** Read the schedules directory and filter to scheduled-script cards. Returns
 * null when the directory is missing/unreadable (treated as "no schedules"). */
export async function readScheduleFiles(
  schedulesDir: string,
  options: TickOptions
): Promise<string[] | null> {
  try {
    return (await fs.readdir(schedulesDir)).filter((f) =>
      f.endsWith(".scheduled-script.card")
    );
  } catch (e) {
    if (!options.quiet && (e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`No schedules directory found (or unreadable): ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}

/** Detect other in-flight work (scripts, procedures, chats). Tick's
 * housekeeping commit sweeps the whole tree, so the system must be at rest. */
export async function findBusyBlockers(
  boxRoot: string,
  running: RunningScripts
): Promise<string[]> {
  const runningProcedures = await loadRunningProcedures(boxRoot);
  const activeChats = await loadActiveChats(boxRoot);
  if (running.size === 0 && runningProcedures.length === 0 && activeChats.size === 0) {
    return [];
  }
  return [
    ...[...running.keys()].map((s) => `script:${s}`),
    ...runningProcedures.map((p) => `procedure:${p}`),
    ...[...activeChats.values()].map(
      (c) => `chat:${c.sessionId ?? "(unassigned)"}`
    ),
  ];
}

interface SkipContext {
  boxRoot: string;
  parsed: ParsedScript;
  scriptName: string;
  state: ScriptState;
  now: Date;
  running: RunningScripts;
  options: TickOptions;
}

/** Evaluate the pre-run skip gates (due, requires, budget, lock-group).
 * Returns a human-readable reason to skip, or null if the script should run.
 * An empty-string reason means "skip silently". */
export async function evaluateSkip(ctx: SkipContext): Promise<string | null> {
  const { boxRoot, parsed, scriptName, state, now, running, options } = ctx;

  if (!isDue(parsed, { lastRun: state.lastRun, now })) {
    return "";
  }

  if (parsed.requires) {
    const missing = await checkMissingConnectors(boxRoot, parsed.requires);
    if (missing.length > 0) {
      return options.quiet ? "" : `  Skipping ${scriptName}: missing connectors: ${missing.join(", ")}`;
    }
  }

  if (parsed.budget) {
    const check = isWithinBudget(parsed.budget, { recentRuns: state.recentRuns, now });
    if (!check.allowed) {
      return options.quiet ? "" : `  Skipping ${scriptName}: budget exceeded (${Math.round(check.usedMs / 1000)}s used)`;
    }
  }

  if (parsed.lockGroup) {
    const conflict = [...running.entries()].find(
      ([name, lock]) => lock.lockGroup === parsed.lockGroup && name !== scriptName
    );
    if (conflict) {
      return options.quiet ? "" : `  Skipping ${scriptName}: lock-group "${parsed.lockGroup}" held by ${conflict[0]}`;
    }
  }

  return null;
}

interface RecordOutcomeArgs {
  state: ScriptState;
  result: "success" | "failure";
  error: string | null;
  durationMs: number;
  sleepAffected: boolean;
  windowMs: number;
  now: Date;
}

/** Mutate script state to reflect a completed run and append it to the
 * windowed run history. */
function recordOutcome(args: RecordOutcomeArgs): void {
  const { state, result, error, durationMs, sleepAffected, windowMs, now } = args;
  state.lastRun = now.toISOString();
  state.lastResult = result;
  state.lastError = error;
  state.lastDurationMs = durationMs;
  state.runCount++;
  recordRun(state, {
    record: { ts: now.toISOString(), durationMs, ...(sleepAffected ? { sleepAffected: true } : {}) },
    windowMs,
    now,
  });
}

interface PostSuccessArgs {
  boxRoot: string;
  parsed: ParsedScript;
  scriptName: string;
  cardPath: string;
  file: string;
  preRunMtimeMs: number;
  options: TickOptions;
}

/** Handle post-success housekeeping: chain creation, one-shot deletion, and
 * committing the resulting working-tree changes. */
async function handlePostSuccess(args: PostSuccessArgs): Promise<void> {
  const { boxRoot, parsed, scriptName, cardPath, file, preRunMtimeMs, options } = args;

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
    } catch (_e) {
      // File already gone — nothing to delete; the stat failure carries
      // no actionable info since the desired end state (no file) holds.
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
}

interface ExecuteScriptArgs {
  boxRoot: string;
  parsed: ParsedScript;
  scriptName: string;
  cardPath: string;
  file: string;
  state: ScriptState;
  now: Date;
  options: TickOptions;
}

/** Acquire the lock, run the script, record success/failure, and perform
 * post-success housekeeping. Returns the ScriptResult for the run. */
export async function executeScript(args: ExecuteScriptArgs): Promise<ScriptResult> {
  const { boxRoot, parsed, scriptName, cardPath, file, state, now, options } = args;

  if (!options.quiet) console.log(`Running ${scriptName}...`);
  // Snapshot mtime before execution so we can detect if the script recreated itself
  let preRunMtimeMs = 0;
  try {
    const stat = await fs.stat(cardPath);
    preRunMtimeMs = stat.mtimeMs;
  } catch (_e) {
    // File may have been deleted between readdir and here; preRunMtimeMs
    // stays 0 so the post-run recreation check simply treats any later
    // mtime as a recreation. No actionable error info here.
  }
  await acquireScriptLock({ boxRoot, scriptName, triggeredBy: "schedule", ...(parsed.lockGroup ? { lockGroup: parsed.lockGroup } : {}) });
  const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
  try {
    const scriptEnv = await buildScriptEnv(boxRoot, {
      CB_TRIGGERED_BY: "schedule",
    });
    const { durationMs, sleepAffected } = await execWithTimeout(parsed.runs, {
      cwd: boxRoot,
      stdio: options.quiet ? "ignore" : "inherit",
      timeout: parsed.timeoutMs ?? SCRIPT_TIMEOUT,
      env: scriptEnv,
    });

    recordOutcome({ state, result: "success", error: null, durationMs, sleepAffected, windowMs, now });
    await saveScriptState({ boxRoot, scriptName, state });

    await handlePostSuccess({ boxRoot, parsed, scriptName, cardPath, file, preRunMtimeMs, options });

    return { name: scriptName, status: "ran", command: parsed.runs, durationMs };
  } catch (err) {
    const { durationMs, sleepAffected } = fallbackTiming(err);
    recordOutcome({ state, result: "failure", error: (err as Error).message, durationMs, sleepAffected, windowMs, now });
    await saveScriptState({ boxRoot, scriptName, state });
    if (!options.quiet) console.error(`  Failed: ${(err as Error).message}`);
    return { name: scriptName, status: "error", command: parsed.runs, durationMs, error: (err as Error).message };
  } finally {
    await releaseScriptLock({ boxRoot, scriptName });
  }
}
