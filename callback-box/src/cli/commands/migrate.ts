/**
 * `cb migrate` — apply pending data migrations to the box.
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
import { requireBoxRoot } from "../lib/paths.js";
import {
  MIGRATIONS,
  MANIFEST_PATH,
  isProcedureMigration,
  type Migration,
  type ManifestEntry,
} from "../../core/migrations.js";
import { parseProcedureDefinition } from "../../schemas/procedure.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

const CALLBACK_BOX_ROOT = PACKAGE_ROOT;
const CB_BIN = path.join(CALLBACK_BOX_ROOT, "bin", "cb");

/** A procedure used as a migration lacks the required machine-checkable gate. */
class ProcedureGateError extends Error {
  constructor(procedure: string) {
    super(
      `procedure migration "${procedure}" has no step with validate.shells + severity:abort. ` +
        "An agent migration must be machine-verified (validate.instructions is a no-op and an " +
        "agent that does nothing still 'completes' the step), so cb migrate refuses to run a " +
        "gateless procedure. See docs/plans/agent-applied-migrations.md.",
    );
    this.name = "ProcedureGateError";
  }
}

class ManifestReadError extends Error {
  readonly manifestPath: string;
  constructor(manifestPath: string, cause: unknown) {
    super(`failed to read migration manifest: ${manifestPath}`, { cause });
    this.name = "ManifestReadError";
    this.manifestPath = manifestPath;
  }
}

async function readManifest(boxRoot: string): Promise<ManifestEntry[] | null> {
  const abs = path.join(boxRoot, MANIFEST_PATH);
  try {
    const text = await fs.readFile(abs, "utf-8");
    const entries: ManifestEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      entries.push(JSON.parse(trimmed) as ManifestEntry);
    }
    return entries;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw new ManifestReadError(abs, e);
  }
}

async function appendManifestEntry(boxRoot: string, entry: ManifestEntry): Promise<void> {
  const abs = path.join(boxRoot, MANIFEST_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.appendFile(abs, `${JSON.stringify(entry)}\n`);
}

async function writeManifest(boxRoot: string, entries: ManifestEntry[]): Promise<void> {
  const abs = path.join(boxRoot, MANIFEST_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const text = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
  await fs.writeFile(abs, text);
}

function computePending(applied: ManifestEntry[]): Migration[] {
  const seen = new Set(applied.map((e) => e.name));
  return MIGRATIONS.filter((m) => !seen.has(m.name));
}

function runScript(args: { script: string; boxRoot: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(CALLBACK_BOX_ROOT, args.script);
    const child = spawn(
      "npx",
      ["tsx", scriptPath, args.boxRoot, "--apply"],
      { cwd: CALLBACK_BOX_ROOT, stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * A procedure used as a migration must end in a hard, machine-checkable gate: a
 * step with `validate.shells` and `severity: abort`. Without it the engine marks
 * the run completed even if the agent did nothing real, so cb migrate would
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

/** Fully provision the box (`cb init`) before migrating. */
function runInit(boxRoot: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(CB_BIN, ["init", boxRoot], { cwd: boxRoot, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Run an agent-applied (procedure) migration by delegating to `cb procedure run`. */
function runProcedure(args: { procedure: string; boxRoot: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(CB_BIN, ["procedure", "run", args.procedure], {
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
}

export const migrateCommand = new Command("migrate")
  .description("Apply pending data migrations to this box")
  .option("--apply", "Run all pending migrations in order")
  .option("--status", "Show applied + pending lists (default when no flag given)")
  .option("--mark-all-applied", "Seed the manifest as if every known migration ran. Use only for legacy boxes that were already fully migrated before this command existed; new boxes get their manifest seeded automatically by `cb init`.")
  .action(async (options: MigrateOptions) => {
    const boxRoot = await requireBoxRoot();

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
        `No migration manifest at ${MANIFEST_PATH}.\n\nThis box predates the cb migrate command. If it has already had all data migrations applied, seed the manifest with:\n  cb migrate --mark-all-applied\n\nNew boxes (via cb init) get their manifest automatically.`,
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

    // Fully provision the box before migrating. A migration can depend on any
    // provisioned state — a procedure-kind migration needs its procedure card in
    // config/procedures/, but updated rules, guides, schemas, or briefing may
    // matter too — and running one against a partially-updated box risks the
    // silent-inconsistency class this whole discipline guards against. `cb init`
    // is the canonical, complete provisioning (idempotent — a current box is a
    // near-no-op). Its template-sync commit is its own; the migration's data
    // changes still land uncommitted for review.
    console.log("Provisioning the box (cb init) before migrating…\n");
    const initCode = await runInit(boxRoot);
    if (initCode !== 0) {
      console.error(`\ncb init failed (exit ${String(initCode)}); not migrating. Fix provisioning first.`);
      process.exit(1);
    }
    console.log("");

    console.log(`Running ${String(pending.length)} pending migration(s) in order:\n`);
    // Exit-code convention shared by the harness and every migrator: 2 means
    // the migration ran but some individual cards couldn't be converted (left
    // unchanged) — a soft, per-card failure; 1 (or any other non-zero) means a
    // hard/precondition failure that should stop the sweep. A single malformed
    // card in a large box must not halt the whole migration, so a soft failure
    // records the migration as applied and continues; the unconverted cards are
    // printed above and surfaced by `cb validate` for manual cleanup.
    const softFailures: string[] = [];
    for (const m of pending) {
      let code: number;
      if (isProcedureMigration(m)) {
        console.log(`=== ${m.name} (procedure: ${m.procedure}) ===`);
        try {
          await assertProcedureHasGate({ procedure: m.procedure, boxRoot });
        } catch (e) {
          console.error(`\n${(e as Error).message}`);
          process.exit(1);
        }
        code = await runProcedure({ procedure: m.procedure, boxRoot });
      } else {
        console.log(`=== ${m.name} (${m.script}) ===`);
        code = await runScript({ script: m.script, boxRoot });
      }
      if (code !== 0 && code !== 2) {
        console.error(`\nMigration "${m.name}" failed hard (exit code ${String(code)}). Manifest not updated for this entry. Subsequent migrations not run.`);
        process.exit(code);
      }
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
        `All pending migrations ran. ${String(softFailures.length)} had per-card failures (some cards left unconverted): ${softFailures.join(", ")}.\nRun \`cb validate\` to see the affected cards.`,
      );
    } else {
      console.log("All pending migrations applied.");
    }
  });
