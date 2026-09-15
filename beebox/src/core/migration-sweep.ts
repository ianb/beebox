import { startAwakeTimeout } from "../lib/awake-timeout.js";
import { refreshGeneratedDocs } from "./docs-refresh.js";
import type { Agent } from "./agent/types.js";
import { repairMigration, finishMigrationRepair, migrationQuestions } from "./migration-repair.js";
import { checkPendingQuestionsAndNotify } from "./question-alert.js";
import { stageAndCommitPaths } from "../lib/git.js";
import { captureMigrationSnapshot, changedMigrationPaths, restoreMigrationIndex, migrationOutputBaseline, finishMigrationOutput } from "./migration-recovery.js";
import { acquireBoxMaintenance } from "../lib/box-maintenance.js";
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

/** One migration the sweep ran, and how it went. */
export interface SweptMigration {
  readonly name: string;
  /** A soft failure: applied and recorded, but some cards could not be converted. */
  readonly partial: boolean;
  readonly question?: string | undefined;
  readonly sessionId?: string | undefined;
}

export type SweepResult =
  /** No manifest — the box predates `bbx migrate` and needs an explicit human decision. */
  | { readonly status: "no-manifest" }
  /** Nothing pending. The common case, and the quiet one. */
  | { readonly status: "current" }
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
  runProcedure?: ((procedure: string, signal?: AbortSignal) => Promise<number>) | undefined;
  json?: boolean | undefined;
  repair?: boolean | undefined;
  withinMaintenance?: boolean | undefined;
  prepare?: boolean | undefined;
  runScript?: typeof runMigrationScript;
  repairAgent?: Agent;
}

/** One application path for manual and unattended migration. */
export async function sweepMigrations(opts: SweepOptions): Promise<SweepResult> {
  const maintenance = await acquireBoxMaintenance(opts.boxRoot, { reason: "migration", recover: opts.repair === true, join: opts.withinMaintenance === true });
  const controller = new AbortController();
  const executionMs = opts.executionMs ?? 15 * 60_000;
  const timer = startAwakeTimeout({ timeoutMs: executionMs,
    periodMs: Math.min(5_000, Math.max(1, executionMs / 10)),
    onTimeout: () => controller.abort(new MigrationExecutionTimeoutError()) });
  const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
  const bounded = { ...opts, signal };
  try {
    const result = await maintenance.run(async () => {
      const outcome = await sweepUnderMaintenance(bounded, () => maintenance.beginChanges());
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
    if (result.status === "attention" || result.status === "applied" || result.status === "current") {
      if (opts.withinMaintenance && opts.prepare) await maintenance.prepare();
      await maintenance.complete();
    } else if (opts.withinMaintenance) {
      // An outer activation must not interpret an unmet prerequisite as ready.
      await maintenance.beginChanges();
    }
    return result;
  } finally {
    timer.stop();
    await maintenance.release();
  }
}

async function sweepUnderMaintenance(opts: SweepOptions, beginChanges: () => Promise<void>): Promise<SweepResult> {
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
    const result = await applyMigration(opts, { migration, applied, beginChanges });
    if (result) return result;
  }

  const questions = await migrationQuestions(boxRoot);
  return questions.length > 0 ? { status: "attention", questions, applied } : { status: "applied", applied };
}

async function applyMigration(opts: SweepOptions, { migration, applied, beginChanges }: { migration: Migration; applied: SweptMigration[]; beginChanges: () => Promise<void> }): Promise<SweepResult | null> {
  opts.signal?.throwIfAborted();
  const { boxRoot } = opts;
  if (isProcedureMigration(migration) && opts.runProcedure === undefined) {
    return { status: "needs-procedure", procedure: migration.name, applied };
  }
  await beginChanges();
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
      invariant(opts.runProcedure !== undefined, "Procedure callback required");
      code = await opts.runProcedure(migration.procedure, opts.signal);
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
  let committed = await commitOutput();
  opts.signal?.throwIfAborted();
  if (committed !== 0 && opts.repair && !repaired && !isProcedureMigration(migration)) {
    repaired = await repairMigration({ signal: opts.signal, agent: opts.repairAgent, boxRoot, name: migration.name, recoveryRef: recovery.ref,
      failure: commitError, code: 1, retry: async () => { const retry = await run(); return retry === 0 ? commitOutput() : retry; } });
    committed = repaired.code;
  }
  if (committed !== 0) {
    if (repaired && !repaired.question) repaired = await repairMigration({ signal: opts.signal, boxRoot, name: migration.name, recoveryRef: recovery.ref, failure: commitError, code: 1, retry: run });
    await recordQuestion();
    return { status: "commit-failed", failed: migration.name, error: commitError, question: repaired?.question, sessionId: repaired?.sessionId, recoveryRef: recovery.ref, applied };
  }
  await finishMigrationOutput(boxRoot, recovery);
  if (repaired) await finishMigrationRepair(boxRoot, migration.name);
  applied.push({ name: migration.name, partial: code === SOFT_FAILURE_EXIT, question: repaired?.question, sessionId: repaired?.sessionId });
  return null;
}
