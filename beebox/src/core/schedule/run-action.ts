/**
 * Run a scheduled script's action, the one path every trigger shares (`bbx
 * tick`, `bbx wakeup`'s on-wakeup pass, the web app's "run now"). A `runs:`
 * card executes its command through the shell; a `notify:` card sends its
 * notification in this process through `notifyBoxholder`, with no shell and no
 * agent. See docs/plans/notifications.md (Track D).
 *
 * A notification that reached nobody (every tried channel failed, or none
 * could be tried) throws, so the run records a failure the way `bbx notify`
 * exiting 1 inside a `runs:` pipeline would.
 */

import { performance } from "node:perf_hooks";
import type { ParsedScheduledScript } from "../../schemas/scheduled-script.js";
import type { ScheduleNotify } from "../../schemas/scheduled-script-fields.js";
import { execWithTimeout, SCRIPT_TIMEOUT, type ExecTiming } from "../../lib/exec-with-timeout.js";
import { scheduleCardForTask } from "./parked-templates.js";
import { buildToolingScriptEnv } from "../script-env.js";
import { notificationReached, notifyBoxholder, type NotificationInput } from "../notify-boxholder.js";
import { parseTarget } from "../notification/target.js";
import type { Loudness } from "../notification/intent.js";

class ScheduledNotificationUndeliveredError extends Error {
  constructor(detail: string) {
    super(`Not delivered: ${detail}`);
    this.name = "ScheduledNotificationUndeliveredError";
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
export function scheduledNotification(opts: { notify: ScheduleNotify; parsed: ParsedScheduledScript; scriptName: string }): NotificationInput {
  const { notify, parsed, scriptName } = opts;
  const loudness: Loudness = notify.loudness ?? (parsed.requestedBy === "boxholder" ? "loud" : "quiet");
  const lines = [notify.body ?? "", notify.context === undefined ? "" : `Context: ${notify.context}`].filter((l) => l !== "");
  return {
    title: notify.title,
    body: lines.join("\n\n"),
    target: parseTarget(notify.target ?? "chat:new"),
    loudness,
    tag: scriptName,
    source: scheduleCardForTask(scriptName),
  };
}

export async function runScheduleAction(args: RunActionArgs): Promise<ExecTiming> {
  const { boxRoot, parsed, scriptName, triggeredBy, stdio } = args;
  const { action } = parsed;
  if (action.kind === "notify") {
    const started = performance.now();
    const intent = scheduledNotification({ notify: action.notify, parsed, scriptName });
    const result = await notifyBoxholder(boxRoot, { intent });
    if (!notificationReached(result)) {
      const detail = result.deliveries.map((d) => `${d.channel} ${d.status}${d.detail === undefined ? "" : ` (${d.detail})`}`).join(", ");
      throw new ScheduledNotificationUndeliveredError(detail || "no channel tried");
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
