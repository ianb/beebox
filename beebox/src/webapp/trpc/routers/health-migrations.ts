/**
 * Migration-drift health check.
 *
 * Split out of `health.ts` for its line budget, and the natural home for the
 * rest of the convergence surface if more of it lands (a box behind on
 * templates, on provisioning, on annex config).
 */

import { computePending, readManifest } from "../../../core/migration-run.js";
import { migrationQuestions } from "../../../core/migration-repair.js";
import { resolveGitDir } from "../../../lib/git-lock.js";
import { boxMaintenanceStatus } from "../../../lib/box-maintenance.js";
import type { HealthCheck } from "./health.js";

/** Pending conversions and unresolved repair decisions share the runner's readers. */
export async function pendingMigrationsCheck(boxRoot: string): Promise<HealthCheck> {
  const applied = await readManifest(boxRoot);
  if (applied === null) {
    return {
      name: "box-migrations",
      ok: false,
      message: "No migration manifest — this box predates `bbx migrate`. Seed it with `bbx migrate --mark-all-applied` once you have confirmed the box is up to date.",
      severity: "warning",
    };
  }
  const pending = computePending(applied);
  const questions = await migrationQuestions(boxRoot);
  const hasGit = await resolveGitDir(boxRoot) !== null;
  const maintenance = hasGit ? await boxMaintenanceStatus(boxRoot) : null;
  const detail = [
    ...(!hasGit ? ["Git repository missing; migration recovery unavailable"] : []),
    ...(pending.length > 0 ? [`${String(pending.length)} pending migration(s): ${pending.map((m) => m.name).join(", ")}`] : []),
    ...(questions.length > 0 ? [`Repair questions: ${questions.join(", ")}`] : []),
    ...(maintenance ? [`Admission closed: ${maintenance.reason} (${maintenance.phase})`] : []),
  ];
  return {
    name: "box-migrations",
    ok: detail.length === 0,
    message: detail.length > 0 ? `${detail.join(". ")}. Run \`bbx migrate --apply --repair\` to retry; dirty edits are preserved in Git recovery.` : "box migrations are up to date",
    severity: "warning",
  };
}
