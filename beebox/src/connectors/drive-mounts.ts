/**
 * Writing and removing Drive mounts: the operations behind `bbx drive mount`,
 * `bbx drive link`, and `bbx drive unmount`.
 *
 * They live here rather than in the CLI command because the CLI is not the
 * only caller — the settings page and chat reach the same three operations
 * through tRPC, and a surface that shelled out to `bbx` would drift from the one
 * that didn't. Refusals are `DriveMountError` subclasses
 * (`drive-mount-errors.ts`); every other failure (Drive down, disk full) throws
 * as itself.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { invariant } from "../lib/invariant.js";
import { stageAndCommitPaths } from "../lib/git.js";
import { commitTrashReceipt, moveCardsToTrash } from "../core/commands/trash.js";
import { createCliContext } from "../core/command-runner.js";
import type { DriveFile, GoogleDriveService } from "../services/google-drive.js";
import { extractDriveFileId } from "./drive-types.js";
import { writeGfolderCard, writeGlinkCard } from "./drive-card-stamp.js";
import { DRIVE_FOLDER_MIME } from "./drive-folder-plan.js";
import { gfolderCardsIn } from "./drive-folder-cards.js";
import { mirrorFolderOnce } from "./drive-mount-sync.js";
import { withDriveMirrorLock } from "./drive-lock.js";
import { resolveMountTarget } from "./drive-mount-path.js";
import { safeFilename } from "./chat-utils.js";
import {
  AmbiguousFolderMountError,
  DirectoryAlreadyMountedError,
  DriveCardExistsError,
  DriveIdClaimedError,
  NoFolderMountHereError,
  NotADriveFolderError,
  UnreadableDriveInputError,
} from "./drive-mount-errors.js";
import {
  findDriveCardTracking,
  GFOLDER_CARD_TYPE,
  GLINK_CARD_TYPE,
  type DriveCardTracking,
} from "./google-drive-tracking.js";

/** A Drive URL or bare id, or a refusal naming what was unusable. */
function requireDriveId(input: string): string {
  const driveId = extractDriveFileId(input);
  if (driveId === null) throw new UnreadableDriveInputError(input);
  return driveId;
}

/**
 * Refuse a second card for one Drive ID. Transient state is keyed by Drive ID
 * while attach scopes are per-card, so two cards for one item are two working
 * copies that overwrite each other upstream — the connector skips both rather
 * than pick one, which would leave the new mount silently dead.
 */
async function refuseIfClaimed(opts: { boxRoot: string; driveId: string }): Promise<void> {
  const tracking: DriveCardTracking = await findDriveCardTracking(opts.boxRoot);
  const claimedBy = [
    ...tracking.liveCards
      .filter((card) => card.driveId === opts.driveId)
      .map((card) => card.relPath),
    ...tracking.duplicates
      .filter((duplicate) => duplicate.driveId === opts.driveId)
      .flatMap((duplicate) => duplicate.relPaths),
  ];
  if (claimedBy.length > 0) {
    throw new DriveIdClaimedError({ driveId: opts.driveId, claimedBy });
  }
}

async function refuseIfExists(opts: { boxRoot: string; cardPath: string }): Promise<void> {
  try {
    await fs.access(opts.cardPath);
  } catch (_e) {
    // Absent is the state we want, and an unreadable path is not a card we
    // would be overwriting either — the write below reports it properly.
    return;
  }
  throw new DriveCardExistsError(path.relative(opts.boxRoot, opts.cardPath));
}

/** The card basename for a Drive item, without the `.<type>.card` suffix. */
function cardBaseFor(name: string): string {
  const safe = safeFilename(name);
  return safe === "" ? "Drive_item" : safe;
}

export interface MountFolderResult {
  /** Box-relative path of the `.gfolder.card` that is now the mount. */
  cardPath: string;
  /** The Drive folder's name. */
  name: string;
  created: string[];
  updated: string[];
  pushed: string[];
  /** Child-level problems from the first mirror pass. The mount still exists. */
  failures: string[];
  /** Things worth knowing that are not failures (a child that left, a cap). */
  notes: string[];
}

/**
 * Mirror a Drive folder into `dir`: write the mount card, run one mirror pass,
 * and commit. `dir` is required — the box never guesses where a mount belongs.
 */
export async function mountDriveFolder(options: {
  boxRoot: string;
  service: GoogleDriveService;
  input: string;
  dir: string;
}): Promise<MountFolderResult> {
  const { boxRoot, service, input, dir } = options;
  const driveId = requireDriveId(input);

  const file = await service.getFile(driveId);
  if (file.mimeType !== DRIVE_FOLDER_MIME) {
    throw new NotADriveFolderError({ name: file.name, mimeType: file.mimeType });
  }
  const mountDir = resolveMountTarget(boxRoot, { raw: dir, label: "The target directory" });
  // The claim check, the card write, the first mirror pass, and the commit are
  // one Drive-writer span — a wakeup sync landing in the middle would mirror
  // the same folder into the same directory from another process. Reentrant,
  // so `mirrorFolderOnce` inside just passes through. The git commit nests
  // INSIDE this lock, which is the safe order (see drive-lock.ts).
  return withDriveMirrorLock(boxRoot, () =>
    mountUnderLock({ boxRoot, service, folder: { file, driveId, mountDir } }),
  );
}

async function mountUnderLock(options: {
  boxRoot: string;
  service: GoogleDriveService;
  folder: { file: DriveFile; driveId: string; mountDir: string };
}): Promise<MountFolderResult> {
  const { boxRoot, service } = options;
  const { file, driveId, mountDir } = options.folder;
  await refuseIfClaimed({ boxRoot, driveId });

  const occupants = await gfolderCardsIn(mountDir);
  if (occupants.length > 0) {
    throw new DirectoryAlreadyMountedError({
      relDir: path.relative(boxRoot, mountDir),
      mountCards: occupants.map((card) => path.basename(card.cardPath)),
    });
  }

  const cardPath = path.join(mountDir, `${cardBaseFor(file.name)}.${GFOLDER_CARD_TYPE}.card`);
  await refuseIfExists({ boxRoot, cardPath });
  await fs.mkdir(mountDir, { recursive: true });
  await writeGfolderCard(cardPath, file);
  const relCard = path.relative(boxRoot, cardPath);

  const mirror = await mirrorFolderOnce({ boxRoot, service, driveId, cardPath });

  const paths = [...new Set([relCard, ...mirror.created, ...mirror.updated, ...mirror.pushed])];
  await stageAndCommitPaths(boxRoot, { paths, message: `Mount Drive folder: ${file.name}` });

  return {
    cardPath: relCard,
    name: file.name,
    created: mirror.created,
    updated: mirror.updated,
    pushed: mirror.pushed,
    failures: mirror.failures,
    notes: mirror.notes,
  };
}

export interface LinkResult {
  /** Box-relative path of the `.glink.card`. */
  cardPath: string;
  name: string;
  mimeType: string;
}

/**
 * Write a pointer to any Drive item — folders included. A pointer copies
 * nothing, so pointing at a folder is a legitimate alternative to mirroring it.
 */
export async function linkDriveItem(options: {
  boxRoot: string;
  service: GoogleDriveService;
  input: string;
  target: string;
}): Promise<LinkResult> {
  const { boxRoot, service, input, target } = options;
  const driveId = requireDriveId(input);
  const file = await service.getFile(driveId);
  await refuseIfClaimed({ boxRoot, driveId });

  const resolved = resolveMountTarget(boxRoot, { raw: target, label: "The pointer path" });
  const cardPath = resolved.endsWith(`.${GLINK_CARD_TYPE}.card`)
    ? resolved
    : `${resolved}.${GLINK_CARD_TYPE}.card`;
  await refuseIfExists({ boxRoot, cardPath });

  await fs.mkdir(path.dirname(cardPath), { recursive: true });
  await writeGlinkCard(cardPath, { file, origin: "manual" });
  const relCard = path.relative(boxRoot, cardPath);

  await stageAndCommitPaths(boxRoot, {
    paths: [relCard],
    message: `Link Drive item: ${file.name}`,
  });

  return { cardPath: relCard, name: file.name, mimeType: file.mimeType };
}

export interface UnmountResult {
  /** Box-relative path the mount card came from. */
  cardPath: string;
  /** Box-relative path in `store/trash/` it moved to. */
  trashedTo: string;
}

/**
 * Stop mirroring a folder. Exactly `bbx rm` on the mount card: it moves to
 * `store/trash/` (where it also becomes the tombstone that stops a parent
 * mirror re-creating it), and every child stays where it is — synced cards keep
 * syncing on their own, pointers keep pointing. Nothing is deleted.
 *
 * `target` is either the mount directory or the card itself.
 */
export async function unmountDriveFolder(options: {
  boxRoot: string;
  target: string;
}): Promise<UnmountResult> {
  const { boxRoot, target } = options;
  const resolved = resolveMountTarget(boxRoot, { raw: target, label: "The mount card" });
  const cardPath = resolved.endsWith(`.${GFOLDER_CARD_TYPE}.card`)
    ? resolved
    : await onlyMountIn({ boxRoot, dir: resolved });

  const receipt = await moveCardsToTrash(createCliContext(boxRoot), [cardPath]);
  await commitTrashReceipt(boxRoot, { receipt, reason: "unmounted Drive folder" });

  const move = receipt.moves.at(0);
  invariant(move !== undefined, "moveCardsToTrash returns one move per path or throws");
  return { cardPath: move.sourcePath, trashedTo: move.destPath };
}

/** The one mount card in a directory — a refusal when there are none or many. */
async function onlyMountIn(opts: { boxRoot: string; dir: string }): Promise<string> {
  const found = await gfolderCardsIn(opts.dir);
  const relDir = path.relative(opts.boxRoot, opts.dir);
  const first = found.at(0);
  if (first === undefined) throw new NoFolderMountHereError(relDir);
  if (found.length > 1) {
    throw new AmbiguousFolderMountError({
      relDir,
      mountCards: found.map((card) => path.basename(card.cardPath)),
    });
  }
  return first.cardPath;
}
