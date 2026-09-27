import { TRPCError } from "@trpc/server";
import type { parseScheduledScript } from "../../../schemas/scheduled-script/schema.js";
import {
  loadScriptState,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
} from "../../../core/schedule/state.js";
import { runAndRecord } from "../../../core/schedule/run-action.js";
import { handleCreateAfterSuccess } from "../../../cli/commands/tick-utils.js";
import { checkMissingConnectors } from "../../../connectors/requirements.js";

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
    // A manual run bypasses the engine-wait skip gate (the human asked), but
    // the outcome still classifies: an engine-unavailable failure must not
    // count against the task.
    const run = await runAndRecord({
      boxRoot, parsed, scriptName: name, triggeredBy: "webapp-trigger", stdio: "ignore",
      state, now, runStartedAt: now,
    });
    if (run.result === "success") {
      await handleCreateAfterSuccess({ boxRoot, parsed, scriptName: name });
      return { success: true, durationMs: run.durationMs };
    }
    if (run.result === "inconclusive") {
      return { success: true, durationMs: run.durationMs, inconclusive: run.error };
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: run.error,
    });
  } finally {
    await releaseScriptLock({ boxRoot, scriptName: name });
  }
}
