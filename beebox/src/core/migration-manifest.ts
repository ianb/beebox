/**
 * Read-only access to a box's migration manifest (`_config/migrations.jsonl`).
 *
 * Split from `migration-run.ts`, which imports migration execution, so code
 * that only asks "has this box run migration X?" (the instruction-file
 * resolver, the validate hook) does not load the runner.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isRecord } from "../shared/is-record.js";
import { errnoCode } from "../shared/error-guards.js";
import { MANIFEST_PATH, type ManifestEntry } from "./migrations.js";

class ManifestReadError extends Error {
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

/** Whether the box's manifest records migration `name`. */
export async function hasAppliedMigration(boxRoot: string, name: string): Promise<boolean> {
  const entries = await readManifest(boxRoot);
  return entries?.some((entry) => entry.name === name) ?? false;
}
