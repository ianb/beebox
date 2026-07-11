/**
 * Google Drive connector configuration.
 *
 * Config file: config/connectors/google-drive.json
 *
 * Contains folder mounts (auto-sync all sheets in a Drive folder).
 * Individual file mounts don't need config — the card's existence IS the config.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";

export interface DriveFolderMount {
  driveFolderId: string;
  localPath: string;
}

export interface DriveConfig {
  folders?: DriveFolderMount[];
}

const CONFIG_REL = "config/connectors/google-drive.json";

export async function loadDriveConfig(boxRoot: string): Promise<DriveConfig> {
  try {
    const content = await fs.readFile(path.join(boxRoot, CONFIG_REL), "utf-8");
    return JSON.parse(content);
  } catch (e) {
    // No config file yet (or it's unreadable/malformed): fall back to an empty
    // config. A missing file is expected before first setup; log so a corrupt
    // file isn't silently treated as "no folder mounts".
    if (errnoCode(e) !== "ENOENT") {
      console.warn("Could not load drive config, using defaults:", e);
    }
    return {};
  }
}

export async function saveDriveConfig(boxRoot: string, config: DriveConfig): Promise<void> {
  const filePath = path.join(boxRoot, CONFIG_REL);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2) + "\n");
}
