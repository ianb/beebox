/**
 * `bbx migrate` — apply pending data migrations to the box.
 *
 * Compares the box's `config/migrations.jsonl` against the canonical
 * `MIGRATIONS` list in `src/core/migrations.ts`. Runs any pending
 * migrations in order, appending a manifest entry after each success.
 *
 * No auto-commit: the migrators leave their changes (plus the manifest
 * update) in the working tree. The user reviews and commits, normally
 * with `git commit -m "Apply migration X"`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { detectBoxTarget } from "../../core/box/package.js";
import {
  MIGRATIONS,
  MANIFEST_PATH,
  isProcedureMigration,
  type Migration,
  type ManifestEntry,
} from "../../core/migrations.js";
import { parseProcedureDefinition } from "../../schemas/procedure.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { getStatus, stageAll, commit } from "../../lib/git.js";
import { errorMessage } from "../../lib/error-guards.js";
import {
  appendManifestEntry,
  computePending,
  readManifest,
  runMigrationScript,
  writeManifest,
} from "../../core/migration-run.js";
import { sweepMigrations, type SweepResult, type SweptMigration } from "../../core/migration-sweep.js";
import { INCONCLUSIVE_EXIT_CODE } from "../../shared/inconclusive.js";
import { assertNever } from "../../lib/invariant.js";

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
  const defPath = path.join(args.boxRoot, "config/procedures", `${args.procedure}.procedure.card`);
  const content = await fs.readFile(defPath, "utf-8");
  const def = parseProcedureDefinition(content);
  const hasGate =
    def?.steps.some(
      (s) => s.validate?.severity === "abort" && (s.validate.shells?.length ?? 0) > 0,
    ) ?? false;
  if (!hasGate) throw new ProcedureGateError(args.procedure);
}

/** Fully provision the box (`bbx init`) before migrating. */
function runInit(boxRoot: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(BBX_BIN, ["init", boxRoot], { cwd: boxRoot, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Run an agent-applied (procedure) migration by delegating to `bbx procedure run`. */
function runProcedure(args: { procedure: string; boxRoot: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(BBX_BIN, ["procedure", "run", args.procedure], {
      cwd: args.boxRoot,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
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
}

/**
 * `--sweep`: report the outcome and pick an exit code.
 *
 * Quiet on the ordinary path — a box with nothing pending prints nothing, since
 * this runs across every box on every deploy and routine success is noise. The
 * exit code distinguishes "a human needs to look" (non-zero) from "converged or
 * legitimately nothing to do" (zero), so `deploy.sh` can report without failing
 * the deploy over one box.
 */
async function runSweep(boxRoot: string): Promise<number> {
  const result: SweepResult = await sweepMigrations({ boxRoot });
  switch (result.status) {
    case "current":
      return 0;
    case "no-manifest":
      console.warn(`No migration manifest at ${MANIFEST_PATH}; not migrating. Seed it with \`bbx migrate --mark-all-applied\` after confirming the box is up to date.`);
      return 1;
    case "skipped-dirty":
      console.warn(`Working tree is not clean; skipped ${String(result.pending.length)} pending migration(s): ${result.pending.join(", ")}. Commit or stash, and the next deploy will apply them.`);
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

export const migrateCommand = new Command("migrate")
  .description("Apply pending data migrations to this box")
  .option("--apply", "Run all pending migrations in order")
  .option("--status", "Show applied + pending lists (default when no flag given)")
  .option("--mark-all-applied", "Seed the manifest as if every known migration ran. Use only for legacy boxes that were already fully migrated before this command existed; new boxes get their manifest seeded automatically by `bbx init`.")
  .option("--mark-applied <name>", "Record a single migration as applied WITHOUT running it. For a box already in that migration's post-state (e.g. a retired migrator) that never got the manifest entry. Refuses an unknown name or a manifest-less box.")
  .option("--sweep", "Unattended mode, for `deploy.sh`: apply pending SCRIPT migrations and commit each one. Skips a dirty box, stops at a procedure-kind migration, prints nothing when the box is already current. Exits non-zero only when something needs a human.")
  .action(async (options: MigrateOptions) => {
    // `topPath` is the stable top-level directory `requireBoxRoot` found —
    // it never moves. `boxRoot` (the operational root) is re-resolved from it
    // after each migration in the apply loop below; historically the retired
    // `box-packageify` migration relocated the box (legacy → v2), so the
    // re-resolution stays as a safety net even though no current migration
    // moves the operational root.
    const topPath = await requireBoxRoot();
    let boxRoot = topPath;

    if (options.sweep === true) {
      process.exit(await runSweep(boxRoot));
    }

    if (options.markApplied !== undefined) {
      const name = options.markApplied;
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
      await writeManifest(boxRoot, entries);
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

    if (pending.length === 0) {
      console.log("Nothing to do — manifest is up to date.");
      return;
    }

    // Require a clean tree before migrating. `bbx init` (below) commits its
    // provisioning output so the queue starts clean, and several migrators
    // (e.g. `attachments`) refuse to run against a dirty tree. Checking up
    // front means init's commit captures exactly what init produced — not any
    // of the user's uncommitted work — and keeps the migration's own changes
    // reviewable rather than tangled with pre-existing edits.
    const startStatus = await getStatus(boxRoot);
    if (!startStatus.clean) {
      console.error("Working tree is not clean. Commit or stash your changes before migrating.");
      process.exit(1);
    }

    // Fully provision the box before migrating. A migration can depend on any
    // provisioned state — a procedure-kind migration needs its procedure card in
    // config/procedures/, but updated rules, guides, schemas, or briefing may
    // matter too — and running one against a partially-updated box risks the
    // silent-inconsistency class this whole discipline guards against. `bbx init`
    // is the canonical, complete provisioning (idempotent — a current box is a
    // near-no-op). Its template-sync commit is its own; the migration's data
    // changes still land uncommitted for review.
    console.log("Provisioning the box (bbx init) before migrating…\n");
    const initCode = await runInit(boxRoot);
    if (initCode !== 0) {
      console.error(`\nbbx init failed (exit ${String(initCode)}); not migrating. Fix provisioning first.`);
      process.exit(1);
    }
    console.log("");

    // Commit init's provisioning output so the queue starts from a clean tree.
    // The tree was clean before init (checked above), so this commits exactly
    // what init produced. The migrations' own data changes still land
    // uncommitted afterward, for review.
    const afterInit = await getStatus(boxRoot);
    if (!afterInit.clean) {
      await stageAll(boxRoot);
      await commit(boxRoot, { message: "bbx init provisioning (before migration)" });
      console.log("Committed provisioning changes.\n");
    }

    console.log(`Running ${String(pending.length)} pending migration(s) in order:\n`);
    // Exit-code convention shared by the harness and every migrator: 2 means
    // the migration ran but some individual cards couldn't be converted (left
    // unchanged) — a soft, per-card failure; 1 (or any other non-zero) means a
    // hard/precondition failure that should stop the sweep. A single malformed
    // card in a large box must not halt the whole migration, so a soft failure
    // records the migration as applied and continues; the unconverted cards are
    // printed above and surfaced by `bbx validate` for manual cleanup.
    const softFailures: string[] = [];
    for (const m of pending) {
      let code: number;
      if (isProcedureMigration(m)) {
        console.log(`=== ${m.name} (procedure: ${m.procedure}) ===`);
        try {
          await assertProcedureHasGate({ procedure: m.procedure, boxRoot });
        } catch (e) {
          console.error(`\n${errorMessage(e)}`);
          process.exit(1);
        }
        code = await runProcedure({ procedure: m.procedure, boxRoot });
      } else {
        console.log(`=== ${m.name} (${m.script}) ===`);
        code = await runMigrationScript({ script: m.script, boxRoot });
      }
      // A procedure migration whose work ran but whose review reached no
      // verdict is neither applied nor failed. Recording it as applied would
      // retire the migration on an unread check, so the manifest is left
      // alone and the sweep stops — nothing after it can assume this one
      // landed. Re-run once the run card's review question is answered.
      if (code === INCONCLUSIVE_EXIT_CODE) {
        console.error(
          `\nMigration "${m.name}" ran but its check reached no verdict (exit ${String(code)}). The work completed and is committed; nothing judged it. Manifest NOT updated for this entry, and subsequent migrations were not run — read the run card under procedure/runs/, then re-run \`bbx migrate\`.`,
        );
        process.exit(code);
      }
      if (code !== 0 && code !== 2) {
        console.error(`\nMigration "${m.name}" failed hard (exit code ${String(code)}). Manifest not updated for this entry. Subsequent migrations not run.`);
        process.exit(code);
      }
      // Re-derive the operational root from the stable top-level path before
      // touching the manifest, so the entry (and any FURTHER migration in this
      // same pass) targets the box's current location. A no-op today (no
      // migration moves the box), but retained as a safety net — the retired
      // `box-packageify` migration used to relocate legacy → v2 here.
      boxRoot = (await detectBoxTarget(topPath)).boxRoot;
      await appendManifestEntry(boxRoot, { name: m.name, "applied-at": new Date().toISOString() });
      if (code === 2) {
        softFailures.push(m.name);
        console.log(`⚠ ${m.name} applied with per-card failures (see above); continuing.\n`);
      } else {
        console.log(`✓ ${m.name} applied and recorded.\n`);
      }
    }
    if (softFailures.length > 0) {
      console.log(
        `All pending migrations ran. ${String(softFailures.length)} had per-card failures (some cards left unconverted): ${softFailures.join(", ")}.\nRun \`bbx validate\` to see the affected cards.`,
      );
    } else {
      console.log("All pending migrations applied.");
    }
  });
