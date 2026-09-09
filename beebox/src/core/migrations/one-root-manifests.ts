/**
 * Track E step 7 (`docs/implemented-plans/one-root-box-layout.md`): update the two
 * machine-global manifests that may still point a box's entry at its OLD v2
 * `content/` operational root — `hub.json` (`src/hub/hub-config.ts`) and
 * `~/.config/beebox/boxes.json` (`src/core/box/boxes-config.ts`).
 *
 * The migration moves data WITHIN a box's own directory; the box's top-level
 * directory (the v2 package root) never moves, so most manifest entries
 * (which already point at that directory) need no change at all. The one
 * stale form is an entry that was written pointing at
 * `<packageRoot>/content` — legitimate pre-migration, since that WAS the
 * operational root then. This module rewrites ONLY entries that resolve to
 * `<packageRoot>/content` to `<packageRoot>`; every other entry is left
 * untouched. Both manifests are edited directly as JSON (not through their
 * strict Zod schemas' full read/validate/write path) so a manifest this box
 * doesn't appear in at all is never touched, and an entry for some OTHER box
 * is never at risk of being "corrected" by a schema round-trip it didn't ask
 * for.
 *
 * Split into a PREFLIGHT plan (`planManifestUpdatesForOneRoot`) and a
 * post-commit write (`commitManifestUpdatesForOneRoot`) rather than one
 * do-everything function: reading and JSON-parsing both files can fail (a
 * hand-edited manifest with a syntax error) — that belongs in preflight,
 * before anything in the box has moved, so it aborts the same clean way
 * every other preflight check does. The actual writes happen only once the
 * box's own migration commit has landed (this is external, machine-global
 * state — outside the box's own repo, so it's touched only once the box's
 * own change is safe), and the plan carries each file's ORIGINAL raw bytes so
 * a write failure (e.g. hub.json succeeds, boxes.json's disk write then
 * fails) can restore exactly what was there rather than leave the pair
 * inconsistent. That restore never rolls back the box commit itself — by the
 * time these writes run, the box migration already succeeded.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isRecord } from "../../lib/is-record.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { assertWriteTargetNotSymlink } from "./one-root-write-guard.js";

function defaultHubConfigPath(): string {
  return path.join(os.homedir(), ".config", "beebox", "hub.json");
}

function defaultBoxesConfigPath(): string {
  return path.join(os.homedir(), ".config", "beebox", "boxes.json");
}

export interface ManifestUpdateResult {
  hubEntriesUpdated: string[];
  boxesEntriesUpdated: string[];
}

/** One manifest file's planned edit. `originalRaw` is `null` when the file
 * doesn't exist (nothing to restore); `updatedJson` is `null` when nothing in
 * this file needs changing (the common case) — `commitManifestUpdatesForOneRoot`
 * skips writing it entirely then. */
interface OneRootManifestFilePlan {
  path: string;
  originalRaw: string | null;
  updatedJson: unknown | null;
  entriesUpdated: string[];
}

export interface OneRootManifestPlan {
  hub: OneRootManifestFilePlan;
  boxes: OneRootManifestFilePlan;
}

async function readJsonFile(filePath: string): Promise<{ raw: string; json: unknown } | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  // A malformed manifest throws here (JSON.parse) — deliberately: this runs
  // during preflight, before anything in the box has moved, so it aborts the
  // migration the same clean way any other preflight check does rather than
  // surfacing mid-migration.
  return { raw, json: JSON.parse(raw) };
}

/**
 * PREFLIGHT: read and resolve both manifests (their own readers' path
 * semantics — see the per-file comments below) and stage whichever edits
 * they need, without writing anything. Call this before any box mutation so
 * a malformed manifest aborts cleanly. Returns a plan even when neither
 * manifest exists or needs an edit — `updatedJson` is `null` on both `hub`
 * and `boxes` in that case.
 */
export async function planManifestUpdatesForOneRoot(params: {
  packageRoot: string;
  hubConfigPath?: string;
  boxesConfigPath?: string;
}): Promise<OneRootManifestPlan> {
  const staleForm = path.join(params.packageRoot, "content");

  const hubPath = params.hubConfigPath ?? defaultHubConfigPath();
  const hubFile = await readJsonFile(hubPath);
  const hubEntriesUpdated: string[] = [];
  let hubUpdated: unknown | null = null;
  if (hubFile !== null && isRecord(hubFile.json) && isRecord(hubFile.json["boxes"])) {
    // hub.json entries may be relative — resolved against the config file's
    // OWN directory, exactly like `hub-config.ts`'s real loader
    // (`path.resolve(configDir, entry.path)`). Comparing raw strings (the
    // pre-fix behavior) never matched a relative entry.
    const configDir = path.dirname(path.resolve(hubPath));
    let changed = false;
    for (const [slug, entry] of Object.entries(hubFile.json["boxes"])) {
      if (!isRecord(entry) || typeof entry["path"] !== "string") continue;
      const resolved = path.resolve(configDir, entry["path"]);
      if (resolved !== staleForm) continue;
      entry["path"] = params.packageRoot;
      hubEntriesUpdated.push(slug);
      changed = true;
    }
    if (changed) hubUpdated = hubFile.json;
  }

  const boxesPath = params.boxesConfigPath ?? defaultBoxesConfigPath();
  const boxesFile = await readJsonFile(boxesPath);
  const boxesEntriesUpdated: string[] = [];
  let boxesUpdated: unknown | null = null;
  const boxesEntry = boxesFile !== null && isRecord(boxesFile.json) ? boxesFile.json["boxes"] : undefined;
  if (Array.isArray(boxesEntry)) {
    // boxes.json entries are documented as always-absolute
    // (`boxes-config.ts`'s `BoxesConfig`) — a raw string compare is correct
    // here, unlike hub.json.
    let changed = false;
    for (let i = 0; i < boxesEntry.length; i++) {
      if (boxesEntry[i] !== staleForm) continue;
      boxesEntry[i] = params.packageRoot;
      boxesEntriesUpdated.push(staleForm);
      changed = true;
    }
    if (changed) boxesUpdated = boxesFile?.json ?? null;
  }

  return {
    hub: { path: hubPath, originalRaw: hubFile?.raw ?? null, updatedJson: hubUpdated, entriesUpdated: hubEntriesUpdated },
    boxes: {
      path: boxesPath,
      originalRaw: boxesFile?.raw ?? null,
      updatedJson: boxesUpdated,
      entriesUpdated: boxesEntriesUpdated,
    },
  };
}

/**
 * Apply a plan from {@link planManifestUpdatesForOneRoot} — call this only
 * AFTER the box's own migration commit has landed. Writes only the files
 * that actually changed. On a write failure partway through, restores the
 * original bytes of whichever file(s) this call itself wrote (never touches
 * a file it didn't write) and rethrows — the box commit is not affected
 * either way.
 */
export async function commitManifestUpdatesForOneRoot(plan: OneRootManifestPlan): Promise<ManifestUpdateResult> {
  const written: OneRootManifestFilePlan[] = [];
  try {
    for (const file of [plan.hub, plan.boxes]) {
      if (file.updatedJson === null) continue;
      await assertWriteTargetNotSymlink(file.path);
      await writeFileAtomic(file.path, { content: JSON.stringify(file.updatedJson, null, 2) + "\n" });
      written.push(file);
    }
  } catch (e) {
    for (const file of written.toReversed()) {
      if (file.originalRaw === null) continue;
      await fs.writeFile(file.path, file.originalRaw).catch((restoreErr: unknown) => {
        console.error(
          `one-root migration: failed to restore ${file.path} after a manifest-write failure: ${errorMessage(restoreErr)}`,
        );
      });
    }
    throw e;
  }
  return { hubEntriesUpdated: plan.hub.entriesUpdated, boxesEntriesUpdated: plan.boxes.entriesUpdated };
}
