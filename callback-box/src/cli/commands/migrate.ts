/**
 * `cb migrate` — apply pending data migrations to the box.
 *
 * Compares the box's `config/.migrations.jsonl` against the canonical
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
  type Migration,
  type ManifestEntry,
} from "../../core/migrations.js";

const CALLBACK_BOX_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

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
    throw e;
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

    console.log(`Running ${String(pending.length)} pending migration(s) in order:\n`);
    for (const m of pending) {
      console.log(`=== ${m.name} (${m.script}) ===`);
      const code = await runScript({ script: m.script, boxRoot });
      if (code !== 0) {
        console.error(`\nMigration "${m.name}" failed (exit code ${String(code)}). Manifest not updated for this entry. Subsequent migrations not run.`);
        process.exit(code);
      }
      await appendManifestEntry(boxRoot, { name: m.name, "applied-at": new Date().toISOString() });
      console.log(`✓ ${m.name} applied and recorded.\n`);
    }
    console.log("All pending migrations applied.");
  });
