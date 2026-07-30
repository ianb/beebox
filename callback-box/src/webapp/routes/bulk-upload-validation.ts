/**
 * Request-body validation for the bulk file-upload routes.
 *
 * Split out of `bulk-upload.ts` to keep it under the line cap. Everything here
 * is boundary validation of untrusted client input (engineering principle #3):
 * length caps on client-supplied strings, the per-request item cap, registry
 * duplicate/overflow rules, and the batch-introduction length bound.
 */

import { z } from "zod";
import { MAX_STAGED_ITEMS } from "../../core/capture/staging-limits.js";
import type { StagingBulkItem } from "../../core/capture/staging-store.js";

/** Bound client-supplied id/name/mimetype strings (X9 — untrusted lengths). */
const MAX_ITEM_FIELD_LENGTH = 512;
/** Items accepted per create/register request; the registry TOTAL cap is X3's 500. */
const MAX_ITEMS_PER_REQUEST = 500;

const BulkItemSchema = z.object({
  id: z.string().min(1).max(MAX_ITEM_FIELD_LENGTH),
  name: z.string().max(MAX_ITEM_FIELD_LENGTH),
  size: z.number().optional(),
  mimetype: z.string().max(MAX_ITEM_FIELD_LENGTH).optional(),
});

export const CreateBulkBodySchema = z.object({
  // No `contextDir`: it's derived server-side from `targetSessionId` (a
  // client-supplied dir would be a path-traversal vector — see below).
  targetSessionId: z.string().min(1),
  items: z.array(BulkItemSchema).max(MAX_ITEMS_PER_REQUEST).optional(),
});

export const RegisterItemsBodySchema = z.object({
  items: z.array(BulkItemSchema).min(1).max(MAX_ITEMS_PER_REQUEST),
});

/** The first item id appearing twice in `items`, or `null` when all unique. */
function firstDuplicateId(items: StagingBulkItem[]): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) return item.id;
    seen.add(item.id);
  }
  return null;
}

/**
 * Validate an addition to a session's registry against duplicate ids and the
 * total-item cap, returning a 400 message or `null` when it's clean. A NEW id
 * colliding with one already registered is rejected (an update-in-place would
 * silently overwrite the earlier item's claims); re-sending EXISTING ids is
 * fine (idempotent re-register while the picker streams).
 */
export function registryAdditionError(opts: { existing: StagingBulkItem[]; incoming: StagingBulkItem[] }): string | null {
  const dupe = firstDuplicateId(opts.incoming);
  if (dupe !== null) return `Duplicate item id in registry: ${dupe}`;
  const existingIds = new Set(opts.existing.map((it) => it.id));
  const newIds = opts.incoming.filter((it) => !existingIds.has(it.id)).length;
  if (opts.existing.length + newIds > MAX_STAGED_ITEMS) {
    return `Registry would exceed the ${String(MAX_STAGED_ITEMS)}-item cap`;
  }
  return null;
}

/**
 * Upper bound on the batch introduction. Untrusted client prose, so it is capped
 * at the boundary — far above any real composer message, far below the server's
 * body limit.
 */
const MAX_NOTE_LENGTH = 10_000;

export const FinalizeBodySchema = z.object({
  failedItems: z
    .array(z.object({ id: z.string().optional(), name: z.string(), reason: z.string() }))
    .optional(),
  /**
   * The user's introduction for the batch — the composer text they submitted the
   * photos with. Optional: an uploader with an empty composer sends none, and a
   * batch without one is exactly the "ask before filing" case.
   */
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
});
