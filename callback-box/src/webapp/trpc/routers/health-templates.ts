/**
 * Health check for **parked template updates** — an upstream template change
 * that couldn't be written because the box's copy diverged, so it sits in
 * `config/_template-updates/<path>` waiting for a human.
 *
 * Why it belongs in health and not only in `cb status`: a parked update is a
 * state the system already knows about and only a person can resolve, which is
 * the definition of what `cb health` answers. Its absence here let five correct
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
  const escalation =
    stuck.length === 0
      ? ""
      : ` A parked update belongs to a task that is not working: ${stuck
          .map((t) => `${t.name} (${t.status}) — ${(t.parkedTemplateUpdates ?? []).join(", ")}`)
          .join("; ")}; the fix may already be on disk.`;

  return {
    name: "template-updates",
    ok: false,
    message: `${head}${escalation} ${PARKED_TEMPLATE_RESOLUTION}`,
    severity: stuck.length > 0 ? "error" : "warning",
  };
}
