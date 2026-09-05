/**
 * Round-8 hardening finding 4: `trash.ts`'s `trashOne` derives its
 * destination from `getBoxDir(boxRoot, "trash")` — `_bookkeeping/trash` —
 * and renamed straight into it with no check that the path still resolves
 * where it looks like it does. A `_bookkeeping/trash -> ../src` symlink
 * (however it got there) made an ordinary trash/unmount rename move a card
 * OUT of the box's data area and INTO its own source tree.
 *
 * Every caller of `moveCardsToTrash` (`bbx rm`, Drive unmount) benefits from
 * the fix, so it's a shared guard rather than one caller's fix. Resolved
 * through the box-namespace fence's on-disk check
 * (`box-namespace-resolve.ts`'s `resolveBoxNamespacePathOnDisk`) — the same
 * one every HTTP/tRPC surface that writes a box-relative path must use —
 * called right before the rename: after the trash directory's `mkdir`, so a
 * symlinked trash dir that already "exists" doesn't skip the check, but
 * before any bytes move.
 */

import * as path from "node:path";
import { resolveBoxNamespacePathOnDisk } from "../../lib/box-namespace-resolve.js";

export class UnsafeTrashDestinationError extends Error {
  readonly destPath: string;
  constructor(destPath: string) {
    super(`Trash destination escapes the box's data namespace: ${destPath}`);
    this.name = "UnsafeTrashDestinationError";
    this.destPath = destPath;
  }
}

export async function assertSafeTrashDestination(boxRoot: string, absDest: string): Promise<void> {
  const rel = path.relative(boxRoot, absDest);
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: rel, mode: "write" });
  if (ns === null) throw new UnsafeTrashDestinationError(rel);
}
