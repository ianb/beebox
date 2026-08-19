/**
 * git-annex health checks.
 *
 * Split out of `health.ts` for its line budget. The doctor itself lives in
 * `core/annex/doctor.ts`; this is only the read-only projection of it that the
 * health surface reports.
 */

import { runAnnexDoctor } from "../../../core/annex/doctor.js";
import { createGitAnnexService } from "../../../services/git-annex.js";
import type { HealthCheck } from "./health.js";

/**
 * The git-annex conditions `cb doctor annex` cannot repair.
 *
 * Only those two: the rest are repairable, and are repaired by `cb init` and
 * by the `annex-config` migration the deploy sweep applies — so surfacing them
 * here would mostly report problems that are already fixed. (An earlier version
 * of this comment claimed `cb serve` repairs them too. It does not, and that
 * belief is why three production boxes sat on a stale asset classifier for two
 * weeks: nothing ran the repair between deploys. The migration sweep is what
 * closed it.) Both are `error` severity so the deploy runbooks gate on them — the right lever, since refusing to *serve*
 * would take a box offline for a degradation (missing binary, which already
 * fails loudly at every read and commit) or for a loss already sustained
 * (missing content).
 */
export async function annexHealthChecks(args: { repoRoot: string; boxRoot: string }): Promise<HealthCheck[]> {
  const result = await runAnnexDoctor(createGitAnnexService(), {
    repoRoot: args.repoRoot,
    boxRoot: args.boxRoot,
    options: { check: true },
  });
  const out: HealthCheck[] = [];
  for (const id of ["binary", "content-present"]) {
    const check = result.checks.find((c) => c.id === id);
    // Absent when the run short-circuited on a missing binary, which the
    // "binary" check itself already reports.
    if (check === undefined) continue;
    out.push({
      name: `annex-${id}`,
      ok: check.status !== "failed",
      message: check.message,
      severity: "error",
    });
  }
  return out;
}
