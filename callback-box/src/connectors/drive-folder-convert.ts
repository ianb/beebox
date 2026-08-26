/**
 * The one-time conversion of legacy `folders` config entries into
 * `.gfolder.card` mounts.
 *
 * Runs at the top of every sync, before the card scan, so a converted mount is
 * mirrored on the same pass that converted it. Writes only `drive-id` — the
 * mirror stamps `name`, `link`, `status`, and `last-sync` moments later.
 *
 * Idempotent by construction: an entry whose target directory already holds a
 * `.gfolder.card` for the same folder is dropped from the config without a
 * write, and once the config has no `folders` key there is nothing left to do.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createGfolderTemplate } from "../schemas/gfolder.js";
import { safeFilename } from "./chat-utils.js";
import { gfolderCardsIn } from "./drive-folder-cards.js";
import { GFOLDER_CARD_TYPE } from "./google-drive-tracking.js";
import { DRIVE_CONFIG_REL, saveDriveConfig, type DriveConfig } from "./drive-config.js";

export interface ConfigConversion {
  /** Box-relative paths of the mount cards this conversion wrote. */
  created: string[];
  /** Box-relative config path, when the config was rewritten; else null. */
  configPath: string | null;
}

/** The card filename for a converted mount, derived from its directory name. */
function cardNameFor(localPath: string): string {
  const safe = safeFilename(path.basename(localPath));
  const base = safe === "" ? "Folder" : safe;
  return `${base}.${GFOLDER_CARD_TYPE}.card`;
}

export async function convertConfigFolders(options: {
  boxRoot: string;
  config: DriveConfig;
}): Promise<ConfigConversion> {
  const { boxRoot, config } = options;
  const entries = config.folders;
  if (entries === undefined || entries.length === 0) return { created: [], configPath: null };

  const created: string[] = [];
  const kept: typeof entries = [];
  const converted: string[] = [];

  for (const entry of entries) {
    const dir = path.isAbsolute(entry.localPath)
      ? entry.localPath
      : path.join(boxRoot, entry.localPath);
    const existing = await gfolderCardsIn(dir);

    const sameFolder = existing.find((card) => card.driveId === entry.driveFolderId);
    if (sameFolder !== undefined) {
      // Already a card mount — the conversion happened before, or someone ran
      // `cb drive mount` here. Drop the entry, write nothing.
      converted.push(entry.localPath);
      continue;
    }
    if (existing.length > 0) {
      // Converting would put two mounts in one directory, which is two mirrors
      // fighting over the same children. The boxholder decides which wins, so
      // the entry stays in the config until they do.
      console.error(
        `[google-drive] ${entry.localPath} already holds a folder mount for a different Drive `
          + `folder (${existing.map((card) => card.driveId ?? "unreadable").join(", ")}) — legacy `
          + `config entry for ${entry.driveFolderId} NOT converted, and left in ${DRIVE_CONFIG_REL}. `
          + "Trash the card there, or point the config entry at another directory.",
      );
      kept.push(entry);
      continue;
    }

    await fs.mkdir(dir, { recursive: true });
    const cardPath = path.join(dir, cardNameFor(entry.localPath));
    await fs.writeFile(cardPath, createGfolderTemplate({ driveId: entry.driveFolderId }));
    created.push(path.relative(boxRoot, cardPath));
    converted.push(entry.localPath);
  }

  if (converted.length === 0) return { created, configPath: null };

  const rewritten: DriveConfig = { ...config };
  if (kept.length === 0) delete rewritten.folders;
  else rewritten.folders = kept;
  await saveDriveConfig(boxRoot, rewritten);

  console.warn(
    `[google-drive] Converted ${String(converted.length)} legacy folder mount(s) to `
      + `.${GFOLDER_CARD_TYPE}.card: ${converted.join(", ")} — `
      + "a folder mount is now the card in the directory it mirrors.",
  );

  return { created, configPath: DRIVE_CONFIG_REL };
}
