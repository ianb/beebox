import { performance } from "node:perf_hooks";
import { TRPCError } from "@trpc/server";
import type { parseScheduledScript } from "../../../schemas/scheduled-script.js";
import {
  loadScriptState,
  saveScriptState,
  recordRun,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
} from "../../../core/schedule-state.js";
import { execWithTimeout, handleCreateAfterSuccess } from "../../../cli/commands/tick-utils.js";
import { buildScriptEnv } from "../../../core/script-env.js";
import { checkMissingConnectors } from "../../../connectors/requirements.js";

const SCRIPT_TIMEOUT = 10 * 60 * 1000;
const DEFAULT_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;
const SLEEP_THRESHOLD_MS = 5_000;

type ParsedScript = ReturnType<typeof parseScheduledScript>;

/**
 * Compute elapsed duration, preferring the monotonic clock when wall/mono
 * diverge enough to indicate the machine slept mid-run.
 */
function measureDuration(wallStart: number, monoStart: number): {
  durationMs: number;
  sleepAffected: boolean;
} {
  const wallElapsed = Date.now() - wallStart;
  const monoElapsed = performance.now() - monoStart;
  const sleepAffected = Math.abs(wallElapsed - monoElapsed) > SLEEP_THRESHOLD_MS;
  const durationMs = sleepAffected ? Math.round(monoElapsed) : wallElapsed;
  return { durationMs, sleepAffected };
}

interface RecordOutcomeOptions {
  boxRoot: string;
  scriptName: string;
  parsed: ParsedScript;
  state: Awaited<ReturnType<typeof loadScriptState>>;
  now: Date;
  result: "success" | "failure";
  error: string | null;
  durationMs: number;
  sleepAffected: boolean;
}

/** Persist the outcome of a run (success or failure) to the script's state. */
async function recordOutcome(options: RecordOutcomeOptions): Promise<void> {
  const { boxRoot, scriptName, parsed, state, now, result, error, durationMs, sleepAffected } = options;
  state.lastRun = now.toISOString();
  state.lastResult = result;
  state.lastError = error;
  state.runCount++;
  const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
  recordRun(state, {
    record: { ts: now.toISOString(), durationMs, ...(sleepAffected ? { sleepAffected: true } : {}) },
    windowMs,
    now,
  });
  await saveScriptState({ boxRoot, scriptName, state });
}

interface PreconditionOptions {
  boxRoot: string;
  name: string;
  parsed: ParsedScript;
}

/**
 * Verify a schedule may be triggered: enabled, requirements met, and no
 * conflicting lock (self or lock-group) currently held. Throws TRPCError otherwise.
 */
export async function checkTriggerPreconditions(options: PreconditionOptions): Promise<void> {
  const { boxRoot, name, parsed } = options;

  if (!parsed.enabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Schedule "${name}" is disabled` });
  }

  if (parsed.requires) {
    const missing = await checkMissingConnectors(boxRoot, parsed.requires);
    if (missing.length > 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Missing connectors: ${missing.join(", ")}`,
      });
    }
  }

  const running = await loadRunningScripts(boxRoot);
  if (running.has(name)) {
    throw new TRPCError({ code: "CONFLICT", message: `"${name}" is already running` });
  }
  if (parsed.lockGroup) {
    const conflict = [...running.entries()].find(
      ([scriptName, lock]) => lock.lockGroup === parsed.lockGroup && scriptName !== name
    );
    if (conflict) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Lock group "${parsed.lockGroup}" held by ${conflict[0]}`,
      });
    }
  }
}

interface RunOptions {
  boxRoot: string;
  name: string;
  parsed: ParsedScript;
}

/**
 * Acquire the lock, execute the script, record the timed outcome, and release.
 * Returns the measured duration on success; rethrows as TRPCError on failure.
 */
export async function runScheduledScript(options: RunOptions): Promise<{ success: true; durationMs: number }> {
  const { boxRoot, name, parsed } = options;
  const now = new Date();
  const state = await loadScriptState(boxRoot, name);

  await acquireScriptLock({
    boxRoot,
    scriptName: name,
    triggeredBy: "webapp-trigger",
    ...(parsed.lockGroup ? { lockGroup: parsed.lockGroup } : {}),
  });

  const wallStart = Date.now();
  const monoStart = performance.now();
  try {
    const scriptEnv = await buildScriptEnv(boxRoot, {
      CB_TRIGGERED_BY: "webapp-trigger",
    });
    await execWithTimeout(parsed.runs, {
      cwd: boxRoot,
      stdio: "ignore",
      timeout: SCRIPT_TIMEOUT,
      env: scriptEnv,
    });

    const { durationMs, sleepAffected } = measureDuration(wallStart, monoStart);
    await recordOutcome({
      boxRoot, scriptName: name, parsed, state, now,
      result: "success", error: null, durationMs, sleepAffected,
    });

    await handleCreateAfterSuccess({ boxRoot, parsed, scriptName: name });

    return { success: true, durationMs };
  } catch (err) {
    const { durationMs, sleepAffected } = measureDuration(wallStart, monoStart);
    await recordOutcome({
      boxRoot, scriptName: name, parsed, state, now,
      result: "failure", error: (err as Error).message, durationMs, sleepAffected,
    });

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: (err as Error).message,
    });
  } finally {
    await releaseScriptLock({ boxRoot, scriptName: name });
  }
}
