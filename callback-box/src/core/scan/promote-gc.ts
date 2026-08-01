/**
 * Quarantine garbage collection, run as part of every promote pass.
 *
 * Nothing else will do it: the generic `tmp/` sweep skips directories
 * (`core/housekeeping.ts`), so `tmp/scan-quarantine/` grows forever without
 * this. Two lifetimes, and both are chosen so `/api/scan/check` keeps giving
 * the uploader a truthful answer at every stage:
 *
 *   - `imported` — file AND sidecar go on the next pass. The upload ledger has
 *     the hash by then, and `check` consults the ledger first, so the hash
 *     still answers `imported` with nothing left in quarantine.
 *   - `rejected` — kept whole until its question card is resolved. At that
 *     moment the bytes are deleted and the sidecar becomes a TOMBSTONE
 *     (`resolvedAt` set), which still answers `rejected` with its reason.
 *     Thirty days later the tombstone goes too, and the hash reverts to
 *     `unknown` — a re-upload then re-validates, which is the correct
 *     behavior that far out.
 *
 * "Resolved" is any question status other than `pending` — and a card that is
 * gone counts as resolved, because deleting the question is how a boxholder
 * (or the aging sweep) finishes with it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseFrontmatterObject } from "../../cards/index.js";
import { errnoCode } from "../../lib/error-guards.js";
import { getBoxTime, getBoxTimeISO } from "../../lib/time.js";
import {
  deleteQuarantineEntry,
  deleteQuarantineFile,
  readQuarantineEntry,
  updateQuarantineState,
  type ScanQuarantineEntry,
} from "./quarantine.js";

/** How long a resolved rejection stays answerable as `rejected`. */
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface QuarantineGcResult {
  /** Imported entries removed (file + sidecar). */
  importedRemoved: number;
  /** Rejections whose bytes were dropped, leaving a tombstone. */
  tombstoned: number;
  /** Tombstones past the retention window, removed entirely. */
  tombstonesRemoved: number;
}

/**
 * Whether a rejection's question is done with. A missing card is resolved: the
 * boxholder deleted it, or the aging sweep did.
 */
async function isQuestionResolved(boxRoot: string, questionRef: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, questionRef), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return true;
    console.warn(`[scan] Could not read rejection question ${questionRef}; keeping the quarantined file:`, e);
    return false;
  }
  const fields = parseFrontmatterObject(content);
  if (fields === null) {
    console.warn(`[scan] Rejection question ${questionRef} has no readable frontmatter; keeping the quarantined file`);
    return false;
  }
  return fields["status"] !== "pending";
}

/** Collect one quarantine directory's finished entries. */
export async function collectQuarantine(opts: {
  boxRoot: string;
  entries: ScanQuarantineEntry[];
}): Promise<QuarantineGcResult> {
  const { boxRoot, entries } = opts;
  const result: QuarantineGcResult = { importedRemoved: 0, tombstoned: 0, tombstonesRemoved: 0 };
  const now = getBoxTime(boxRoot).getTime();

  for (const snapshot of entries) {
    // Re-read immediately before acting: a PUT can re-store a hash (the retry
    // path for a rejection) between the caller's listing and here, and deleting
    // on a stale verdict would destroy bytes the uploader believes are safely
    // pending. A changed entry is simply left for the next pass.
    const entry = await readQuarantineEntry(boxRoot, snapshot.sha256);
    if (entry === null) continue;
    if (entry.state !== snapshot.state || entry.resolvedAt !== snapshot.resolvedAt) continue;

    if (entry.state === "imported") {
      await deleteQuarantineEntry(boxRoot, entry);
      result.importedRemoved++;
      continue;
    }
    if (entry.state !== "rejected") continue;

    if (entry.resolvedAt !== undefined) {
      const resolvedMs = new Date(entry.resolvedAt).getTime();
      // An unparseable timestamp would make `now - NaN` false forever, silently
      // pinning the tombstone; treat it as due now instead.
      const due = Number.isNaN(resolvedMs) || now - resolvedMs >= TOMBSTONE_RETENTION_MS;
      if (due) {
        await deleteQuarantineEntry(boxRoot, entry);
        result.tombstonesRemoved++;
      }
      continue;
    }

    // No question card yet → question emission runs before GC in a pass, so
    // this is an entry that failed to get one; leave it whole and retry later.
    if (entry.questionRef === undefined) continue;
    if (!(await isQuestionResolved(boxRoot, entry.questionRef))) continue;

    await deleteQuarantineFile(boxRoot, entry);
    await updateQuarantineState(boxRoot, {
      sha256: entry.sha256,
      state: "rejected",
      resolvedAt: getBoxTimeISO(boxRoot),
    });
    result.tombstoned++;
  }

  return result;
}
