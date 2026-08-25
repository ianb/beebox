/**
 * Alerts: the record a schedule's report becomes, and the injected surface the
 * runner and the workstream launcher share.
 *
 * The record is the truth; the macOS notification is one best-effort delivery
 * of it. Split out of schedules-runner.ts so the launcher can raise alerts
 * without an import cycle back into the runner that calls it.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md (Track C).
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { alertIdFor, type Alert, type Priority } from "./schedules.js";
import { ensureScheduleDir, writeAlert } from "./schedules-store.js";

/** Everything the runner touches that a test wants to hold still. */
export interface RunnerDeps {
  /** `<parent>/schedule-runs` (or `CALLBACK_SCHEDULES_ROOT`). */
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
  notify: (notification: { title: string; message: string }) => Promise<void>;
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
  await deps.notify({ title: `${input.workstream}: ${input.title}`, message: input.message });
  return alert;
}

/** Best-effort macOS notification. Absent `osascript` is not an error — the
 *  record was already written by the time this runs. */
export async function osascriptNotify(notification: { title: string; message: string }): Promise<void> {
  await new Promise<void>((resolve) => {
    const quote = (text: string): string => text.replace(/["\\]/g, " ").replace(/\n/g, " ");
    const child = spawn(
      "/usr/bin/osascript",
      ["-e", `display notification "${quote(notification.message)}" with title "${quote(notification.title)}"`],
      { stdio: "ignore" },
    );
    child.on("error", () => { resolve(); });
    child.on("exit", () => { resolve(); });
  });
}
