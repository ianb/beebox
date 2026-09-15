/**
 * `bbx migrate` — apply pending data migrations to the box.
 *
 * Compares the box's `_config/migrations.jsonl` against the canonical
 * `MIGRATIONS` list in `src/core/migrations.ts`. Runs any pending
 * migrations in order, appending a manifest entry after each success.
 *
 * Manual and unattended application share the recovery-backed core runner.
 */

import { boxWorkEnvironment, withBoxWork } from "../../lib/box-maintenance.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runMigrationProcess } from "../../core/migration-process.js";
import { Command, Option } from "commander";
import { findBoxRoot, NotInBoxError, getBoxDir } from "../../lib/paths.js";
import {
  MIGRATIONS,
  MANIFEST_PATH,
  type Migration,
  type ManifestEntry,
} from "../../core/migrations.js";
import { installProcedures, installGuides } from "../../core/box/index.js";
import { parseProcedureDefinition } from "../../schemas/procedure.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import {
  appendManifestEntry,
  computePending,
  readManifest,
  writeManifest,
} from "../../core/migration-run.js";
import { migrationQuestions } from "../../core/migration-repair.js";
import { sweepMigrations, type SweepResult, type SweptMigration } from "../../core/migration-sweep.js";
import { assertNever } from "../../lib/invariant.js";
import { findV2Box, runBootstrap } from "./migrate-bootstrap.js";

const BEEBOX_ROOT = PACKAGE_ROOT;
const BBX_BIN = path.join(BEEBOX_ROOT, "bin", "bbx");

/** A procedure used as a migration lacks the required machine-checkable gate. */
class ProcedureGateError extends Error {
  constructor(procedure: string) {
    super(
      `procedure migration "${procedure}" has no step with validate.shells + severity:abort. ` +
        "An agent migration must be machine-verified (validate.instructions is a no-op and an " +
        "agent that does nothing still 'completes' the step), so bbx migrate refuses to run a " +
        "gateless procedure. See docs/plans/agent-applied-migrations.md.",
    );
    this.name = "ProcedureGateError";
  }
}

export type MarkAppliedResult =
  | { status: "marked" }
  | { status: "already-applied" }
  | { status: "unknown-migration" }
  | { status: "no-manifest" };

/**
 * Record a single migration as applied WITHOUT running it. The escape hatch for
 * a box that's already in a migration's post-state but never got the manifest
 * entry — e.g. a retired migrator (`bill`) that can no longer run, or a box that
 * had a migration's effect applied out-of-band. Unlike `--mark-all-applied`
 * (which seeds a whole missing manifest) this touches one entry on a box that
 * already has a manifest. Refuses an unknown name or a missing manifest; a
 * no-op if the migration is already recorded.
 */
export async function markMigrationApplied(args: { boxRoot: string; name: string }): Promise<MarkAppliedResult> {
  if (!MIGRATIONS.some((m) => m.name === args.name)) return { status: "unknown-migration" };
  const existing = await readManifest(args.boxRoot);
  if (existing === null) return { status: "no-manifest" };
  if (existing.some((e) => e.name === args.name)) return { status: "already-applied" };
  await appendManifestEntry(args.boxRoot, { name: args.name, "applied-at": new Date().toISOString() });
  return { status: "marked" };
}

/**
 * A procedure used as a migration must end in a hard, machine-checkable gate: a
 * step with `validate.shells` and `severity: abort`. Without it the engine marks
 * the run completed even if the agent did nothing real, so bbx migrate would
 * record a false "applied". Refuse instead. Throws ProcedureGateError.
 */
async function assertProcedureHasGate(args: { procedure: string; boxRoot: string }): Promise<void> {
  const defPath = path.join(getBoxDir(args.boxRoot, "procedures"), `${args.procedure}.procedure.card`);
  const content = await fs.readFile(defPath, "utf-8");
  const def = parseProcedureDefinition(content);
  const hasGate =
    def?.steps.some(
      (s) => s.validate?.severity === "abort" && (s.validate.shells?.length ?? 0) > 0,
    ) ?? false;
  if (!hasGate) throw new ProcedureGateError(args.procedure);
}

/** Run an agent-applied (procedure) migration by delegating to `bbx procedure run`. */
function runProcedure(args: { procedure: string; boxRoot: string; json?: boolean | undefined; signal?: AbortSignal | undefined }): Promise<number> {
  return runMigrationProcess({
    file: BBX_BIN, args: ["procedure", "run", args.procedure], cwd: args.boxRoot,
    env: { ...process.env, ...boxWorkEnvironment() }, diagnosticsToStderr: args.json, signal: args.signal,
  });
}

function formatStatus(applied: ManifestEntry[], pending: Migration[]): string {
  const lines: string[] = [];
  lines.push(`Applied (${String(applied.length)}):`);
  for (const e of applied) {
    lines.push(`  ✓ ${e.name}  (${e["applied-at"]})`);
  }
  if (applied.length === 0) lines.push("  (none)");
  lines.push("");
  lines.push(`Pending (${String(pending.length)}):`);
  for (const m of pending) {
    lines.push(`  • ${m.name}`);
  }
  if (pending.length === 0) lines.push("  (none — manifest is up to date)");
  return lines.join("\n");
}

interface MigrateOptions {
  apply?: boolean;
  status?: boolean;
  markAllApplied?: boolean;
  markApplied?: string;
  sweep?: boolean;
  json?: boolean;
  repair?: boolean;
  withinMaintenance?: boolean;
  prepare?: boolean;
}

/**
 * `--sweep`: report the outcome and pick an exit code.
 *
 * Quiet on the ordinary path — a box with nothing pending prints nothing, since
 * this runs across every box on every deploy and routine success is noise. The
 * exit code distinguishes blocked maintenance (non-zero) from a box ready to
 * serve (zero). An applied migration with an open question still serves; JSON
 * status and the warning retain that human follow-up.
 */
async function runSweep(boxRoot: string, options: MigrateOptions): Promise<number> {
  const result: SweepResult = await sweepMigrations({
    boxRoot,
    refresh: true,
    json: options.json,
    repair: options.repair ?? options.apply,
    withinMaintenance: options.withinMaintenance,
    prepare: options.prepare,
    runProcedure: options.apply ? async (procedure, signal) => {
      await installProcedures(boxRoot);
      await installGuides(boxRoot);
      await assertProcedureHasGate({ procedure, boxRoot });
      return runProcedure({ procedure, boxRoot, json: options.json, signal });
    } : undefined,
  });
  if (options.json) {
    console.log(JSON.stringify(result));
    return result.status === "current" || result.status === "applied" || result.status === "attention" ? 0 : 1;
  }
  switch (result.status) {
    case "attention":
      reportApplied(result.applied);
      console.warn(`Migration questions need attention: ${result.questions.join(", ")}`);
      return 0;
    case "current":
      return 0;
    case "no-manifest":
      console.warn(`No migration manifest at ${MANIFEST_PATH}; not migrating. Seed it with \`bbx migrate --mark-all-applied\` after confirming the box is up to date.`);
      return 1;
    case "deferred-repair":
      reportApplied(result.applied);
      console.warn(`Migration "${result.failed}" needs repair; later migrations remain pending. Recover input from ${result.recoveryRef}.`);
      return 1;
    case "needs-procedure":
      reportApplied(result.applied);
      console.warn(`Stopped at "${result.procedure}": procedure-kind migrations drive an agent and are not run unattended. Apply it with \`bbx migrate --apply\`.`);
      return 1;
    case "failed":
      reportApplied(result.applied);
      console.error(`Migration "${result.failed}" failed hard (exit ${String(result.exitCode)}). Its manifest entry was not written; later migrations did not run.`);
      return 1;
    case "commit-failed":
      reportApplied(result.applied);
      console.error(`Migration "${result.failed}" ran but could not be committed (${result.error}). Its manifest entry was rolled back and its changes are left in the working tree — review them, commit or discard, and the next sweep retries.`);
      return 1;
    case "applied":
      reportApplied(result.applied);
      return 0;
    default:
      return assertNever(result);
  }
}

function reportApplied(applied: SweptMigration[]): void {
  for (const m of applied) {
    console.log(`Applied migration: ${m.name}${m.partial ? " (some cards could not be converted — see above)" : ""}`);
  }
}

/** Handle `--mark-applied <name>`. Split out of the action purely to keep its complexity down. */
async function handleMarkApplied(boxRoot: string, name: string): Promise<void> {
  const result = await markMigrationApplied({ boxRoot, name });
  switch (result.status) {
    case "unknown-migration":
      console.error(`Unknown migration "${name}". It must match a name in src/core/migrations.ts (see \`bbx migrate --status\`).`);
      process.exit(1);
    // falls through to exit — process.exit returns never
    case "no-manifest":
      console.error(`No migration manifest at ${MANIFEST_PATH}. Seed it with \`bbx migrate --mark-all-applied\` (or \`bbx init\`) first, then mark individual migrations.`);
      process.exit(1);
    // falls through to exit — process.exit returns never
    case "already-applied":
      console.log(`"${name}" is already recorded as applied in ${MANIFEST_PATH}; nothing to do.`);
      break;
    case "marked":
      console.log(`Marked "${name}" as applied in ${MANIFEST_PATH} (did NOT run it). Review the manifest change and commit it.`);
      break;
  }
}

/**
 * Resolve the box's top-level directory, or run (and fully handle) the v2
 * bootstrap conversion and return `null` when this turns out to be a v2 box.
 * Split out of the action purely to keep its complexity down.
 */
async function resolveTopPathOrBootstrap(options: MigrateOptions): Promise<string | null> {
  let topPath: string;
  try {
    const found = await findBoxRoot(process.cwd());
    if (!found) throw new NotInBoxError();
    topPath = found;
  } catch (e) {
    // No marker found walking up from cwd at all — the common case for a v2
    // box invoked from its package root (the marker is nested at content/,
    // which findBoxRoot doesn't look inside). Try the v2 probe before giving up.
    const v2Box = await findV2Box(null);
    if (v2Box === null) throw e;
    await runBootstrap(v2Box, options);
    return null;
  }

  // requireBoxRoot found A marker, but it may be the nested v2 one (e.g.
  // invoked from inside content/ itself) — the normal manifest-driven flow
  // below can't read a v2 box's manifest, so check for that case here.
  const v2Box = await findV2Box(topPath);
  if (v2Box !== null) {
    await runBootstrap(v2Box, options);
    return null;
  }
  return topPath;
}

export const migrateCommand = new Command("migrate")
  .description("Apply pending data migrations to this box")
  .option("--apply", "Run all pending migrations in order")
  .option("--status", "Show applied + pending lists (default when no flag given)")
  .option("--mark-all-applied", "Seed the manifest as if every known migration ran. Use only for legacy boxes that were already fully migrated before this command existed; new boxes get their manifest seeded automatically by `bbx init`.")
  .option("--mark-applied <name>", "Record a single migration as applied WITHOUT running it. For a box already in that migration's post-state (e.g. a retired migrator) that never got the manifest entry. Refuses an unknown name or a manifest-less box.")
  .option("--sweep", "Apply and commit pending scripts with Git recovery; defer agent work")
  .addOption(new Option("--within-maintenance", "Join the calling maintenance transaction").hideHelp())
  .addOption(new Option("--prepare", "Declare startup readiness after final convergence").hideHelp())
  .option("--repair", "Allow one bounded agent repair after migration failure")
  .option("--json", "Report the application result as JSON")
  .action(async (options: MigrateOptions) => {
    // `topPath` is the stable top-level directory `requireBoxRoot` found —
    // it never moves. `boxRoot` (the operational root) is re-resolved from it
    // after each migration in the apply loop below; historically the retired
    // `box-packageify` migration relocated the box (legacy → v2), so the
    // re-resolution stays as a safety net even though no current migration
    // moves the operational root. A v2 box is fully handled (and reported)
    // inside the resolver, which returns null for that case.
    if (options.status && options.json) {
      const root = await findBoxRoot(process.cwd());
      if (!root) throw new NotInBoxError();
      const manifest = await readManifest(root);
      console.log(JSON.stringify({ status: "status", manifest: manifest !== null,
        pending: manifest === null ? [] : computePending(manifest).map((migration) => migration.name),
        questions: await migrationQuestions(root) }));
      return;
    }
    const topPath = await resolveTopPathOrBootstrap(options);
    if (topPath === null) return;

    const boxRoot = topPath;

    if (options.sweep === true || (options.apply === true && options.status !== true)) {
      process.exitCode = await runSweep(boxRoot, options);
      return;
    }

    if (options.markApplied !== undefined) {
      const name = options.markApplied;
      await withBoxWork({ boxRoot, reason: "mark applied" }, () => handleMarkApplied(boxRoot, name));
      return;
    }

    if (options.markAllApplied) {
      const existing = await readManifest(boxRoot);
      if (existing !== null && existing.length > 0) {
        console.error(
          `Manifest already exists at ${MANIFEST_PATH} with ${String(existing.length)} entries; --mark-all-applied refuses to overwrite. Delete the file if you really want to reseed.`,
        );
        process.exit(1);
      }
      const now = new Date().toISOString();
      const entries: ManifestEntry[] = MIGRATIONS.map((m) => ({
        name: m.name,
        "applied-at": now,
      }));
      await withBoxWork({ boxRoot, reason: "mark all applied" }, () => writeManifest(boxRoot, entries));
      console.log(`Wrote ${String(entries.length)} entries to ${MANIFEST_PATH} (no migrations actually ran).`);
      return;
    }

    const applied = await readManifest(boxRoot);
    if (applied === null) {
      console.error(
        `No migration manifest at ${MANIFEST_PATH}.\n\nThis box predates the bbx migrate command. If it has already had all data migrations applied, seed the manifest with:\n  bbx migrate --mark-all-applied\n\nNew boxes (via bbx init) get their manifest automatically.`,
      );
      process.exit(1);
    }
    const pending = computePending(applied);

    if (!options.apply || options.status) {
      console.log(formatStatus(applied, pending));
      return;
    }

  });
