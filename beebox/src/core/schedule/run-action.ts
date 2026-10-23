/**
 * Run a scheduled script's action, the one path every trigger shares (`bbx
 * tick`, `bbx wakeup`'s on-wakeup pass, the web app's "run now"). A `runs:`
 * card executes its command through the shell; a `notify:` card sends its
 * notification in this process through `notifyBoxholder`, with no shell and no
 * agent. See docs/implemented-plans/notifications.md (Track D).
 *
 * `runAndRecord` wraps a run in schedule memory (`memory.ts`) and records its
 * outcome in the schedule's state.
 *
 * A notification that reached nobody (every tried channel failed, or none
 * could be tried) throws, so the run records a failure the way `bbx notify`
 * exiting 1 inside a `runs:` pipeline would. When no channel was tried (no
 * device, no subscription), the failure is final: a reminder does not retry it.
 */

import { performance } from "node:perf_hooks";
import type { ParsedScheduledScript } from "../../schemas/scheduled-script/schema.js";
import type { ScheduleNotify } from "../../scheduled-script-fields.js";
import { CommandError, CommandFailedError, execWithTimeout, SCRIPT_TIMEOUT, type ExecTiming } from "../../lib/exec-with-timeout.js";
import { CHECK_SKIP_CODE } from "../procedure/shell.js";
import { buildToolingScriptEnv } from "../script-env/core.js";
import { notificationReached, notifyBoxholder, type NotificationInput } from "../notify-boxholder.js";
import { parseTarget } from "../notification/target.js";
import type { Loudness } from "../notification/intent.js";
import { DEFAULT_RUN_WINDOW_MS, recordOutcome, saveScriptState, type ScriptState } from "./state.js";
import { classifyScheduleFailure, type ScheduleOutcomeResult } from "./engine-wait.js";
import { finishRunMemory, prepareRunMemory, readDeferMarker, type RunMemory } from "./memory.js";
import { DEFER_REASON_TEXT, type DeferReason } from "./defer-reason.js";
import { appendRunHistory, historyEntry, readRunSummary, type RunSummary } from "./summary.js";
import { errorMessage } from "../../shared/error-guards.js";

class ScheduledNotificationUndeliveredError extends Error {
  /** True when no channel tried a send (every delivery skipped): another run cannot reach anyone either. */
  readonly final: boolean;

  constructor(detail: string, opts: { final: boolean }) {
    super(`Not delivered: ${detail}`);
    this.name = "ScheduledNotificationUndeliveredError";
    this.final = opts.final;
  }
}

export interface RunActionArgs {
  boxRoot: string;
  parsed: ParsedScheduledScript;
  scriptName: string;
  /** `BBX_TRIGGERED_BY` for a command: `schedule`, `wakeup`, or `webapp-trigger`. */
  triggeredBy: string;
  stdio: "inherit" | "ignore";
  /** Extra environment for a command (schedule memory); unused by `notify:`. */
  env?: Record<string, string> | undefined;
}

/**
 * The intent a `notify:` card sends. `loudness` defaults to `loud` when the
 * boxholder asked for the schedule, else `quiet`; `target` to `chat:new`. A
 * `context` ref is the body's last line, so the `chat:new` banner and the
 * chat it opens both carry it. The tag is the schedule's name, so the phone
 * collapses repeats of one schedule only.
 */
function scheduledNotification(opts: { notify: ScheduleNotify; parsed: ParsedScheduledScript; scriptName: string }): NotificationInput {
  const { notify, parsed, scriptName } = opts;
  const loudness: Loudness = notify.loudness ?? (parsed.requestedBy === "boxholder" ? "loud" : "quiet");
  const lines = [notify.body ?? "", notify.context === undefined ? "" : `Context: ${notify.context}`].filter((l) => l !== "");
  return {
    title: notify.title,
    body: lines.join("\n\n"),
    target: parseTarget(notify.target ?? "chat:new"),
    loudness,
    tag: scriptName,
    source: `schedule:${scriptName}`,
  };
}

async function runScheduleAction(args: RunActionArgs): Promise<ExecTiming> {
  const { boxRoot, parsed, scriptName, triggeredBy, stdio } = args;
  const { action } = parsed;
  if (action.kind === "notify") {
    const started = performance.now();
    const intent = scheduledNotification({ notify: action.notify, parsed, scriptName });
    const result = await notifyBoxholder(boxRoot, { intent });
    if (!notificationReached(result)) {
      const detail = result.deliveries.map((d) => `${d.channel} ${d.status}${d.detail === undefined ? "" : ` (${d.detail})`}`).join(", ");
      const final = !result.deliveries.some((d) => d.status === "failed");
      throw new ScheduledNotificationUndeliveredError(detail || "no channel tried", { final });
    }
    return { durationMs: Math.round(performance.now() - started), sleepAffected: false };
  }
  // Tooling profile: scheduled `runs:` commands are box tooling (mostly `bbx`
  // invocations that sync the connectors).
  const env = await buildToolingScriptEnv(boxRoot, { BBX_TRIGGERED_BY: triggeredBy, ...args.env });
  return execWithTimeout(action.command, {
    cwd: boxRoot,
    stdio,
    timeout: parsed.timeoutMs ?? SCRIPT_TIMEOUT,
    env,
  });
}

/** Timing for a run that failed outside execWithTimeout (e.g. spawn error):
 * no measurement exists, so record zero rather than invent one. */
export function fallbackTiming(err: unknown): ExecTiming {
  if (err instanceof CommandError) return err.timing;
  return { durationMs: 0, sleepAffected: false };
}

export type RecordedRun = (
  | { result: "success"; durationMs: number }
  | { result: ScheduleOutcomeResult; error: string; durationMs: number; deferReason?: DeferReason | undefined; final?: boolean | undefined }
) & {
  /** What the run said about itself through `BBX_SUMMARY_FILE`, or null. */
  summary: RunSummary | null;
};

/**
 * Classify a failed action. A `notify:` send that failed is a `failure`: it
 * runs no agent, so an engine-wait record written during it (a chat's quota
 * episode) says nothing about it, and `deferred` would hide a send that did
 * not get through. It is `final` when no channel was tried. A command goes
 * through the engine-wait classifier.
 */
export async function classifyActionFailure(
  parsed: ParsedScheduledScript,
  options: { boxRoot: string; runStartedAt: Date; error: unknown },
): Promise<{ result: ScheduleOutcomeResult; error: string; final?: boolean | undefined }> {
  if (parsed.action.kind === "notify") {
    const final = options.error instanceof ScheduledNotificationUndeliveredError && options.error.final;
    return { result: "failure", error: errorMessage(options.error), final };
  }
  return classifyScheduleFailure(options);
}

/**
 * Classify a failed run. A command that exited 75 (`CHECK_SKIP_CODE`) after
 * writing a defer marker deferred on purpose: `deferred`, with the marker's
 * reason. Exit 75 alone is not evidence (any command may exit 75, and the
 * scheduler's `deferred` needs evidence), so without a marker it goes to the
 * ordinary classification, where it is a failure.
 */
async function classifyRun(
  args: { parsed: ParsedScheduledScript; boxRoot: string; runStartedAt: Date; error: unknown; memory: RunMemory | null },
): Promise<{ result: ScheduleOutcomeResult; error: string; deferReason?: DeferReason | undefined; final?: boolean | undefined }> {
  const { parsed, boxRoot, runStartedAt, error, memory } = args;
  if (memory !== null && error instanceof CommandFailedError && error.exitCode === CHECK_SKIP_CODE) {
    const deferReason = await readDeferMarker(memory.deferFilePath);
    if (deferReason !== null) {
      return { result: "deferred", error: `${deferReason}: ${DEFER_REASON_TEXT[deferReason]}`, deferReason };
    }
  }
  return classifyActionFailure(parsed, { boxRoot, runStartedAt, error });
}

/**
 * Run the action with schedule memory, classify a failure (deferred,
 * inconclusive, or failure), record the outcome, take the carry and move the
 * cursor, and save the state. `runStartedAt` bounds the deferred
 * classification to this script's own span.
 */
export async function runAndRecord(
  args: RunActionArgs & { state: ScriptState; now: Date; runStartedAt: Date },
): Promise<RecordedRun> {
  const { boxRoot, parsed, scriptName, state, now, runStartedAt } = args;
  const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
  // Memory belongs to commands: a notify: card has no shell to read it.
  const memory = parsed.action.kind === "runs" ? await prepareRunMemory(boxRoot, { state, scriptName }) : null;
  try {
    let run: RecordedRun;
    let timing: ExecTiming;
    try {
      timing = await runScheduleAction({ ...args, env: memory?.env });
      run = { result: "success", durationMs: timing.durationMs, summary: null };
    } catch (err) {
      timing = fallbackTiming(err);
      const outcome = await classifyRun({ parsed, boxRoot, runStartedAt, error: err, memory });
      run = { ...outcome, durationMs: timing.durationMs, summary: null };
    }
    const error = run.result === "success" ? null : run.error;
    const deferReason = run.result === "success" ? null : run.deferReason;
    const final = run.result === "success" ? false : run.final;
    recordOutcome(state, { result: run.result, error, deferReason, final, durationMs: timing.durationMs, sleepAffected: timing.sleepAffected, windowMs, now });
    if (memory !== null) {
      await finishRunMemory(boxRoot, { memory, state, scriptName });
      run.summary = await readRunSummary(memory.summaryFilePath);
    }
    await saveScriptState({ boxRoot, scriptName, state });
    const entry = historyEntry(state, { triggeredBy: args.triggeredBy, summary: run.summary });
    if (run.result === "success" && parsed.action.kind === "notify") {
      // The send got through and its state is saved: a history write that
      // fails must not turn it into a failure, which a reminder would retry.
      try {
        await appendRunHistory(boxRoot, { scriptName, entry });
      } catch (err) {
        console.error(`Schedule ${scriptName}: notification sent, but its run history was not written:`, err);
      }
    } else {
      await appendRunHistory(boxRoot, { scriptName, entry });
    }
    return run;
  } finally {
    await memory?.dispose();
  }
}
