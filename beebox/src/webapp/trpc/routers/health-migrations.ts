/**
 * Migration-drift health check.
 *
 * Split out of `health.ts` for its line budget, and the natural home for the
 * rest of the convergence surface if more of it lands (a box behind on
 * templates, on provisioning, on annex config).
 */

import { computePending, readManifest } from "../../../core/migration-run.js";
import type { HealthCheck } from "./health.js";

/**
 * Pending box migrations.
 *
 * The deploy sweep (`core/migration-sweep.ts`) applies these automatically, but
 * it skips a box whose tree is dirty and stops at an agent-driven procedure
 * migration — both of which leave the box behind the shipped code with only a
 * line in a deploy log nobody re-reads. Surfacing it here is what makes that
 * state something the boxholder can see rather than something that has to be
 * remembered.
 *
 * A warning, not an error: a box a migration behind still serves correctly; it
 * is the *drift* that needs attention, not the box.
 */
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
  return {
    name: "box-migrations",
    ok: pending.length === 0,
    message:
      pending.length === 0
        ? "box migrations are up to date"
        : `${String(pending.length)} pending migration(s): ${pending.map((m) => m.name).join(", ")}. The deploy sweep skips a box with a dirty tree; commit or stash, or run \`bbx migrate --apply\`.`,
    severity: "warning",
  };
}
