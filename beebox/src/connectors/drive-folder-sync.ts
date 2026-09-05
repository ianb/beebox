/**
 * The IO shell around {@link planFolderSync}: one `.gfolder.card` mirror pass.
 *
 * The card's own directory is the mount. This module lists the Drive folder,
 * follows shortcuts, hands the resolved listing to the pure planner, then
 * carries out the plan — creating synced cards and pointers, descending into
 * subfolders depth-first, probing children that dropped out of the listing,
 * and re-stamping the folder card with the outcome.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errorMessage } from "../lib/error-guards.js";
import { getBoxTimeISO } from "../lib/time.js";
import type { DriveFile } from "../services/google-drive.js";
import {
  driveFolderLink,
  stampGfolderCard,
  writeGfolderCard,
  writeGlinkCard,
} from "./drive-card-stamp.js";
import { mountEntries, planFolderSync } from "./drive-folder-plan.js";
import { claimPath, probeAbsent, resolveChildren } from "./drive-folder-steps.js";
import { assertNever } from "../lib/invariant.js";
import type { AbsentEntry } from "./drive-folder-plan.js";
import type {
  FolderMount,
  FolderProblemCounts,
  FolderSyncDeps,
  FolderSyncResult,
} from "./drive-folder-types.js";

const empty = (): FolderSyncResult => ({
  created: [], updated: [], pushed: [], failures: [], notes: [],
});

export async function syncFolderCard(
  mount: FolderMount,
  deps: FolderSyncDeps,
): Promise<FolderSyncResult> {
  const result = empty();
  // Entering the same Drive folder twice on one pass is a cycle (a shortcut
  // back to an ancestor) or a second card for the same folder; either way the
  // first visit already mirrored it.
  if (deps.visitedFolders.has(mount.driveId)) return result;
  deps.visitedFolders.add(mount.driveId);
  deps.budget.foldersMirrored += 1;

  const relCard = path.relative(deps.boxRoot, mount.cardPath);
  // The mount is wherever the card is RIGHT NOW. A `bbx mv` of this card that
  // lands mid-pass leaves the children this pass creates under the old
  // directory: harmless and self-correcting — the next pass reads the card's
  // new home, and the strays there stay valid synced cards and pointers in the
  // meantime (nothing is deleted to make the move look clean).
  const mountDir = path.dirname(mount.cardPath);

  let folder: DriveFile;
  let listing: DriveFile[];
  try {
    folder = await deps.service.getFile(mount.driveId);
    if (folder.trashed) {
      // The mount's own folder is in the Drive trash. Listing it would return
      // nothing, and "nothing" read as membership would trash every child. The
      // card says what happened and the children are left exactly as they are —
      // an untrash on Drive puts the mount straight back.
      const message = "folder is in Drive trash";
      result.notes.push(`${relCard}: ${message}`);
      await stampOutcome(
        { mount, name: folder.name, link: null, error: message, problems: null },
        deps,
      );
      result.updated.push(relCard);
      return result;
    }
    listing = await deps.service.listFiles(mount.driveId);
  } catch (err) {
    const message = errorMessage(err);
    result.failures.push(`Folder sync failed for ${relCard}: ${message}`);
    await stampOutcome({ mount, name: null, link: null, error: message, problems: null }, deps);
    result.updated.push(relCard);
    return result;
  }

  const { children, files, failures } = await resolveChildren(listing, deps.service);
  result.failures.push(...failures);
  files.set(folder.id, folder);

  const plan = planFolderSync({
    children,
    entries: mountEntries({
      liveCards: deps.liveCards,
      mountDir,
      folderCardPath: mount.cardPath,
    }),
    claimed: deps.claimed,
    restorable: deps.restorable,
    visitedFolders: deps.visitedFolders,
    depth: mount.depth,
    foldersSoFar: deps.budget.foldersMirrored,
  });
  result.notes.push(...plan.refusals.map((refusal) => refusal.message));
  result.notes.push(...plan.duplicates);

  for (const action of plan.createFiles) {
    const cardPath = path.join(mountDir, action.cardPath);
    const claim = await claimPath({ cardPath, driveId: action.driveId, name: action.name }, deps);
    if (claim.failure !== null) result.failures.push(claim.failure);
    if (!claim.write) continue;
    // A hard-deleted card leaves retained hashes behind that describe
    // attachment files that no longer exist; a fresh mount must not inherit
    // them or the handlers read the missing files as local edits.
    deps.forgetFileState(action.driveId);
    const synced = await deps.syncFile({ driveId: action.driveId, cardPath });
    result.created.push(...synced.created);
    result.updated.push(...synced.updated);
    result.pushed.push(...synced.pushed);
    claimCreated(action.driveId, deps);
  }

  for (const action of plan.createLinks) {
    const cardPath = path.join(mountDir, action.cardPath);
    const claim = await claimPath({ cardPath, driveId: action.driveId, name: action.name }, deps);
    if (claim.failure !== null) result.failures.push(claim.failure);
    if (!claim.write) continue;
    const file = files.get(action.driveId);
    if (file === undefined) continue;
    await fs.mkdir(path.dirname(cardPath), { recursive: true });
    await writeGlinkCard(cardPath, { file, origin: "mirror" });
    result.created.push(path.relative(deps.boxRoot, cardPath));
    claimCreated(action.driveId, deps);
  }

  for (const action of plan.subfolders) {
    const cardPath = path.join(mountDir, action.cardPath);
    if (action.create) {
      const claim = await claimPath({ cardPath, driveId: action.driveId, name: action.name }, deps);
      if (claim.failure !== null) result.failures.push(claim.failure);
      if (!claim.write) continue;
      const file = files.get(action.driveId);
      if (file === undefined) continue;
      await fs.mkdir(path.dirname(cardPath), { recursive: true });
      await writeGfolderCard(cardPath, file);
      result.created.push(path.relative(deps.boxRoot, cardPath));
      claimCreated(action.driveId, deps);
    }
    if (!action.enter) continue;
    const nested = await syncFolderCard(
      { driveId: action.driveId, cardPath, depth: mount.depth + 1 },
      deps,
    );
    result.created.push(...nested.created);
    result.updated.push(...nested.updated);
    result.pushed.push(...nested.pushed);
    result.failures.push(...nested.failures);
    result.notes.push(...nested.notes);
  }

  const probed = await probeAbsentees({ absent: plan.absent, mountDir }, deps);
  result.updated.push(...probed.updated);
  result.notes.push(...probed.notes);

  // A cycle is ordinary Drive shape and stays a note; a cap means part of the
  // tree really is unmirrored, so the card says so until it isn't.
  const caps = plan.refusals.filter((refusal) => refusal.reason !== "cycle");
  const capError = caps.length > 0 ? caps.map((refusal) => refusal.message).join("; ") : null;
  await stampOutcome(
    {
      mount,
      name: folder.name,
      link: folder.webViewLink ?? driveFolderLink(folder.id),
      error: capError,
      problems: probed.problems,
    },
    deps,
  );
  result.updated.push(relCard);
  return result;
}

/**
 * This pass now speaks for the Drive ID. Any connector-made tombstone for it is
 * spent — the restore it was holding open just happened.
 */
function claimCreated(driveId: string, deps: FolderSyncDeps): void {
  deps.claimed.add(driveId);
  deps.forgetDriveTrash(driveId);
}

/**
 * Probe every card whose Drive ID left the listing, and count what the probes
 * found. `trashed` needs no count — the card is gone, which is visible on its
 * own; the other two leave a card in place that the mirror is no longer
 * accounting for, so the mount card carries the number.
 */
async function probeAbsentees(
  opts: { absent: AbsentEntry[]; mountDir: string },
  deps: FolderSyncDeps,
): Promise<{ updated: string[]; notes: string[]; problems: FolderProblemCounts }> {
  const updated: string[] = [];
  const notes: string[] = [];
  const problems: FolderProblemCounts = { notInFolder: 0, unknown: 0 };
  for (const entry of opts.absent) {
    const absent = await probeAbsent(
      { cardPath: path.join(opts.mountDir, entry.cardPath), driveId: entry.driveId },
      deps,
    );
    updated.push(...absent.updated);
    notes.push(...absent.notes);
    switch (absent.outcome) {
      case "not-in-folder":
        problems.notInFolder += 1;
        break;
      case "unknown":
        problems.unknown += 1;
        break;
      case "trashed":
        break;
      default:
        assertNever(absent.outcome);
    }
  }
  return { updated, notes, problems };
}

async function stampOutcome(
  outcome: {
    mount: FolderMount;
    name: string | null;
    link: string | null;
    error: string | null;
    /** Null when the pass never listed the folder — leave the last counts alone. */
    problems: FolderProblemCounts | null;
  },
  deps: FolderSyncDeps,
): Promise<void> {
  await stampGfolderCard(outcome.mount.cardPath, {
    name: outcome.name,
    link: outcome.link,
    lastSync: getBoxTimeISO(deps.boxRoot),
    error: outcome.error,
    problems: outcome.problems,
  });
}
