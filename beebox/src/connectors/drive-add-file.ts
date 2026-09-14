/**
 * `bbx drive add` / `drive.add` — sync one Doc or Sheet two-way at a local
 * path.
 *
 * Moved out of the CLI command for the reason `drive-mounts.ts` gives about
 * the other three writes: the CLI is no longer the only caller. A box agent's
 * shell has no Google credential, so its `bbx drive add` delegates to the tRPC
 * procedure, and the two surfaces must run the same write — the claim check,
 * the first pull, the transient-state merge, and the commit — not two copies
 * that drift.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageAndCommitPaths } from "../lib/git.js";
import { attachDirFor } from "../shared/attach-path.js";
import type { DriveFile, GoogleDriveService } from "../services/google-drive.js";
import { getHandlerForMimeType, type DriveTypeHandler } from "./drive-types.js";
import { DriveCardExistsError, DriveIdClaimedError, NoDriveHandlerError } from "./drive-mount-errors.js";
import { requireDriveId } from "./drive-mounts.js";
import { resolveMountTarget, assertMountTargetWritable } from "./drive-mount-path.js";
import { withDriveMirrorLock } from "./drive-lock.js";
import { updateTransientState } from "./transient-state.js";
import { emptyFileState, type DriveTransientState } from "./google-drive.js";
import { DEFAULT_DRIVE_STATE, normalizeDriveState } from "./google-drive-state.js";
import { driveIdClaimants } from "./google-drive-tracking.js";

export interface AddDriveFileResult {
  /** Box-relative path of the card that now syncs the file. */
  cardPath: string;
  name: string;
  cardType: string;
  /** Every box-relative path the first pull wrote, the card included. */
  written: string[];
}

/**
 * Create a two-way-synced card for a Drive Doc or Sheet at `target`.
 *
 * Refusals (`DriveMountError` subclasses): an unreadable input, a type nothing
 * handles, a path outside the box, an existing card, or a Drive id another card
 * already claims.
 */
export async function addDriveFile(options: {
  boxRoot: string;
  service: GoogleDriveService;
  input: string;
  target: string;
}): Promise<AddDriveFileResult> {
  const { boxRoot, service, input, target } = options;
  const driveId = requireDriveId(input);

  const file = await service.getFile(driveId);
  const handler = getHandlerForMimeType(file.mimeType);
  if (!handler) throw new NoDriveHandlerError({ name: file.name, mimeType: file.mimeType });

  const resolved = resolveMountTarget(boxRoot, { raw: target, label: "The card path" });
  const cardPath = resolved.endsWith(`.${handler.cardType}.card`)
    ? resolved
    : `${resolved}.${handler.cardType}.card`;
  await assertMountTargetWritable(boxRoot, { absTarget: cardPath, label: "The card path" });
  await refuseIfExists({ boxRoot, cardPath });

  // Everything from here is one Drive writer's span: the claim check, the
  // pull, and the state write. A connector sync in another process would
  // otherwise pull this same file between the check and the write. The lock is
  // taken OUTSIDE the git commit below — see drive-lock.ts for why that is the
  // only safe order.
  const written = await withDriveMirrorLock(boxRoot, () =>
    addUnderLock({ boxRoot, service, card: { file, handler, cardPath } }),
  );

  return {
    cardPath: path.relative(boxRoot, cardPath),
    name: file.name,
    cardType: handler.cardType,
    written,
  };
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

/** The write span: claim check, first pull, transient state, commit. */
async function addUnderLock(opts: {
  boxRoot: string;
  service: GoogleDriveService;
  card: { file: DriveFile; handler: DriveTypeHandler; cardPath: string };
}): Promise<string[]> {
  const { boxRoot, service } = opts;
  const { file, handler, cardPath } = opts.card;
  const fileId = file.id;

  // A second card for the same Drive ID is never a valid mount: transient
  // state is keyed by Drive ID while attachments are per-card, so the two
  // working copies overwrite each other upstream. Refuse at creation.
  // Thrown rather than exited: a `process.exit` inside the lock would skip the
  // release and leave the box's Drive lock held until it went stale.
  const claimedBy = await driveIdClaimants({ boxRoot, driveId: fileId });
  if (claimedBy.length > 0) throw new DriveIdClaimedError({ driveId: fileId, claimedBy });

  // Delegate first-time creation to the handler's pull(): it knows how to write
  // the card and the type-specific local files (JSON tabs for sheets, sibling
  // .md for docs). Empty state means "fresh sync". localDir must match the
  // connector's attach scope (`<basename>.attach/`) so the card's `attach/`
  // refs resolve to the files written here.
  const localDir = attachDirFor(cardPath);
  await fs.mkdir(path.dirname(cardPath), { recursive: true });

  const fileState = emptyFileState();
  const result = await handler.pull({
    file, localDir, cardPath, boxRoot, service, state: fileState,
  });

  // Persist the per-file state into the connector's transient state file so
  // future syncs see this file as already-synced. Delta-merge under the
  // serialized RMW lock: add ONLY this new file's entry to freshly-loaded
  // state, so a concurrent `sync()` writing the same file (from another
  // process) isn't clobbered.
  await updateTransientState<DriveTransientState>({
    boxRoot,
    connectorName: "google-drive",
    defaultValue: DEFAULT_DRIVE_STATE,
    update: (fresh) => {
      const base = normalizeDriveState(fresh);
      return { ...base, files: { ...base.files, [fileId]: fileState } };
    },
  });

  await stageAndCommitPaths(boxRoot, {
    paths: result.written,
    message: `Add Drive ${handler.cardType}: ${file.name}`,
  });

  return result.written;
}
