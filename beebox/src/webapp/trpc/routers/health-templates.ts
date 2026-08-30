/**
 * Health check for **parked template updates** — an upstream template change
 * that couldn't be written because the box's copy diverged, so it sits in
 * `config/_template-updates/<path>` waiting for a human.
 *
 * Why it belongs in health and not only in `bbx status`: a parked update is a
 * state the system already knows about and only a person can resolve, which is
 * the definition of what `bbx health` answers. Its absence here let five correct
 * upstream fixes ship without one of them reaching the box — the failing task
 * and its parked fix were both on screen, in different commands
 * (issues/bugs/2026-08-24-parked-template-updates-are-invisible-in-health.md).
 *
 * Severity: `warning` normally — drift is a pending choice, not a defect, and
 * must not fail a deploy. It escalates to `error` when a parked path is the
 * procedure or task card behind a scheduled task that is currently `failing` or
 * `inconclusive`: that combination is not drift, it is a known-broken task whose
 * fix is already on disk and unread.
 */

import {
  listParkedTemplateUpdates,
  PARKED_TEMPLATE_RESOLUTION,
} from "../../../core/install-template-file.js";
import type { BoxScheduleHealth } from "../../../core/schedule/health-box.js";
import type { TaskHealth } from "../../../core/schedule/health.js";
import type { HealthCheck } from "./health.js";

/** Task statuses for which a parked update is a likely cause, not a coincidence. */
const BLOCKED_STATUSES = new Set(["failing", "inconclusive"]);

export async function templateUpdatesCheck(
  boxRoot: string,
  scheduleHealth?: BoxScheduleHealth | undefined,
): Promise<HealthCheck> {
  const parked = await listParkedTemplateUpdates(boxRoot);
  if (parked.length === 0) {
    return {
      name: "template-updates",
      ok: true,
      message: "No template updates parked for review",
      severity: "warning",
    };
  }

  const stuck = (scheduleHealth?.tasks ?? []).filter(
    (t) => BLOCKED_STATUSES.has(t.status) && (t.parkedTemplateUpdates ?? []).length > 0,
  );
  const plural = parked.length === 1 ? "" : "s";
  const head = `${String(parked.length)} template update${plural} parked for review: ${parked.join(", ")}.`;
  // Name which state the task is in. "Not working" covered both a task that
  // failed and one nobody judged, which is the collapse this whole area
  // exists to undo: the second is unknown, not broken, and the reader has to
  // be able to tell them apart even though both escalate the same.
  const escalation = [
    describeStuck(stuck.filter((t) => t.status === "failing"), "that is failing"),
    describeStuck(
      stuck.filter((t) => t.status === "inconclusive"),
      "whose last check reached no verdict",
    ),
  ]
    .filter((clause) => clause !== "")
    .join("");

  return {
    name: "template-updates",
    ok: false,
    message: `${head}${escalation} ${PARKED_TEMPLATE_RESOLUTION}`,
    severity: stuck.length > 0 ? "error" : "warning",
  };
}

/**
 * One escalation clause: which tasks in this state a parked update belongs to.
 * `situation` completes "…belongs to a task <situation>" — "that is failing",
 * or "whose last check reached no verdict" — so the two states read as the
 * different things they are.
 */
function describeStuck(tasks: readonly TaskHealth[], situation: string): string {
  if (tasks.length === 0) return "";
  const detail = tasks
    .map((t) => `${t.name} — ${(t.parkedTemplateUpdates ?? []).join(", ")}`)
    .join("; ");
  return ` A parked update belongs to a task ${situation}: ${detail}; the fix may already be on disk.`;
}
