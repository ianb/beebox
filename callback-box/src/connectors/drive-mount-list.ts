/**
 * "What does this box mirror from Drive?" — the reader behind the settings
 * page's mount list.
 *
 * A mount is a `.gfolder.card`, so the answer is a card scan, not a config
 * read. Each mount reports what the boxholder needs to judge it: where it
 * mirrors to, what Drive said last time, and how many children the directory
 * actually holds — the count is the honest answer to "did this work", since a
 * mount whose listing failed shows a status but no children.
 */

import * as path from "node:path";
import { parseFrontmatterObject } from "../cards/frontmatter.js";
import { findDriveCardTracking, type DriveCardKind } from "./google-drive-tracking.js";
import type { FolderProblemCounts } from "./drive-folder-types.js";

export interface FolderMountChildCounts {
  /** Synced children in the mount directory (`.gdoc.card` / `.gsheet.card`). */
  files: number;
  /** Pointer children in the mount directory (`.glink.card`). */
  links: number;
}

export interface FolderMountSummary {
  /** Box-relative path of the mount card. */
  cardPath: string;
  /** Box-relative directory the card sits in — the mount itself. */
  dir: string;
  driveId: string;
  /** Drive's name for the folder, absent until the first successful sync. */
  name: string | null;
  /** `webViewLink` for the Drive folder, absent until the first sync. */
  link: string | null;
  status: "ok" | "error" | null;
  lastSync: string | null;
  /** Present only alongside `status: "error"`. */
  error: string | null;
  children: FolderMountChildCounts;
  /** Children the last pass could not account for; zero when all is well. */
  problems: FolderProblemCounts;
}

/** The value of a frontmatter field, when it is a non-empty string. */
function field(fields: Record<string, unknown> | null, key: string): string | null {
  const value = fields?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** The box-relative directory a card sits in ("" at the box root). */
function dirOf(relPath: string): string {
  const dir = path.dirname(relPath);
  return dir === "." ? "" : dir;
}

/**
 * The `not-in-folder` / `unknown` counts a mount card carries.
 *
 * Shared with `cb drive status` rather than re-read there: both surfaces
 * promise the same two numbers, and a mount that reads differently in the CLI
 * than in settings is worse than one that reads nowhere.
 */
export function folderProblemCounts(content: string): FolderProblemCounts {
  const fields = parseFrontmatterObject(content);
  return {
    notInFolder: count(fields, "not-in-folder"),
    unknown: count(fields, "unknown"),
  };
}

/** A non-negative whole number from frontmatter, or 0. */
function count(fields: Record<string, unknown> | null, key: string): number {
  const value = fields?.[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function statusOf(fields: Record<string, unknown> | null): "ok" | "error" | null {
  const status = field(fields, "status");
  if (status === "ok" || status === "error") return status;
  return null;
}

/**
 * Every folder mount on the box, sorted by card path.
 *
 * The fields come off the card's frontmatter rather than `driveCardSummary`:
 * that helper answers `cb drive status`'s two questions (what is it, when did
 * we last hear from Drive) by aliasing across card types, and a mount list
 * wants the mount card's own field names — including `link` and `error`, which
 * the summary does not carry.
 */
export async function listFolderMounts(boxRoot: string): Promise<FolderMountSummary[]> {
  const tracking = await findDriveCardTracking(boxRoot);

  const countsByDir = new Map<string, FolderMountChildCounts>();
  const bump = (dir: string, kind: DriveCardKind): void => {
    const counts = countsByDir.get(dir) ?? { files: 0, links: 0 };
    if (kind === "file") counts.files += 1;
    if (kind === "link") counts.links += 1;
    countsByDir.set(dir, counts);
  };
  for (const card of tracking.liveCards) {
    if (card.kind === "folder") continue;
    bump(dirOf(card.relPath), card.kind);
  }

  const mounts: FolderMountSummary[] = [];
  for (const card of tracking.liveCards) {
    if (card.kind !== "folder") continue;
    const fields = parseFrontmatterObject(card.content);
    // `dirname` says "." for a card at the box root; box-relative spelling for
    // the root is the empty string, and every consumer displays it.
    const dir = dirOf(card.relPath);
    mounts.push({
      cardPath: card.relPath,
      dir,
      driveId: card.driveId,
      name: field(fields, "name"),
      link: field(fields, "link"),
      status: statusOf(fields),
      lastSync: field(fields, "last-sync"),
      error: field(fields, "error"),
      children: countsByDir.get(dir) ?? { files: 0, links: 0 },
      problems: folderProblemCounts(card.content),
    });
  }
  return mounts;
}
