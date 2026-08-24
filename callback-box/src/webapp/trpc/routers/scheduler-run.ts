import { TRPCError } from "@trpc/server";
import type { parseScheduledScript } from "../../../schemas/scheduled-script.js";
import {
  loadScriptState,
  saveScriptState,
  recordOutcome,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
  DEFAULT_RUN_WINDOW_MS,
} from "../../../core/schedule/state.js";
import { execWithTimeout, SCRIPT_TIMEOUT } from "../../../lib/exec-with-timeout.js";
import { fallbackTiming, handleCreateAfterSuccess } from "../../../cli/commands/tick-utils.js";
import { buildToolingScriptEnv } from "../../../core/script-env.js";
import { checkMissingConnectors } from "../../../connectors/requirements.js";
import { classifyScheduleFailure } from "../../../core/schedule/engine-wait.js";

type ParsedScript = ReturnType<typeof parseScheduledScript>;

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
 *
 * An inconclusive run is NOT a failure: its work completed, only its check
 * reached no verdict. It returns successfully, carrying the diagnostic in
 * `inconclusive` so the caller can say so rather than showing a red error.
 */
export async function runScheduledScript(
  options: RunOptions,
): Promise<{ success: true; durationMs: number; inconclusive?: string }> {
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
    // Tooling profile: same scheduled scripts as the `cb tick` path.
    const scriptEnv = await buildToolingScriptEnv(boxRoot, {
      CB_TRIGGERED_BY: "webapp-trigger",
    });
    const { durationMs, sleepAffected } = await execWithTimeout(parsed.runs, {
      cwd: boxRoot,
      stdio: "ignore",
      timeout: parsed.timeoutMs ?? SCRIPT_TIMEOUT,
      env: scriptEnv,
    });

    recordOutcome(state, {
      result: "success", error: null, durationMs, sleepAffected,
      windowMs: parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS, now,
    });
    await saveScriptState({ boxRoot, scriptName: name, state });

    await handleCreateAfterSuccess({ boxRoot, parsed, scriptName: name });

    return { success: true, durationMs };
  } catch (err) {
    const { durationMs, sleepAffected } = fallbackTiming(err);
    // A manual run bypasses the engine-wait skip gate (the human asked), but
    // the outcome still classifies: an engine-unavailable failure must not
    // count against the task.
    const outcome = await classifyScheduleFailure({ boxRoot, runStartedAt: now, error: err });
    recordOutcome(state, {
      result: outcome.result, error: outcome.error, durationMs, sleepAffected,
      windowMs: parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS, now,
    });
    await saveScriptState({ boxRoot, scriptName: name, state });

    if (outcome.result === "inconclusive") {
      return { success: true, durationMs, inconclusive: outcome.error };
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: outcome.error,
    });
  } finally {
    await releaseScriptLock({ boxRoot, scriptName: name });
  }
}
