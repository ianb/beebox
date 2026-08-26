/**
 * The decision core of a `.gfolder.card` mirror: given one Drive folder
 * listing and the Drive cards the mount directory already holds, decide what
 * to create, which subfolders to descend into, and which cards no longer have
 * a listed child behind them.
 *
 * Pure on purpose (principle 10) — no Drive calls, no filesystem. Shortcuts
 * are followed by the caller before the listing gets here, and the probe of an
 * absent child (trashed? moved out? unreadable?) is the caller's `getFile`.
 * Everything in between is decided here, so the doctest tests the plan rather
 * than a sequence of mocked side effects.
 */

import * as path from "node:path";
import { safeFilename } from "./chat-utils.js";
import { getHandlerForMimeType } from "./drive-types.js";
import {
  GFOLDER_CARD_TYPE,
  GLINK_CARD_TYPE,
  type DriveCardKind,
  type TrackedDriveCard,
} from "./google-drive-tracking.js";

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

/**
 * Recursion bounds for one sync pass, shared by every mount in it. A Drive
 * tree can be arbitrarily deep and wide; a daily wakeup that walks all of it
 * would spend the box's whole quota on one folder. Hitting either bound is
 * reported on the folder card as `status: error`, never absorbed.
 */
export const MAX_FOLDER_DEPTH = 8;
export const MAX_FOLDERS_PER_PASS = 500;

/** A folder child, after any shortcut in front of it has been followed. */
export interface ResolvedChild {
  id: string;
  name: string;
  mimeType: string;
  /** The shortcut this child was reached through, or null when listed directly. */
  viaShortcutId: string | null;
}

/** A Drive card the mount directory already holds. */
export interface MountEntry {
  driveId: string;
  kind: DriveCardKind;
  /** Path of the card, relative to the mount directory. */
  cardPath: string;
}

export interface FolderPlanInput {
  children: ResolvedChild[];
  entries: MountEntry[];
  /** Drive IDs claimed anywhere in the box — live cards, duplicates, tombstones. */
  claimed: ReadonlySet<string>;
  /** Folder IDs already entered on this pass. The cycle guard. */
  visitedFolders: ReadonlySet<string>;
  /** Levels below the outermost folder card of this pass; the top mount is 0. */
  depth: number;
  /** Folders already mirrored on this pass, weighed against the per-pass cap. */
  foldersSoFar: number;
}

/** Create a synced card (`.gdoc.card` / `.gsheet.card`) and sync it. */
export interface CreateFileAction {
  driveId: string;
  name: string;
  cardType: string;
  /** Path relative to the mount directory. */
  cardPath: string;
}

/** Create a `.glink.card` pointer — nothing is copied. */
export interface CreateLinkAction {
  driveId: string;
  name: string;
  mimeType: string;
  cardPath: string;
}

/** A child folder: its card, and whether this pass descends into it. */
export interface SubfolderAction {
  driveId: string;
  name: string;
  /** Path of the subfolder's own card, relative to this mount's directory. */
  cardPath: string;
  /** The card does not exist yet and must be written. */
  create: boolean;
  /** Mirror it on this pass. False when a cap or the cycle guard stopped it. */
  enter: boolean;
}

/** A card here whose Drive ID the listing no longer carries. Probe it. */
export interface AbsentEntry {
  driveId: string;
  cardPath: string;
  kind: DriveCardKind;
}

/**
 * Why a subfolder was not descended into. A `cycle` is ordinary Drive shape
 * (a shortcut pointing back at an ancestor) and only worth logging; a cap
 * means part of the tree is genuinely unmirrored, which the folder card
 * reports as `status: error`.
 */
export interface FolderRefusal {
  reason: "cycle" | "depth-cap" | "folder-cap";
  message: string;
}

export interface FolderPlan {
  createFiles: CreateFileAction[];
  createLinks: CreateLinkAction[];
  subfolders: SubfolderAction[];
  absent: AbsentEntry[];
  refusals: FolderRefusal[];
}

/**
 * The Drive cards a mount directory holds: its own children, plus the folder
 * cards of its immediate subdirectories (a subfolder's card lives one level
 * down, so membership of the mount has to reach there to notice it went away).
 * The mount's own folder card is never its own child.
 */
export function mountEntries(opts: {
  liveCards: TrackedDriveCard[];
  mountDir: string;
  folderCardPath: string;
}): MountEntry[] {
  const { liveCards, mountDir, folderCardPath } = opts;
  const entries: MountEntry[] = [];
  for (const card of liveCards) {
    if (card.absPath === folderCardPath) continue;
    const dir = path.dirname(card.absPath);
    const isChild = dir === mountDir;
    const isSubfolderCard = card.kind === "folder" && path.dirname(dir) === mountDir;
    if (!isChild && !isSubfolderCard) continue;
    entries.push({
      driveId: card.driveId,
      kind: card.kind,
      cardPath: path.relative(mountDir, card.absPath),
    });
  }
  return entries;
}

export function planFolderSync(input: FolderPlanInput): FolderPlan {
  const { children, entries, claimed, visitedFolders, depth, foldersSoFar } = input;
  const plan: FolderPlan = {
    createFiles: [],
    createLinks: [],
    subfolders: [],
    absent: [],
    refusals: [],
  };
  const byDriveId = new Map(entries.map((entry) => [entry.driveId, entry]));
  const listed = new Set<string>();
  let entering = 0;

  for (const child of children) {
    listed.add(child.id);
    const held = byDriveId.get(child.id);
    const safeName = safeFilename(child.name);

    if (child.mimeType === DRIVE_FOLDER_MIME) {
      const cardPath = held
        ? held.cardPath
        : path.join(safeName, `${safeName}.${GFOLDER_CARD_TYPE}.card`);
      // A folder claimed elsewhere in the box (or held as a trash tombstone)
      // keeps its existing home; re-creating it here would fork the mount.
      const create = held === undefined && !claimed.has(child.id);
      const refusal = refuseEntry({
        child,
        depth,
        visitedFolders,
        mirrored: foldersSoFar + entering,
      });
      if (refusal !== null) plan.refusals.push(refusal);
      const enter = refusal === null && (create || held !== undefined);
      if (enter) entering += 1;
      if (create || enter) {
        plan.subfolders.push({ driveId: child.id, name: child.name, cardPath, create, enter });
      }
      continue;
    }

    // Already carded — here or elsewhere. The box-wide card pass syncs it.
    if (held !== undefined || claimed.has(child.id)) continue;

    const handler = getHandlerForMimeType(child.mimeType);
    if (handler) {
      plan.createFiles.push({
        driveId: child.id,
        name: child.name,
        cardType: handler.cardType,
        cardPath: `${safeName}.${handler.cardType}.card`,
      });
      continue;
    }

    plan.createLinks.push({
      driveId: child.id,
      name: child.name,
      mimeType: child.mimeType,
      cardPath: `${safeName}.${GLINK_CARD_TYPE}.card`,
    });
  }

  for (const entry of entries) {
    if (listed.has(entry.driveId)) continue;
    plan.absent.push({ driveId: entry.driveId, cardPath: entry.cardPath, kind: entry.kind });
  }

  return plan;
}

/** Why this pass will not descend into `child`, or null when it will. */
function refuseEntry(opts: {
  child: ResolvedChild;
  depth: number;
  visitedFolders: ReadonlySet<string>;
  mirrored: number;
}): FolderRefusal | null {
  const { child, depth, visitedFolders, mirrored } = opts;
  const who = `Folder ${child.id} ("${child.name}")`;
  if (visitedFolders.has(child.id)) {
    const via = child.viaShortcutId === null ? "" : ` (via shortcut ${child.viaShortcutId})`;
    return { reason: "cycle", message: `${who} already mirrored on this pass${via} — cycle, not descended` };
  }
  if (depth + 1 > MAX_FOLDER_DEPTH) {
    return {
      reason: "depth-cap",
      message: `${who} is deeper than the ${String(MAX_FOLDER_DEPTH)}-level mirror depth cap — not descended`,
    };
  }
  if (mirrored >= MAX_FOLDERS_PER_PASS) {
    return {
      reason: "folder-cap",
      message: `${who} hit the ${String(MAX_FOLDERS_PER_PASS)}-folder-per-sync cap — not descended`,
    };
  }
  return null;
}
