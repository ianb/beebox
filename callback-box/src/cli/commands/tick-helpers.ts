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
  recordOutcome,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningProcedures,
  loadActiveChats,
  DEFAULT_RUN_WINDOW_MS,
} from "../../core/schedule/state.js";
import type {
  loadScriptState,
  loadRunningScripts,
} from "../../core/schedule/state.js";
import { execWithTimeout, SCRIPT_TIMEOUT } from "../../lib/exec-with-timeout.js";
import { fallbackTiming, handleCreateAfterSuccess } from "./tick-utils.js";
import { stageAll, commit, getStatus, withBoxGitLock } from "../../lib/git.js";
import { buildToolingScriptEnv } from "../../core/script-env.js";
import type { TickOptions, ScriptResult } from "./tick.js";
import { errnoCode } from "../../lib/error-guards.js";
import {
  boxEngineUnavailability,
  classifyScheduleFailure,
  engineWaitReason,
} from "../../core/schedule/engine-wait.js";
import { getBoxTime } from "../../lib/time.js";

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
    if (!options.quiet && errnoCode(e) !== "ENOENT") {
      console.warn(`No schedules directory found (or unreadable): ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}

/**
 * Which busy blockers still defer the tick, given --force. Chat locks are
 * an advisory contention heuristic — and a forced tick frequently
 * ORIGINATES from chat (the boxholder asking the agent to run something
 * now), so deferring a forced tick on a chat session is self-defeating.
 * Genuinely running work (scripts, procedures) defers even under force:
 * it finishes on its own, unlike a chat session that can sit active for
 * hours. The tree-sweep hazard chat locks also guarded (the housekeeping
 * commit) is handled at the commit site itself — see handlePostSuccess.
 */
export function effectiveBusyBlockers(
  blockers: string[],
  { force }: { force: boolean },
): string[] {
  if (!force) return blockers;
  return blockers.filter((b) => !b.startsWith("chat:"));
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
 * An empty-string reason means "skip silently".
 *
 * With `options.force`, the schedule (due-ness) and budget gates are
 * bypassed — but not `enabled: false` (an explicit user statement), not
 * missing connectors (the run would just fail), and not a live lock-group
 * holder (never preempt running work). */
export async function evaluateSkip(ctx: SkipContext): Promise<string | null> {
  const { boxRoot, parsed, scriptName, state, now, running, options } = ctx;

  if (options.force) {
    if (!parsed.enabled) {
      return options.quiet ? "" : `  Skipping ${scriptName}: disabled (enabled: false)`;
    }
  } else if (!isDue(parsed, { lastRun: state.lastRun, now })) {
    return "";
  }

  // Engine unavailable (e.g. quota-exhausted): running would burn an attempt
  // that cannot succeed. `lastRun` stays untouched, so the script remains due
  // and runs on the first tick after the reset. `--force` bypasses this like
  // the other schedule gates.
  if (!options.force) {
    const engineWait = await boxEngineUnavailability(boxRoot);
    if (engineWait !== null) {
      return options.quiet ? "" : `  Skipping ${scriptName}: ${engineWaitReason(engineWait)}`;
    }
  }

  if (parsed.requires) {
    const missing = await checkMissingConnectors(boxRoot, parsed.requires);
    if (missing.length > 0) {
      return options.quiet ? "" : `  Skipping ${scriptName}: missing connectors: ${missing.join(", ")}`;
    }
  }

  if (parsed.budget && !options.force) {
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

  // Commit housekeeping changes (once deletion, createAfterSuccess files).
  // stageAll sweeps the WHOLE tree, so re-check for active chats right
  // before committing: a chat agent's half-written files must not get
  // swept into a housekeeping commit. This matters under --force (which
  // bypasses the at-rest gate for chat blockers) and also closes the race
  // where a chat starts during a long script run. Deferred changes sit
  // uncommitted until the next at-rest tick sweeps them.
  // One locked span from the status read through the commit: the read decides
  // whether to sweep, and stageAll sweeps the WHOLE tree, so another writer
  // landing in between would either be swept into this commit or make the
  // decision stale.
  await withBoxGitLock(boxRoot, async () => {
    const postStatus = await getStatus(boxRoot);
    if (postStatus.clean) return;

    const activeChats = await loadActiveChats(boxRoot);
    if (activeChats.size > 0) {
      if (!options.quiet) {
        console.log("  Housekeeping commit deferred — chat active; changes stay uncommitted until the next at-rest tick");
      }
      return;
    }
    await stageAll(boxRoot);
    const parts: string[] = [];
    if (parsed.once) parts.push(`remove one-shot ${scriptName}`);
    if (parsed.createAfterSuccess.length > 0) parts.push(`chain ${parsed.createAfterSuccess.map((c) => path.basename(c.path)).join(", ")}`);
    await commit(boxRoot, {
      message: `Tick: ${parts.join(", ") || "housekeeping"}`,
      trailers: { "Triggered-By": "cb tick" },
    });
  });
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
  // This script's own span, not the tick's — the deferred classification must
  // not attribute an unavailability detected by an EARLIER script in this
  // tick to this script's unrelated failure.
  const scriptStartedAt = getBoxTime(boxRoot);
  try {
    // Tooling profile: scheduled `runs:` commands are box tooling (mostly
    // `cb wakeup`, which syncs the connectors).
    const scriptEnv = await buildToolingScriptEnv(boxRoot, {
      CB_TRIGGERED_BY: "schedule",
    });
    const { durationMs, sleepAffected } = await execWithTimeout(parsed.runs, {
      cwd: boxRoot,
      stdio: options.quiet ? "ignore" : "inherit",
      timeout: parsed.timeoutMs ?? SCRIPT_TIMEOUT,
      env: scriptEnv,
    });

    recordOutcome(state, { result: "success", error: null, durationMs, sleepAffected, windowMs, now });
    await saveScriptState({ boxRoot, scriptName, state });

    await handlePostSuccess({ boxRoot, parsed, scriptName, cardPath, file, preRunMtimeMs, options });

    return { name: scriptName, status: "ran", command: parsed.runs, durationMs };
  } catch (err) {
    const { durationMs, sleepAffected } = fallbackTiming(err);
    const outcome = await classifyScheduleFailure({ boxRoot, runStartedAt: scriptStartedAt, error: err });
    recordOutcome(state, { result: outcome.result, error: outcome.error, durationMs, sleepAffected, windowMs, now });
    await saveScriptState({ boxRoot, scriptName, state });
    if (!options.quiet) {
      console.error(`  ${outcome.result === "deferred" ? "Deferred" : "Failed"}: ${outcome.error}`);
    }
    return { name: scriptName, status: "error", command: parsed.runs, durationMs, error: outcome.error };
  } finally {
    await releaseScriptLock({ boxRoot, scriptName });
  }
}
