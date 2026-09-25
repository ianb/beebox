/**
 * `drive.inspect` — resolve a Drive URL or id to what it actually is, without
 * writing anything.
 *
 * This is the verification step the 2026-09-14 incident lacked: an agent wrote
 * a correct mount card and had no way to confirm the folder id resolved. One
 * function so `bbx drive inspect` and the tRPC procedure answer identically —
 * including `claimedBy`, which turns "is this already mounted?" from a guess
 * into part of the answer.
 */

import type { GoogleDriveService } from "../services/google-drive.js";
import { getHandlerForMimeType } from "./drive-types.js";
import { requireDriveId } from "./drive-mounts.js";
import { driveIdClaimants } from "./google-drive-tracking.js";

export interface DriveInspectResult {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  /** First owner's email, or null when Drive did not say. */
  owner: string | null;
  webViewLink: string | null;
  /** The card type a sync would write, or null when nothing handles this type. */
  cardType: string | null;
  /** Cards in this box already claiming the id; empty means unclaimed. */
  claimedBy: string[];
  /**
   * The handler's own preview (sheet tabs, lossy counts, comment count,
   * revision), or null when no handler covers the type. Shape is the handler's,
   * so callers read named keys defensively rather than destructuring.
   */
  details: Record<string, unknown> | null;
}

/** Preview a Drive item. Throws `UnreadableDriveInputError` on a bad input. */
export async function inspectDriveItem(options: {
  boxRoot: string;
  service: GoogleDriveService;
  input: string;
}): Promise<DriveInspectResult> {
  const { boxRoot, service, input } = options;
  const driveId = requireDriveId(input);
  const file = await service.getFile(driveId);
  const handler = getHandlerForMimeType(file.mimeType);
  const details = handler ? (await handler.inspect(file, service)).details : null;

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    owner: file.owners?.[0]?.emailAddress ?? null,
    webViewLink: file.webViewLink ?? null,
    cardType: handler ? handler.cardType : null,
    claimedBy: await driveIdClaimants({ boxRoot, driveId: file.id }),
    details,
  };
}
