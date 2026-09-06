/**
 * The redundant-`links:` info rule (`docs/plans/card-prominence.md`, Budget
 * lint): a landmark `links:` entry whose target is inside the landmark's OWN
 * pruned subtree (Track B), carries no `label`, and whose target already
 * says `primary`/`entry-point` says nothing a reader doesn't already get
 * from the derived list. Split out of `lint-prominence.ts` — this rule needs
 * the pruned-subtree walk, which the rest of that module doesn't — and to
 * stay under the file-length budget.
 *
 * Info-level, not a warning: the entry isn't wrong, and trimming it is a
 * cleanup an agent does when it next touches the landmark, not urgent.
 */

import * as path from "node:path";
import { readLandmarkCard } from "./landmark/card-cache.js";
import { prunedSubtree } from "./landmark/prominence-index.js";
import { resolveRefPath } from "../shared/ref-path.js";
import type { ProminenceLintWarning } from "./lint-prominence.js";

interface LandmarkRecord {
  relPath: string;
  dir: string;
}

/**
 * Scan every landmark card's `links:` for entries redundant with the
 * target's own prominence, appending one info warning per redundant entry.
 */
export async function redundantLinkWarnings(
  boxRoot: string,
  { landmarks, warnings }: { landmarks: LandmarkRecord[]; warnings: ProminenceLintWarning[] },
): Promise<void> {
  for (const landmark of landmarks) {
    const fields = await readLandmarkCard(path.join(boxRoot, landmark.relPath));
    const links = fields?.navigation?.links ?? [];
    if (links.length === 0) continue;

    const derived = await prunedSubtree(boxRoot, landmark.dir);
    const prominentTargets = new Map<string, "primary" | "entry-point">();
    for (const entry of derived.entries) {
      if (entry.kind === "card" && (entry.level === "primary" || entry.level === "entry-point")) {
        prominentTargets.set(entry.boxPath, entry.level);
      }
    }
    if (prominentTargets.size === 0) continue;

    for (const link of links) {
      if (link.label !== undefined && link.label !== "") continue;
      const resolved = resolveRefPath({ fromPath: landmark.relPath, ref: link.ref, kind: "card" });
      if (resolved === null) continue;
      const level = prominentTargets.get(`/${resolved}`);
      if (level === undefined) continue;
      warnings.push({
        path: landmark.relPath,
        rule: "redundant-link",
        severity: "info",
        message: `link to ${resolved} is redundant with the target's own prominence: ${level} — the derived list already surfaces it`,
      });
    }
  }
}
