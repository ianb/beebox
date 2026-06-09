import { TRPCError } from "@trpc/server";
import type { parseScheduledScript } from "../../../schemas/scheduled-script.js";
import {
  loadScriptState,
  saveScriptState,
  recordRun,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
  DEFAULT_RUN_WINDOW_MS,
} from "../../../core/schedule-state.js";
import { execWithTimeout, SCRIPT_TIMEOUT } from "../../../lib/exec-with-timeout.js";
import { fallbackTiming, handleCreateAfterSuccess } from "../../../cli/commands/tick-utils.js";
import { buildScriptEnv } from "../../../core/script-env.js";
import { checkMissingConnectors } from "../../../connectors/requirements.js";

type ParsedScript = ReturnType<typeof parseScheduledScript>;

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

  try {
    const scriptEnv = await buildScriptEnv(boxRoot, {
      CB_TRIGGERED_BY: "webapp-trigger",
    });
    const { durationMs, sleepAffected } = await execWithTimeout(parsed.runs, {
      cwd: boxRoot,
      stdio: "ignore",
      timeout: parsed.timeoutMs ?? SCRIPT_TIMEOUT,
      env: scriptEnv,
    });

    await recordOutcome({
      boxRoot, scriptName: name, parsed, state, now,
      result: "success", error: null, durationMs, sleepAffected,
    });

    await handleCreateAfterSuccess({ boxRoot, parsed, scriptName: name });

    return { success: true, durationMs };
  } catch (err) {
    const { durationMs, sleepAffected } = fallbackTiming(err);
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
