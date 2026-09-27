/**
 * Internal helpers for `bbx tick` (see tick.ts). Extracted to keep tick.ts
 * within the per-function and per-file size limits; not shared with wakeup.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describeScheduleAction } from "../schemas/scheduled-script/schema.js";
import type { ParsedScheduledScript } from "../schemas/scheduled-script/schema.js";
import { isDue, isWithinBudget } from "../schemas/scheduled-script/due.js";
import { checkMissingConnectors } from "../requirements.js";
import {
  saveScriptState,
  recordOutcome,
  acquireScriptLock,
  releaseScriptLock,
  loadActiveChats,
  DEFAULT_RUN_WINDOW_MS,
} from "../core/schedule/state.js";
import type {
  loadScriptState,
  loadRunningScripts,
} from "../core/schedule/state.js";
import { fallbackTiming, runAndRecord } from "../core/schedule/run-action.js";
import { loadRunningProcedures } from "../core/schedule/running-procedures.js";
import { cardMtimeMs, deleteOnceCard, handleCreateAfterSuccess } from "./tick-utils.js";
import { stageAll, commit, getStatus, withBoxGitLock } from "../lib/git/core.js";
import type { TickOptions, ScriptResult } from "./commands/tick.js";
import { errnoCode } from "../shared/error-guards.js";
import { scheduleOutcomeLine } from "../shared/schedule-error.js";
import {
  boxEngineUnavailability,
  classifyScheduleFailure,
  engineWaitReason,
  type ScheduleOutcomeResult,
} from "../core/schedule/engine-wait.js";
import type { SkipCause } from "../core/schedule/skip.js";
import { getBoxTime } from "../lib/time.js";

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

/** A skip: the line to print (empty means "skip silently") and, when recorded, its cause. */
export interface SkipDecision {
  line: string;
  cause?: SkipCause | undefined;
}

/** Evaluate the pre-run skip gates (due, requires, budget, lock-group).
 * Returns the skip, or null if the script should run.
 *
 * With `options.force`, the schedule (due-ness) and budget gates are
 * bypassed — but not `enabled: false` (an explicit user statement), not
 * missing connectors (the run would just fail), and not a live lock-group
 * holder (never preempt running work). */
export async function evaluateSkip(ctx: SkipContext): Promise<SkipDecision | null> {
  const { boxRoot, parsed, scriptName, state, now, running, options } = ctx;
  const say = (text: string, cause?: SkipCause): SkipDecision => ({ line: options.quiet ? "" : `  Skipping ${scriptName}: ${text}`, cause });

  if (options.force) {
    if (!parsed.enabled) return say("disabled (enabled: false)");
  } else if (!isDue(parsed, { lastRun: state.lastRun, now })) {
    return { line: "" };
  }

  // Engine unavailable (e.g. quota-exhausted): running would burn an attempt
  // that cannot succeed. `lastRun` stays untouched, so the script remains due
  // and runs on the first tick after the reset. `--force` bypasses this like
  // the other schedule gates.
  if (!options.force) {
    const engineWait = await boxEngineUnavailability(boxRoot);
    if (engineWait !== null) return say(engineWaitReason(engineWait), { reason: "engine-quota", live: engineWait });
  }

  if (parsed.requires) {
    const missing = await checkMissingConnectors(boxRoot, parsed.requires);
    if (missing.length > 0) return say(`missing connectors: ${missing.join(", ")}`, { reason: "missing-connectors", connectors: missing });
  }

  if (parsed.budget && !options.force) {
    const check = isWithinBudget(parsed.budget, { recentRuns: state.recentRuns, now });
    if (!check.allowed) return say(`budget exceeded (${Math.round(check.usedMs / 1000)}s used)`);
  }

  if (parsed.lockGroup) {
    const conflict = [...running.entries()].find(
      ([name, lock]) => lock.lockGroup === parsed.lockGroup && name !== scriptName
    );
    if (conflict) return say(`lock-group "${parsed.lockGroup}" held by ${conflict[0]}`);
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

  if (parsed.once) await deleteOnceCard(cardPath, { file, preRunMtimeMs, quiet: options.quiet === true });

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
      trailers: { "Triggered-By": "bbx tick" },
    });
  });
}

/** A run that did not succeed, as the tick reports it. An inconclusive run is
 * not an error (its work completed), so it keeps its own status and the tick
 * summary does not count it as one. */
function outcomeResult(
  { scriptName, command, outcome }: { scriptName: string; command: string; outcome: { result: ScheduleOutcomeResult; error: string; durationMs: number } },
): ScriptResult {
  return {
    name: scriptName,
    status: outcome.result === "inconclusive" ? "inconclusive" : "error",
    command,
    durationMs: outcome.durationMs,
    error: outcome.error,
  };
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
  const preRunMtimeMs = await cardMtimeMs(cardPath);
  await acquireScriptLock({ boxRoot, scriptName, triggeredBy: "schedule", ...(parsed.lockGroup ? { lockGroup: parsed.lockGroup } : {}) });
  // This script's own span, not the tick's — the deferred classification must
  // not attribute an unavailability detected by an EARLIER script in this
  // tick to this script's unrelated failure.
  const scriptStartedAt = getBoxTime(boxRoot);
  const command = describeScheduleAction(parsed.action);
  try {
    const run = await runAndRecord({
      boxRoot, parsed, scriptName, triggeredBy: "schedule", stdio: options.quiet ? "ignore" : "inherit",
      state, now, runStartedAt: scriptStartedAt,
    });
    if (run.result !== "success" && run.deferReason !== undefined) {
      // The pipeline deferred on purpose (a defer marker): nothing to do this
      // time. Not an error; the tick log shows it as skipped, with the reason.
      if (!options.quiet) console.log(`  ${scheduleOutcomeLine(run)}`);
      return { name: scriptName, status: "skipped", command, durationMs: run.durationMs, error: run.error };
    }
    if (run.result !== "success") {
      if (!options.quiet) console.error(`  ${scheduleOutcomeLine(run)}`);
      return outcomeResult({ scriptName, command, outcome: run });
    }
    await handlePostSuccess({ boxRoot, parsed, scriptName, cardPath, file, preRunMtimeMs, options });
    return { name: scriptName, status: "ran", command, durationMs: run.durationMs };
  } catch (err) {
    // Post-success housekeeping failed: the run is recorded again as its outcome.
    const { durationMs, sleepAffected } = fallbackTiming(err);
    const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
    const outcome = await classifyScheduleFailure({ boxRoot, runStartedAt: scriptStartedAt, error: err });
    recordOutcome(state, { result: outcome.result, error: outcome.error, durationMs, sleepAffected, windowMs, now });
    await saveScriptState({ boxRoot, scriptName, state });
    if (!options.quiet) console.error(`  ${scheduleOutcomeLine(outcome)}`);
    return outcomeResult({ scriptName, command, outcome: { ...outcome, durationMs } });
  } finally {
    await releaseScriptLock({ boxRoot, scriptName });
  }
}
