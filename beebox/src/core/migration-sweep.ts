import { startAwakeTimeout } from "../lib/awake-timeout.js";
import { docsRefreshHasWork, refreshGeneratedDocs } from "./docs-refresh.js";
import type { Agent } from "./agent/types.js";
import { repairMigration, runProcedureMigration, finishMigrationRepair, migrationQuestions } from "./migration-repair.js";
import { checkPendingQuestionsAndNotify } from "./question-alert.js";
import { stageAndCommitPaths } from "../lib/git.js";
import { captureMigrationSnapshot, changedMigrationPaths, restoreMigrationIndex, migrationOutputBaseline, finishMigrationOutput } from "./migration-recovery.js";
import { acquireBoxMaintenance, boxWorkHolders, peekBoxWork, type BoxMaintenance } from "../lib/box-maintenance.js";
import { BoxMaintenanceError, type WorkHolder } from "../lib/box-maintenance-error.js";
import { getBoxTimeISO } from "../lib/time.js";
import { errorMessage } from "../lib/error-guards.js";
import { invariant } from "../lib/invariant.js";
import { MANIFEST_PATH, isProcedureMigration, type Migration } from "./migrations.js";
import {
  appendManifestEntry,
  computePending,
  readManifest,
  restoreManifest,
  runMigrationScript,
  snapshotManifest,
  SOFT_FAILURE_EXIT,
} from "./migration-run.js";
/**
 * How long a yielding pass waits for live work to clear. Long enough for the
 * box's server to notice the phase and close idle chat runs (it polls every
 * second), short enough that a box someone is actually using is shut only
 * briefly before the pass gives up until next hour.
 */
const YIELD_DRAIN_MS = 15_000;
/** Commit refused because the owner lock was lost; no repair can win it back. */
const OWNERSHIP_LOST = "maintenance ownership lost";

/** One migration the sweep ran, and how it went. */
export interface SweptMigration {
  readonly name: string;
  /** A soft failure: applied and recorded, but some cards could not be converted. */
  readonly partial: boolean;
  readonly question?: string | undefined;
  readonly sessionId?: string | undefined;
}

export type SweepResult =
  /** No manifest — the box predates `bbx engine migrate` and needs an explicit human decision. */
  | { readonly status: "no-manifest" }
  /** Nothing pending. The common case, and the quiet one. */
  | { readonly status: "current" }
  /** Work is pending, but the box is in use and this pass may yield; the next one retries. */
  | { readonly status: "deferred"; readonly holders: WorkHolder[] }
  | { readonly status: "attention"; readonly questions: string[]; readonly applied: SweptMigration[] }
  | { readonly status: "deferred-repair"; readonly failed: string; readonly recoveryRef: string; readonly applied: SweptMigration[] }
  /** Ran until a procedure-kind migration, which only a human/agent can apply. */
  | { readonly status: "needs-procedure"; readonly procedure: string; readonly applied: SweptMigration[] }
  /** A migration failed hard. Its manifest entry is unwritten; the queue stopped. */
  | { readonly status: "failed"; readonly failed: string; readonly exitCode: number; readonly question?: string | undefined; readonly sessionId?: string | undefined; readonly recoveryRef: string; readonly applied: SweptMigration[] }
  /** The migration ran but its commit failed; the manifest entry was rolled back. */
  | { readonly status: "commit-failed"; readonly failed: string; readonly error: string; readonly question?: string | undefined; readonly sessionId?: string | undefined; readonly recoveryRef: string; readonly applied: SweptMigration[] }
  | { readonly status: "applied"; readonly applied: SweptMigration[] };

export class MigrationExecutionTimeoutError extends Error {
  constructor() {
    super("Migration execution timed out; inspect its recovery snapshot before retrying");
    this.name = "MigrationExecutionTimeoutError";
  }
}

interface SweepOptions {
  executionMs?: number;
  signal?: AbortSignal | undefined;
  boxRoot: string;
  refresh?: boolean;
  /** Runs an agent-applied migration; `onOutput` receives its output for the failure question. */
  runProcedure?: ((procedure: string, run: { signal?: AbortSignal | undefined; onOutput: (text: string) => void }) => Promise<number>) | undefined;
  json?: boolean | undefined;
  repair?: boolean | undefined;
  /** An unattended pass runs a procedure migration once per human answer; a manual pass runs it directly. */
  unattended?: boolean | undefined;
  withinMaintenance?: boolean | undefined;
  prepare?: boolean | undefined;
  /** A scheduled pass yields to live work instead of draining it. */
  yield?: boolean | undefined;
  runScript?: typeof runMigrationScript;
  repairAgent?: Agent;
}

/** The sweep's outcome when nothing needs the gate, or null when something does. */
async function sweepWithoutWork(opts: SweepOptions): Promise<SweepResult | null> {
  const manifest = await readManifest(opts.boxRoot);
  if (manifest === null) return { status: "no-manifest" };
  if (computePending(manifest).length > 0) return null;
  if ((await migrationQuestions(opts.boxRoot)).length > 0) return null;
  if (opts.refresh && await docsRefreshHasWork(opts.boxRoot)) return null;
  return { status: "current" };
}

/** One application path for manual and unattended migration. */
export async function sweepMigrations(opts: SweepOptions): Promise<SweepResult> {
  // Closing admission costs the box its live work, so look before closing. A
  // refused look means maintenance is already under way: recovery needs the
  // gate and takes the ordinary path below.
  const yielding = opts.yield === true && opts.withinMaintenance !== true;
  if (opts.withinMaintenance !== true) {
    const peek = await peekBoxWork({ boxRoot: opts.boxRoot, reason: "migration peek" }, () => sweepWithoutWork(opts));
    if (peek.admitted && peek.value !== null) return peek.value;
  }
  let maintenance;
  try {
    // An idle chat run holds a lease until the server sees a phase and closes
    // it, so a yielding pass cannot judge "in use" from the leases alone: it
    // closes, waits briefly, and treats work that outlasts the wait as the
    // box being in use.
    maintenance = await acquireBoxMaintenance(opts.boxRoot, { reason: "migration", join: opts.withinMaintenance === true, ...(yielding ? { drainMs: YIELD_DRAIN_MS } : {}) });
  } catch (error) {
    // Live work outlasted the wait, or another maintenance owner (a deploy)
    // holds the box: both are the box being in use, not a failed check.
    if (yielding && error instanceof BoxMaintenanceError && error.reason === "timeout") return { status: "deferred", holders: await boxWorkHolders(opts.boxRoot) };
    if (yielding && error instanceof BoxMaintenanceError && error.holder !== undefined) return { status: "deferred", holders: [error.holder] };
    throw error;
  }
  const controller = new AbortController();
  const executionMs = opts.executionMs ?? 15 * 60_000;
  const timer = startAwakeTimeout({ timeoutMs: executionMs,
    periodMs: Math.min(5_000, Math.max(1, executionMs / 10)),
    onTimeout: () => controller.abort(new MigrationExecutionTimeoutError()) });
  const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
  const bounded = { ...opts, signal };
  try {
    const result = await maintenance.run(async () => {
      const outcome = await sweepUnderMaintenance(bounded, maintenance);
      signal.throwIfAborted();
      if (opts.refresh && ["current", "applied", "attention"].includes(outcome.status)) {
        await refreshGeneratedDocs({ boxRoot: opts.boxRoot, withinMaintenance: true });
      }
      signal.throwIfAborted();
      if (outcome.status !== "current") await checkPendingQuestionsAndNotify(opts.boxRoot, { now: new Date() });
      signal.throwIfAborted();
      return outcome;
    });
    signal.throwIfAborted();
    timer.stop();
    // A pending procedure is consistent: every script before it is committed
    // and the next unattended pass applies it. It serves, under deployment too.
    if (["attention", "applied", "current", "needs-procedure"].includes(result.status)) {
      if (opts.withinMaintenance && opts.prepare) await maintenance.prepare();
      await maintenance.complete();
    } else if (opts.withinMaintenance) {
      // An outer activation must not interpret a missing manifest or a failed
      // migration as ready.
      await maintenance.beginChanges();
    }
    return result;
  } finally {
    timer.stop();
    await maintenance.release();
  }
}

/** The parts of the owner handle a migration needs: to close before writing, and to prove ownership before committing. */
type Owner = Pick<BoxMaintenance, "beginChanges" | "held">;

async function sweepUnderMaintenance(opts: SweepOptions, owner: Owner): Promise<SweepResult> {
  opts.signal?.throwIfAborted();
  const { boxRoot } = opts;
  const manifest = await readManifest(boxRoot);
  if (manifest === null) return { status: "no-manifest" };

  const pending = computePending(manifest);
  if (pending.length === 0) {
    const questions = await migrationQuestions(boxRoot);
    return questions.length > 0 ? { status: "attention", questions, applied: [] } : { status: "current" };
  }

  const applied: SweptMigration[] = [];
  for (const migration of pending) {
    const result = await applyMigration(opts, { migration, applied, owner });
    if (result) return result;
  }

  const questions = await migrationQuestions(boxRoot);
  return questions.length > 0 ? { status: "attention", questions, applied } : { status: "applied", applied };
}

async function applyMigration(opts: SweepOptions, { migration, applied, owner }: { migration: Migration; applied: SweptMigration[]; owner: Owner }): Promise<SweepResult | null> {
  opts.signal?.throwIfAborted();
  const { boxRoot } = opts;
  if (isProcedureMigration(migration) && opts.runProcedure === undefined) {
    return { status: "needs-procedure", procedure: migration.name, applied };
  }
  await owner.beginChanges();
  const recovery = await captureMigrationSnapshot(boxRoot, migration.name);
  const baseline = await migrationOutputBaseline(boxRoot, recovery);
  const manifestBefore = await snapshotManifest(boxRoot);
  let failure = "";
  const verifyManifest = async (): Promise<void> => {
    if (await snapshotManifest(boxRoot) !== manifestBefore) {
      await restoreManifest(boxRoot, manifestBefore);
      invariant(false, "Repair changed the migration manifest; original restored");
    }
  };
  const run = async (): Promise<number> => {
    opts.signal?.throwIfAborted();
    await verifyManifest();
    return (opts.runScript ?? runMigrationScript)({ script: isProcedureMigration(migration) ? "" : migration.script, boxRoot,
      signal: opts.signal, diagnosticsToStderr: opts.json, onOutput: (text) => { failure = (failure + text).slice(-32000); } });
  };
  let repaired: Awaited<ReturnType<typeof repairMigration>> | undefined;
  const recordQuestion = async (): Promise<void> => {
    if (!repaired?.question) return;
    await stageAndCommitPaths(boxRoot, { paths: [repaired.question], message: `Migration ${migration.name}: repair decision`, trailers: { "Migration-Recovery": recovery.ref } });
    await finishMigrationRepair(boxRoot, migration.name);
  };
  const convert = async (): Promise<number> => {
    let code: number;
    if (isProcedureMigration(migration)) {
      const { runProcedure } = opts;
      invariant(runProcedure !== undefined, "Procedure callback required");
      const runOnce = (): Promise<number> => runProcedure(migration.procedure, { signal: opts.signal, onOutput: (text) => { failure = (failure + text).slice(-32000); } });
      if (opts.unattended) {
        // One run per human answer, never an hourly agent.
        repaired = await runProcedureMigration({ signal: opts.signal, boxRoot, name: migration.name, recoveryRef: recovery.ref, run: runOnce, output: () => failure });
        code = repaired.code;
      } else {
        code = await runOnce();
      }
    } else {
      code = await run();
    }
    if (code !== 0 && opts.repair && !isProcedureMigration(migration)) {
      repaired = await repairMigration({ signal: opts.signal, agent: opts.repairAgent, boxRoot, name: migration.name, recoveryRef: recovery.ref, failure, code, retry: run });
      code = repaired.code;
      await verifyManifest();
    }
    opts.signal?.throwIfAborted();
    return code;
  };
  const code = await convert();
  if (code === SOFT_FAILURE_EXIT && !repaired?.question) {
    return { status: "deferred-repair", failed: migration.name, recoveryRef: recovery.ref, applied };
  }
  if (code !== 0 && code !== SOFT_FAILURE_EXIT) {
    await recordQuestion();
    return { status: "failed", failed: migration.name, exitCode: code, question: repaired?.question, sessionId: repaired?.sessionId, recoveryRef: recovery.ref, applied };
  }

  let commitError = "";
  const commitOutput = async (): Promise<number> => {
    opts.signal?.throwIfAborted();
    // An owner whose lock went stale (a long sleep, or a parent controller
    // that died) no longer excludes ordinary work; its output stays under
    // the recovery ref instead of landing beside a concurrent writer's.
    if (!(await owner.held())) { commitError = OWNERSHIP_LOST; return 1; }
    const paths = [...new Set([...await changedMigrationPaths(boxRoot, baseline), MANIFEST_PATH])];
    try {
      await appendManifestEntry(boxRoot, { name: migration.name, "applied-at": getBoxTimeISO(boxRoot) });
      await stageAndCommitPaths(boxRoot, {
        paths,
        message: `Apply migration: ${migration.name}\n\nChanged paths may contain earlier edits; recovery preserves the pre-attempt state.`,
        trailers: { "Created-By": "migration-sweep", "Migration-Recovery": recovery.ref },
      });
      return 0;
    } catch (error) {
      await restoreManifest(boxRoot, manifestBefore);
      await restoreMigrationIndex(boxRoot, { snapshot: recovery, paths });
      commitError = errorMessage(error);
      return 1;
    }
  };
  // A lost owner lock is not a commit problem an agent can repair.
  const commitRepairable = (): boolean => commitError !== OWNERSHIP_LOST && opts.repair === true && !isProcedureMigration(migration);
  let committed = await commitOutput();
  opts.signal?.throwIfAborted();
  if (committed !== 0 && commitRepairable() && !repaired) {
    repaired = await repairMigration({ signal: opts.signal, agent: opts.repairAgent, boxRoot, name: migration.name, recoveryRef: recovery.ref,
      failure: commitError, code: 1, retry: async () => { const retry = await run(); return retry === 0 ? commitOutput() : retry; } });
    committed = repaired.code;
  }
  if (committed !== 0) {
    if (repaired && !repaired.question && commitRepairable()) repaired = await repairMigration({ signal: opts.signal, boxRoot, name: migration.name, recoveryRef: recovery.ref, failure: commitError, code: 1, retry: run });
    await recordQuestion();
    return { status: "commit-failed", failed: migration.name, error: commitError, question: repaired?.question, sessionId: repaired?.sessionId, recoveryRef: recovery.ref, applied };
  }
  await finishMigrationOutput(boxRoot, recovery);
  if (repaired) await finishMigrationRepair(boxRoot, migration.name);
  applied.push({ name: migration.name, partial: code === SOFT_FAILURE_EXIT, question: repaired?.question, sessionId: repaired?.sessionId });
  return null;
}
