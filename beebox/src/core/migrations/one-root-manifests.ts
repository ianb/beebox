/**
 * Track E step 7 (`docs/plans/one-root-box-layout.md`): update the two
 * machine-global manifests that may still point a box's entry at its OLD v2
 * `content/` operational root — `hub.json` (`src/hub/hub-config.ts`) and
 * `~/.config/beebox/boxes.json` (`src/core/box/boxes-config.ts`).
 *
 * The migration moves data WITHIN a box's own directory; the box's top-level
 * directory (the v2 package root) never moves, so most manifest entries
 * (which already point at that directory) need no change at all. The one
 * stale form is an entry that was written pointing at
 * `<packageRoot>/content` — legitimate pre-migration, since that WAS the
 * operational root then. This module rewrites ONLY entries that literally
 * equal `<packageRoot>/content` (after resolving `~` and relative-to-config
 * forms) to `<packageRoot>`; every other entry is left untouched. Both
 * manifests are edited directly as JSON (not through their strict Zod
 * schemas' full read/validate/write path) so a manifest this box doesn't
 * appear in at all is never touched, and an entry for some OTHER box is never
 * at risk of being "corrected" by a schema round-trip it didn't ask for.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isRecord } from "../../lib/is-record.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { errnoCode } from "../../lib/error-guards.js";

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

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/**
 * Rewrite any `hub.json` `boxes.*.path` and `boxes.json` `boxes[]` entry that
 * points at `<packageRoot>/content` to point at `packageRoot` instead. A
 * no-op (returns empty arrays) when neither manifest exists or neither has a
 * stale entry for this box — the common case for a box these manifests never
 * knew about, or one whose entries already point at the package root.
 */
export async function updateManifestsForOneRoot(params: {
  packageRoot: string;
  hubConfigPath?: string;
  boxesConfigPath?: string;
}): Promise<ManifestUpdateResult> {
  const staleForm = path.join(params.packageRoot, "content");
  const hubEntriesUpdated: string[] = [];
  const boxesEntriesUpdated: string[] = [];

  const hubPath = params.hubConfigPath ?? defaultHubConfigPath();
  const hubJson = await readJsonFile(hubPath);
  if (isRecord(hubJson) && isRecord(hubJson["boxes"])) {
    let changed = false;
    for (const [slug, entry] of Object.entries(hubJson["boxes"])) {
      if (isRecord(entry) && entry["path"] === staleForm) {
        entry["path"] = params.packageRoot;
        hubEntriesUpdated.push(slug);
        changed = true;
      }
    }
    if (changed) {
      await writeFileAtomic(hubPath, { content: JSON.stringify(hubJson, null, 2) + "\n" });
    }
  }

  const boxesPath = params.boxesConfigPath ?? defaultBoxesConfigPath();
  const boxesJson = await readJsonFile(boxesPath);
  const boxesEntry = isRecord(boxesJson) ? boxesJson["boxes"] : undefined;
  if (Array.isArray(boxesEntry)) {
    const boxes = boxesEntry;
    let changed = false;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i] === staleForm) {
        boxes[i] = params.packageRoot;
        boxesEntriesUpdated.push(staleForm);
        changed = true;
      }
    }
    if (changed) {
      await writeFileAtomic(boxesPath, { content: JSON.stringify(boxesJson, null, 2) + "\n" });
    }
  }

  return { hubEntriesUpdated, boxesEntriesUpdated };
}
