/**
 * Bulk-upload delivery — inject a prepared `upload-batch` as a first-class user
 * message into its target chat, and the `<upload>` wrapper that message carries.
 *
 * Reuses the shared deliver core (`core/chat/session/deliver-user-message.ts`);
 * unlike capture there is NO most-active fallback — a bulk batch is always
 * launched from a specific chat, so a target that no longer resolves is a broken
 * invariant (→ {@link BulkTargetGoneError}, batch left retryable), never a
 * heterogeneous file dump misdirected into "whatever chat was most active".
 */

import { invariant } from "../../lib/invariant.js";
import { humanBytes } from "../../lib/human-bytes.js";
import { loadHistory } from "../chat/session/history.js";
import type { DeliveryTarget } from "../chat/session/deliver-user-message.js";

/** Raised when a bulk batch's target chat no longer resolves at delivery. Retryable. */
export class BulkTargetGoneError extends Error {
  constructor(targetSessionId: string) {
    super(`Bulk batch target chat ${targetSessionId} no longer exists`);
    this.name = "BulkTargetGoneError";
  }
}

/**
 * Build the `<upload …>` chat-message wrapper (a first-class user message
 * pointing at the committed batch card). Pure — the exact string is a
 * chat-vocabulary lock-in, doctested exact.
 *
 * The `failed` attribute is omitted entirely when zero (a clean batch carries
 * no failed marker); `files` counts the received items and `bytes` is the
 * server-computed total. The body is the batch's one-line summary.
 */
export function buildUploadWrapper(opts: {
  /** Box-relative path of the upload-batch card. */
  docPath: string;
  fileCount: number;
  totalBytes: number;
  failedCount: number;
  summary: string;
}): string {
  // `doc` is a server-generated path (`<contextDir>/tmp-upload/<slug>/…`); a
  // double quote or newline in it would break the wrapper's attribute parsing.
  // These characters can't occur in the generated basename, and a landmark
  // contextDir carrying one is a broken invariant, not runtime input — fail
  // loudly rather than emit an unparseable message (parity with buildCaptureWrapper).
  invariant(
    !/[\n\r"]/.test(opts.docPath),
    `Upload doc path contains a quote or newline: ${JSON.stringify(opts.docPath)}`,
  );
  const attrs = [
    `doc="${opts.docPath}"`,
    `files="${String(opts.fileCount)}"`,
    `bytes="${humanBytes(opts.totalBytes)}"`,
  ];
  if (opts.failedCount > 0) attrs.push(`failed="${String(opts.failedCount)}"`);
  return `<upload ${attrs.join(" ")}>\n${opts.summary.trim()}\n</upload>`;
}

/**
 * Resolve a bulk batch's delivery target from on-disk state (no session is
 * created here). Returns the target when the batch's `targetSessionId` is still
 * a chat this box knows; returns `null` — the broken-invariant signal — when it
 * isn't (the caller fails loudly and leaves the batch retryable). No
 * most-active fallback, by design.
 */
export async function resolveBulkDeliveryTarget(opts: {
  boxRoot: string;
  targetSessionId: string;
  contextDir: string;
}): Promise<DeliveryTarget | null> {
  const known = await loadHistory(opts.boxRoot);
  if (!known.includes(opts.targetSessionId)) return null;
  return { sessionId: opts.targetSessionId, contextDir: opts.contextDir };
}
