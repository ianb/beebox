/**
 * Google Drive connector configuration — `config/connectors/google-drive.json`.
 *
 * There is nothing left to configure. A Drive mount is a card: a `.gdoc.card` /
 * `.gsheet.card` for a synced file, a `.gfolder.card` for a mirrored folder,
 * a `.glink.card` for a pointer. The card's existence IS the configuration.
 *
 * `folders` survives only as the **legacy input shape**: boxes set up before
 * folder mounts became cards still carry the array on disk, and the connector's
 * first sync converts each entry into a `.gfolder.card` and rewrites the file
 * without it (`drive-folder-convert.ts`). Nothing reads `folders` for
 * discovery, nothing writes a new entry, and once a box has been synced once
 * the key is gone for good. Do not add fields here — add a card type.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode, errorMessage } from "../lib/error-guards.js";
import { ok, err, type Result } from "../lib/result.js";

/** A pre-card folder mount. Legacy input only — see the module comment. */
export const DriveFolderMountSchema = z.object({
  driveFolderId: z.string().min(1),
  localPath: z.string().min(1),
});

export type DriveFolderMount = z.infer<typeof DriveFolderMountSchema>;

export const DriveConfigSchema = z.object({
  folders: z.array(DriveFolderMountSchema).optional(),
});

export type DriveConfig = z.infer<typeof DriveConfigSchema>;

export const DRIVE_CONFIG_REL = "config/connectors/google-drive.json";

/**
 * Read the connector config.
 *
 * A missing file is an empty config — that is the normal state of a box that
 * never had a pre-card folder mount. A file that exists but does not parse is
 * a **failure**, never an empty config: reading a corrupt file as "no mounts"
 * is how a box would silently drop the folder entries it is owed a conversion
 * for. Callers branch on the two, so this returns a Result rather than throwing.
 */
export async function loadDriveConfig(boxRoot: string): Promise<Result<DriveConfig>> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, DRIVE_CONFIG_REL), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return ok({});
    return err(`Could not read ${DRIVE_CONFIG_REL}: ${errorMessage(e)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return err(`${DRIVE_CONFIG_REL} is not valid JSON: ${errorMessage(e)}`);
  }

  const result = DriveConfigSchema.safeParse(parsed);
  if (!result.success) {
    return err(`${DRIVE_CONFIG_REL} does not match the connector config shape: ${result.error.message}`);
  }
  return ok(result.data);
}

export async function saveDriveConfig(boxRoot: string, config: DriveConfig): Promise<void> {
  const filePath = path.join(boxRoot, DRIVE_CONFIG_REL);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2) + "\n");
}
