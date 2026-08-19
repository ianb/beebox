/**
 * The unattended migration sweep — `cb migrate --sweep`, run per box by
 * `deploy/deploy.sh` after new engine code ships.
 *
 * Interactive `cb migrate --apply` is built around a human at the terminal: it
 * refuses a dirty tree, runs agent-driven procedure migrations, and leaves the
 * result uncommitted for review. None of those work unattended, so the sweep
 * takes a narrower shape rather than reusing that path with flags:
 *
 * - **Script-kind only.** A procedure migration drives an agent through a
 *   checklist; it stops the sweep and is reported for a human to run.
 * - **Auto-commit, one commit per migration**, carrying the box's existing
 *   `Created-By:` trailer convention. Leaving changes uncommitted would park
 *   the box dirty, and a dirty box is exactly what the next sweep skips — one
 *   un-reviewed migration would silently stop every later one.
 * - **A dirty box is skipped, not migrated.** Auto-committing would sweep
 *   someone's in-flight work into a migration commit. Skipping is reported, and
 *   the next deploy retries.
 * - **Nothing is recorded that did not happen.** A hard failure leaves the
 *   manifest entry unwritten and stops the queue, so the box retries later.
 *
 * The sweep exists because box configuration and card shapes both go stale
 * silently: `cb migrate` was manual, `deploy.sh` had no per-box convergence
 * step, and three of four production boxes sat on a stale git-annex classifier
 * for two weeks before anyone looked.
 */

import { commit, getStatus, stageAll } from "../lib/git.js";
import { getBoxTimeISO } from "../lib/time.js";
import { isProcedureMigration } from "./migrations.js";
import {
  appendManifestEntry,
  computePending,
  readManifest,
  runMigrationScript,
  SOFT_FAILURE_EXIT,
} from "./migration-run.js";

/** One migration the sweep ran, and how it went. */
export interface SweptMigration {
  readonly name: string;
  /** A soft failure: applied and recorded, but some cards could not be converted. */
  readonly partial: boolean;
}

export type SweepResult =
  /** No manifest — the box predates `cb migrate` and needs an explicit human decision. */
  | { readonly status: "no-manifest" }
  /** Nothing pending. The common case, and the quiet one. */
  | { readonly status: "current" }
  /** Uncommitted changes; migrating would entangle them. Retried next sweep. */
  | { readonly status: "skipped-dirty"; readonly pending: string[] }
  /** Ran until a procedure-kind migration, which only a human/agent can apply. */
  | { readonly status: "needs-procedure"; readonly procedure: string; readonly applied: SweptMigration[] }
  /** A migration failed hard. Its manifest entry is unwritten; the queue stopped. */
  | { readonly status: "failed"; readonly failed: string; readonly exitCode: number; readonly applied: SweptMigration[] }
  | { readonly status: "applied"; readonly applied: SweptMigration[] };

/**
 * Apply every pending script migration to one box, committing each.
 *
 * Does NOT provision the box first. Interactive `cb migrate --apply` runs
 * `cb init` up front because a migration may depend on provisioned state; the
 * caller owns that here, since a deploy already ships templates and running a
 * full `cb init` per box mid-sweep is a much larger action than the sweep's own
 * work. A migration that genuinely needs fresh provisioning should say so by
 * failing rather than by relying on a side effect of the runner.
 */
export async function sweepMigrations(opts: { boxRoot: string }): Promise<SweepResult> {
  const { boxRoot } = opts;

  const manifest = await readManifest(boxRoot);
  if (manifest === null) return { status: "no-manifest" };

  const pending = computePending(manifest);
  if (pending.length === 0) return { status: "current" };

  const status = await getStatus(boxRoot);
  if (!status.clean) return { status: "skipped-dirty", pending: pending.map((m) => m.name) };

  const applied: SweptMigration[] = [];
  for (const migration of pending) {
    if (isProcedureMigration(migration)) {
      return { status: "needs-procedure", procedure: migration.name, applied };
    }

    const code = await runMigrationScript({ script: migration.script, boxRoot });
    if (code !== 0 && code !== SOFT_FAILURE_EXIT) {
      return { status: "failed", failed: migration.name, exitCode: code, applied };
    }

    // Record and commit as one unit: the manifest entry and the changes it
    // describes land in the same commit, so a box can never be found claiming a
    // migration whose effects are not in its history (or the reverse). There is
    // always something to commit — the manifest line itself is tracked — even
    // for a migration like `annex-config` that changes no other file.
    await appendManifestEntry(boxRoot, { name: migration.name, "applied-at": getBoxTimeISO(boxRoot) });
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: `Apply migration: ${migration.name}`,
      trailers: { "Created-By": "migration-sweep" },
    });
    applied.push({ name: migration.name, partial: code === SOFT_FAILURE_EXIT });
  }

  return { status: "applied", applied };
}
