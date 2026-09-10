/**
 * Alerts: the record a schedule's report becomes, and the injected surface the
 * runner and the workstream launcher share.
 *
 * The record is the truth; the macOS notification is one best-effort delivery
 * of it. Split out of schedules-runner.ts so the launcher can raise alerts
 * without an import cycle back into the runner that calls it.
 *
 * Design: beebox/docs/plans/scheduled-workstreams.md (Track C).
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { alertIdFor, type Alert, type Priority } from "./schedules.js";
import { ensureScheduleDir, writeAlert } from "./schedules-store.js";

/** Everything the runner touches that a test wants to hold still. */
export interface RunnerDeps {
  /** `<parent>/schedule-runs` (or `BBX_SCHEDULES_ROOT`). */
  storeRoot: string;
  /** `<checkout>/schedules`. */
  schedulesRoot: string;
  /** The checkout `run` scripts execute in. */
  repoRoot: string;
  /** The MAIN checkout: where `bin/workstreams` lives and where a
   *  `worktree: false` session runs. Separate from `repoRoot` so a test can
   *  substitute a cheap stand-in for real worktree creation. */
  mainRoot: string;
  now: () => Date;
  pid: number;
  isProcessAlive: (pid: number) => boolean;
  /** This machine's boot time in ms, or null when it cannot be determined: a
   *  lock written before it belongs to a PID the kernel has since reused. */
  bootTimeMs: () => number | null;
  notify: (notification: DesktopNotification) => Promise<void>;
}

export interface DesktopNotification {
  title: string;
  message: string;
  group: string;
  destination: string;
}

export interface AlertInput {
  workstream: string;
  runId: string | null;
  title: string;
  message: string;
  details: string | null;
  priority: Priority;
}

/**
 * Write the record, then deliver. The record is the truth; the macOS
 * notification is one best-effort delivery of it, and a machine without
 * `osascript` (or with notifications off) still gets the alert.
 */
export async function raiseAlert(deps: RunnerDeps, input: AlertInput): Promise<Alert> {
  const at = deps.now();
  const alert: Alert = {
    id: alertIdFor(at, randomBytes(2).toString("hex")),
    workstream: input.workstream,
    runId: input.runId,
    title: input.title,
    message: input.message,
    details: input.details,
    priority: input.priority,
    createdAt: at.toISOString(),
    state: "open",
    acknowledgedAt: null,
  };
  await ensureScheduleDir(deps.storeRoot, input.workstream);
  await writeAlert(deps.storeRoot, alert);
  await deps.notify({
    title: `${input.workstream}: ${input.title}`,
    message: input.message,
    group: `schedule-${alert.id}`,
    destination: scheduleAlertUrl(alert),
  });
  return alert;
}

function scheduleAlertUrl(alert: Pick<Alert, "id" | "workstream">): string {
  return `http://localhost:3210/workstreams/alerts/${encodeURIComponent(alert.workstream)}?alert=${encodeURIComponent(alert.id)}`;
}

/** Best-effort macOS notification. Absent notification tools are not an error:
 * the record was already written by the time this runs. alerter owns sticky
 * delivery and click detection; osascript is the non-clickable fallback. */
export async function osascriptNotify(notification: DesktopNotification): Promise<void> {
  const alerter = await executableOnPath("alerter");
  if (alerter !== null) {
    spawnAlerterListener(alerter, notification);
    return;
  }
  process.stderr.write("schedules: alerter not found; falling back to a non-clickable osascript notification\n");
  const quote = (text: string): string => text.replace(/["\\]/g, " ").replace(/\n/g, " ");
  await runQuiet(
    "/usr/bin/osascript",
    ["-e", `display notification "${quote(notification.message)}" with title "${quote(notification.title)}"`],
  );
}

async function executableOnPath(command: string): Promise<string | null> {
  // This root CLI helper intentionally follows the launcher's PATH; the
  // beebox runtime env module does not own process discovery for bin scripts.
  const directories = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean);
  for (const directory of directories) {
    const candidate = join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (_error) {
      // A missing notifier is an expected, fail-open condition.
    }
  }
  return null;
}

/** alerter waits for the user's decision, so a detached listener owns that
 * wait and opens the report only when the notification contents were clicked. */
function spawnAlerterListener(command: string, notification: DesktopNotification): void {
  const script = [
    'result=$("$1" --title "$2" --message "$3" --group "$4" --json 2>/dev/null)',
    'case "$result" in *licked*) /usr/bin/open "$5" >/dev/null 2>&1 ;; esac',
  ].join("\n");
  spawn("/bin/sh", [
    "-c", script, "schedule-alert-listener", command, notification.title,
    notification.message, notification.group, notification.destination,
  ], { detached: true, stdio: "ignore" }).unref();
}

/** Run without surfacing output; false when the binary is missing or exits nonzero. */
function runQuiet(command: string, args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => { resolve(false); });
    child.on("exit", (code) => { resolve(code === 0); });
  });
}
