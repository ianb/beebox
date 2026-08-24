/** Google Drive card discovery shared by sync and `cb drive status`. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { errnoCode } from "../lib/error-guards.js";
import { getBoxDir } from "../lib/paths.js";
import { invariant } from "../lib/invariant.js";
import { getAllDriveHandlers } from "./drive-types.js";

const DRIVE_CARD_IGNORE = [
  "node_modules/**",
  ".git/**",
  "tmp/**",
  ".callback-box/**",
  "procedure/runs/**",
];

export interface TrackedDriveCard {
  driveId: string;
  absPath: string;
  relPath: string;
  content: string;
}

export interface DriveCardTracking {
  liveCards: TrackedDriveCard[];
  trashedDriveIds: Set<string>;
}

/** Parse the current YAML form and the legacy XML attribute form. */
export function driveIdFromCardContent(content: string): string | null {
  const yamlMatch = /^drive-id:\s*"?([^\n"]+?)"?\s*$/m.exec(content);
  if (yamlMatch) {
    invariant(yamlMatch[1] !== undefined, "capture group 1 is non-optional in yamlMatch");
    return yamlMatch[1];
  }
  const xmlMatch = /drive-id="([^"]+)"/.exec(content);
  if (!xmlMatch) return null;
  invariant(xmlMatch[1] !== undefined, "capture group 1 is non-optional in xmlMatch");
  return xmlMatch[1];
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== "..";
}

/** Find live Drive cards and the Drive IDs retained as trash tombstones. */
export async function findDriveCardTracking(boxRoot: string): Promise<DriveCardTracking> {
  const matches = new Set<string>();
  for (const handler of getAllDriveHandlers()) {
    const paths = await glob(`**/*.${handler.cardType}.card`, {
      cwd: boxRoot,
      absolute: true,
      nodir: true,
      ignore: DRIVE_CARD_IGNORE,
    });
    for (const cardPath of paths) matches.add(cardPath);
  }

  const trashDir = getBoxDir(boxRoot, "trash");
  const liveCards: TrackedDriveCard[] = [];
  const trashedDriveIds = new Set<string>();
  for (const absPath of [...matches].toSorted()) {
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch (error: unknown) {
      if (errnoCode(error) !== "ENOENT") {
        console.warn(
          `[google-drive] Could not read drive-id from ${absPath}, skipping`,
        );
      }
      continue;
    }
    const driveId = driveIdFromCardContent(content);
    if (driveId === null) continue;
    if (isWithin(trashDir, absPath)) {
      trashedDriveIds.add(driveId);
      continue;
    }
    liveCards.push({
      driveId,
      absPath,
      relPath: path.relative(boxRoot, absPath),
      content,
    });
  }
  return { liveCards, trashedDriveIds };
}
