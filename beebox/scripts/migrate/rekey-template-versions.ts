#!/usr/bin/env tsx

/**
 * Re-key the template tracker (`_config/template-versions.json`) onto v3 paths.
 *
 * The tracker records the stock hash `installTemplateFile` last installed for
 * each template, keyed by box-relative path. The one-root migration moved the
 * files (`config/procedures/X` to `_config/procedures/X`) without renaming the
 * keys, so a lookup under the v3 path finds nothing, the box reads as
 * untracked, and every changed template parks under `_config/_template-updates/`
 * instead of installing
 * (`issues/bugs/2026-09-19-template-tracker-keys-not-migrated-to-one-root.md`).
 *
 * Each key is decided by what is on disk, not by its spelling:
 *
 * - The file exists at the key → keep it. This is what protects `src/…` keys,
 *   which are already v3: {@link mapV2Path} is content-relative and would send
 *   `src/views/CLAUDE.md` to `_content/src/views/CLAUDE.md`.
 * - The file is missing and the key maps to a path that exists → re-key. When
 *   both keys are present the later `installed-at` wins, since that is the
 *   install the file on disk came from.
 * - Otherwise → drop. The entry tracks a file the box does not have (including
 *   a key that escapes the box, which field trackers carry), so it can
 *   only produce a wrong answer; a template installed there later is recorded
 *   fresh.
 *
 * This does not make a drifted file install cleanly: where an automated rewrite
 * (a migration, the rename) changed a template's bytes without updating the
 * tracker, the recorded hash no longer matches the file and the installer still
 * reads it as a boxholder edit. That is the second half of the issue and a
 * separate decision.
 *
 * Idempotent: a box whose keys are all v3 is a clean no-op.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/rekey-template-versions.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/rekey-template-versions.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { errnoCode } from "../../src/lib/error-guards.js";
import { isRecord } from "../../src/lib/is-record.js";
import { mapV2Path } from "../../src/core/migrations/one-root-mapping.js";

const TRACKER_REL = "_config/template-versions.json";

interface TrackerEntry {
  sha256: string;
  "installed-at": string;
}

export interface RekeyResult {
  /** `oldKey -> newKey` for every entry moved. */
  rekeyed: Record<string, string>;
  /** Keys dropped because they track a file the box does not have. */
  dropped: string[];
}

function entryOf(value: unknown): TrackerEntry | null {
  if (!isRecord(value)) return null;
  const sha256 = value["sha256"];
  const installedAt = value["installed-at"];
  if (typeof sha256 !== "string" || typeof installedAt !== "string") return null;
  return { sha256, "installed-at": installedAt };
}

/**
 * Does `relKey` name a file inside the box?
 *
 * Fail-closed on a key that escapes the box: field trackers carry keys like
 * `../src/views/CLAUDE.md`, and joining one onto the box root reaches a real
 * file in the checkout above. Such an entry tracks nothing the box owns, so it
 * is not "present" and is dropped.
 */
async function existsInBox(boxRoot: string, relKey: string): Promise<boolean> {
  const abs = path.resolve(boxRoot, relKey);
  if (abs !== boxRoot && !abs.startsWith(boxRoot + path.sep)) return false;
  try {
    await fs.access(abs);
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
}

/** Which of two entries for one path to keep: the later install wrote the file on disk. */
function later(a: TrackerEntry, b: TrackerEntry): TrackerEntry {
  return a["installed-at"] >= b["installed-at"] ? a : b;
}

/**
 * Re-key one box's tracker. Pure of process concerns (no argv, no exit) so it
 * doctests directly. With `apply: false` it reports what it WOULD do.
 */
export async function rekeyTemplateVersions(
  { boxRoot, apply }: { boxRoot: string; apply: boolean },
): Promise<RekeyResult> {
  const result: RekeyResult = { rekeyed: {}, dropped: [] };
  let raw: string;
  try {
    raw = await fs.readFile(path.join(boxRoot, TRACKER_REL), "utf-8");
  } catch (e) {
    // No tracker: nothing recorded, nothing to re-key.
    if (errnoCode(e) === "ENOENT") return result;
    throw e;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return result;

  const next = new Map<string, TrackerEntry>();
  const keep = async (key: string, entry: TrackerEntry): Promise<void> => {
    const current = next.get(key);
    next.set(key, current === undefined ? entry : later(current, entry));
  };

  for (const [key, value] of Object.entries(parsed)) {
    const entry = entryOf(value);
    if (entry === null) continue;
    if (await existsInBox(boxRoot, key)) {
      await keep(key, entry);
      continue;
    }
    const mapped = mapV2Path(key);
    if (mapped.kind === "move" && (await existsInBox(boxRoot, mapped.newPath))) {
      await keep(mapped.newPath, entry);
      result.rekeyed[key] = mapped.newPath;
      continue;
    }
    result.dropped.push(key);
  }

  if (Object.keys(result.rekeyed).length === 0 && result.dropped.length === 0) return result;
  if (apply) {
    const sorted: Record<string, TrackerEntry> = {};
    for (const key of [...next.keys()].toSorted()) {
      const entry = next.get(key);
      if (entry !== undefined) sorted[key] = entry;
    }
    await fs.writeFile(path.join(boxRoot, TRACKER_REL), JSON.stringify(sorted, null, 2) + "\n");
  }
  return result;
}

// CLI entry — only when run directly, not when imported by a doctest.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error(
      `Usage: ${process.argv[1]} <boxRoot> [--apply]\n\n` +
        "Re-key _config/template-versions.json onto v3 paths.",
    );
    process.exit(1);
  }
  const result = await rekeyTemplateVersions({ boxRoot: path.resolve(boxRoot), apply });
  const verb = apply ? "" : " (dry run — pass --apply)";
  const moved = Object.entries(result.rekeyed);
  if (moved.length === 0 && result.dropped.length === 0) {
    console.log(`template tracker: already keyed on v3 paths${verb}`);
  }
  for (const [from, to] of moved) console.log(`template tracker: ${from} -> ${to}${verb}`);
  for (const key of result.dropped) {
    console.log(`template tracker: dropped ${key} — no such file in the box${verb}`);
  }
}
