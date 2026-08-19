/**
 * The migration manifest and the script runner — the pieces shared by
 * interactive `cb migrate` (`cli/commands/migrate.ts`) and the unattended
 * deploy sweep (`core/migration-sweep.ts`).
 *
 * They lived in the CLI command until the sweep needed them. Nothing here
 * decides policy: what to do about a dirty tree, whether to commit, whether a
 * procedure-kind migration may run — those differ between the two callers and
 * live with each of them.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { isRecord } from "../lib/is-record.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { errnoCode } from "../lib/error-guards.js";
import { MANIFEST_PATH, MIGRATIONS, type ManifestEntry, type Migration } from "./migrations.js";

export class ManifestReadError extends Error {
  readonly manifestPath: string;
  constructor(manifestPath: string, cause: unknown) {
    super(`failed to read migration manifest: ${manifestPath}`, { cause });
    this.name = "ManifestReadError";
    this.manifestPath = manifestPath;
  }
}

/** A manifest line is a valid {@link ManifestEntry} with string `name` + `applied-at`. */
function isManifestEntry(value: unknown): value is ManifestEntry {
  return isRecord(value) && typeof value["name"] === "string" && typeof value["applied-at"] === "string";
}

/** Every recorded entry, or null when the box has no manifest at all. */
export async function readManifest(boxRoot: string): Promise<ManifestEntry[] | null> {
  const abs = path.join(boxRoot, MANIFEST_PATH);
  try {
    const text = await fs.readFile(abs, "utf-8");
    const entries: ManifestEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const parsed: unknown = JSON.parse(trimmed);
      if (isManifestEntry(parsed)) entries.push(parsed);
    }
    return entries;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw new ManifestReadError(abs, e);
  }
}

export async function appendManifestEntry(boxRoot: string, entry: ManifestEntry): Promise<void> {
  const abs = path.join(boxRoot, MANIFEST_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.appendFile(abs, `${JSON.stringify(entry)}\n`);
}

export async function writeManifest(boxRoot: string, entries: ManifestEntry[]): Promise<void> {
  const abs = path.join(boxRoot, MANIFEST_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const text = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
  await fs.writeFile(abs, text);
}

/** Registered migrations this box has not recorded, in registry order. */
export function computePending(applied: ManifestEntry[]): Migration[] {
  const seen = new Set(applied.map((e) => e.name));
  return MIGRATIONS.filter((m) => !seen.has(m.name));
}

/**
 * Run one migrator script against a box.
 *
 * Exit-code convention shared with the harness and every migrator: 0 success,
 * 2 means the migration ran but some individual cards could not be converted
 * (a soft, per-card failure — record it and continue; the cards are printed and
 * `cb validate` surfaces them), anything else is a hard failure that stops the
 * queue.
 */
export function runMigrationScript(args: { script: string; boxRoot: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PACKAGE_ROOT, args.script);
    const child = spawn(
      "npx",
      ["tsx", scriptPath, args.boxRoot, "--apply"],
      { cwd: PACKAGE_ROOT, stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** A soft (per-card) failure records the migration and continues; see {@link runMigrationScript}. */
export const SOFT_FAILURE_EXIT = 2;
