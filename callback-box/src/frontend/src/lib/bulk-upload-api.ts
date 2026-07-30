/**
 * Bulk file-upload API client (`docs/implemented-plans/bulk-file-upload.md`, Track 2).
 *
 * Thin, zod-validated wrappers over the raw-Fastify `/api/bulk/` routes
 * (`webapp/routes/bulk-upload.ts`): create a batch bound to a target chat,
 * register expected items, stream each item's raw bytes, cancel, and finalize
 * with a named-failure list. Every call goes through `getApiBase()` +
 * `withMobileAuth` so cookie and mobile-bearer auth both apply — the same
 * transport contract as capture's upload leg.
 *
 * Deliberate-REST: item uploads stream the raw File body (no multipart, no JSON
 * envelope), which is exactly the shape tRPC can't carry — see
 * `pages/capture/capture-api.ts` for the sibling inventory note.
 */

import { z } from "zod";
import { getApiBase } from "../api";
import { RequestError } from "./errors";
import { withMobileAuth } from "./mobile-auth";

/** A predeclared batch item: a stable client id plus name/size/mimetype. */
export interface BulkItemDescriptor {
  id: string;
  name: string;
  size?: number;
  mimetype?: string;
}

/** A named upload failure carried to finalize (never silent — plan §4). */
export interface BulkFailedItem {
  /** The registry item id, so the server matches it back by id (not just name). */
  id?: string;
  name: string;
  reason: string;
}

/** Why an item upload failed, categorized for the item-list UI + finalize. */
export type BulkUploadFailureKind = "batch-cap" | "conflict" | "rejected" | "network";

/** A per-item upload failed. `kind` drives the human reason shown in the list. */
export class BulkUploadItemError extends Error {
  readonly kind: BulkUploadFailureKind;
  constructor(opts: { kind: BulkUploadFailureKind; message: string }) {
    super(opts.message);
    this.name = "BulkUploadItemError";
    this.kind = opts.kind;
  }
}

const CreateSessionResponse = z.object({
  sessionId: z.string().min(1),
  startedAt: z.string(),
  capabilities: z.object({ acceptedUploadEncodings: z.array(z.string()) }).optional(),
});

const RegisterItemsResponse = z.object({ registered: z.number() });

const FinalizeResponse = z.object({ sessionId: z.string(), staged: z.boolean() });

/** Read the server's `{ error }` body, falling back to the status line. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body !== null && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch (_e) {
    /* ignore: non-JSON body — fall back to the status line */
  }
  return res.statusText || `HTTP ${res.status}`;
}

function bulkUrl(path: string): string {
  return `${getApiBase()}/bulk${path}`;
}

/**
 * Create a bulk batch bound to a target chat. The batch's context dir is derived
 * SERVER-SIDE from `targetSessionId` (the client never supplies a box path — a
 * client-supplied dir would be a path-traversal vector).
 */
export async function createBulkSession(opts: {
  targetSessionId: string;
  items?: BulkItemDescriptor[];
}): Promise<{ sessionId: string }> {
  const res = await fetch(
    bulkUrl("/sessions"),
    withMobileAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetSessionId: opts.targetSessionId,
        items: opts.items ?? [],
      }),
    }),
  );
  if (!res.ok) {
    const message = `Create bulk batch failed: ${await errorDetail(res)}`;
    throw new RequestError(message);
  }
  const parsed = CreateSessionResponse.parse(await res.json());
  return { sessionId: parsed.sessionId };
}

/** Append items to the batch's predeclared registry (before their bytes). */
export async function registerBulkItems(opts: {
  sessionId: string;
  items: BulkItemDescriptor[];
}): Promise<void> {
  const res = await fetch(
    bulkUrl(`/sessions/${opts.sessionId}/items`),
    withMobileAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: opts.items }),
    }),
  );
  if (!res.ok) {
    const message = `Register batch items failed: ${await errorDetail(res)}`;
    throw new RequestError(message);
  }
  RegisterItemsResponse.parse(await res.json());
}

/**
 * Stream one registered item's raw bytes. The File body flows straight to the
 * server's streaming write (no multipart) under an explicit octet-stream
 * content-type so it routes through the pass-through parser. Throws a
 * {@link BulkUploadItemError} categorized by HTTP status / network fault.
 */
export async function uploadBulkItem(opts: {
  sessionId: string;
  itemId: string;
  file: File;
  signal?: AbortSignal;
}): Promise<void> {
  const { sessionId, itemId, file, signal } = opts;
  let res: Response;
  try {
    res = await fetch(
      bulkUrl(`/sessions/${sessionId}/items/${itemId}/upload`),
      withMobileAuth({
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          // The item id is the staging filename (a UUID — traversal-safe); the
          // real name rides a header so prepare can restore it on the landing.
          "X-Upload-Filename": itemId,
          "X-Upload-Original-Name": file.name,
          "X-Upload-Mime-Type": file.type || "application/octet-stream",
        },
        body: file,
        signal,
      }),
    );
  } catch (networkErr) {
    const message = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new BulkUploadItemError({ kind: "network", message });
  }
  if (res.ok) return;
  const detail = await errorDetail(res);
  if (res.status === 413) throw new BulkUploadItemError({ kind: "batch-cap", message: detail });
  if (res.status === 409) throw new BulkUploadItemError({ kind: "conflict", message: detail });
  throw new BulkUploadItemError({ kind: "rejected", message: `${detail} (${res.status})` });
}

/** Cancel and discard the whole batch (DELETE the staging session). */
export async function cancelBulkSession(sessionId: string): Promise<void> {
  const res = await fetch(
    bulkUrl(`/sessions/${sessionId}`),
    withMobileAuth({ method: "DELETE" }),
  );
  if (!res.ok) {
    const message = `Cancel bulk batch failed: ${await errorDetail(res)}`;
    throw new RequestError(message);
  }
}

/**
 * Seal the batch and fire the server-side prepare→deliver worker. The named
 * `failedItems` are persisted so the delivered `<upload>` message reports them
 * (deliver-with-failures, never silent — plan §4).
 *
 * `note` is the batch's introduction — the composer text the boxholder submitted
 * the files with. Sending it is what keeps the agent from asking what the files
 * are when the boxholder already said (`docs/mobile-contract.md` §5.6).
 */
export async function finalizeBulkSession(opts: {
  sessionId: string;
  failedItems: BulkFailedItem[];
  note: string | undefined;
}): Promise<void> {
  const res = await fetch(
    bulkUrl(`/sessions/${opts.sessionId}/finalize`),
    withMobileAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ failedItems: opts.failedItems, ...(opts.note !== undefined ? { note: opts.note } : {}) }),
    }),
  );
  if (!res.ok) {
    const message = `Finalize bulk batch failed: ${await errorDetail(res)}`;
    throw new RequestError(message);
  }
  FinalizeResponse.parse(await res.json());
}

/** What the box says about a batch after finalize. */
const SessionStatusResponse = z.object({ state: z.string() });

/**
 * The end state of a batch, from the uploader's point of view.
 *
 * `delivered` means the `<upload>` message is in the chat (or is queued to a busy
 * agent and will be). `failed` means it is not and won't be without a retry.
 * `unknown` means the box is still working and the client stopped waiting —
 * which is NOT permission to discard anything.
 */
export type BulkDeliveryOutcome = "delivered" | "failed" | "unknown";

export interface BulkDeliveryResult {
  outcome: BulkDeliveryOutcome;
  /** Failure detail for the user (set only when `failed`). */
  reason?: string;
}

/**
 * Wait for the box to actually deliver a sealed batch.
 *
 * `finalize` only *seals* — it returns `staged: true` and runs prepare→deliver in
 * the background, so a 200 there means "accepted", never "delivered". Treating it
 * as delivery is how a client ends up clearing the composer and dropping its
 * retained files while the batch later fails and no `<upload>` message ever
 * appears — i.e. the original "client says done, server shows nothing" bug in a
 * new place. So callers wait for this before destroying anything.
 *
 * Terminal reads:
 * - **404** — staging was torn down, which the worker only does after delivery.
 * - **`delivered`** — done, teardown still pending.
 * - **`delivering`** — handed to a busy agent's queue; it will land, and
 *   reconciliation re-delivers if a crash loses the queue. Good enough to
 *   release local state.
 * - **`failed:*`** — surfaced to the user; the batch stays retryable server-side.
 */
export async function waitForBulkDelivery(opts: {
  sessionId: string;
  timeoutMs: number;
  pollMs: number;
}): Promise<BulkDeliveryResult> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    let res: Response;
    try {
      // Per-request timeout: without it a single hung request outlives the
      // overall deadline and the caller waits forever.
      res = await fetch(
        bulkUrl(`/sessions/${opts.sessionId}`),
        withMobileAuth({ signal: AbortSignal.timeout(Math.min(opts.pollMs * 4, 10_000)) }),
      );
    } catch (e) {
      // A transient network blip mid-wait is not a delivery failure — keep
      // waiting rather than reporting a false negative the user would act on.
      console.warn("[bulk] Delivery poll failed; retrying:", e instanceof Error ? e.message : String(e));
      if (Date.now() >= deadline) return { outcome: "unknown" };
      await new Promise((r) => setTimeout(r, opts.pollMs));
      continue;
    }
    if (res.status === 404) return { outcome: "delivered" };
    if (res.ok) {
      const parsed = SessionStatusResponse.safeParse(await res.json());
      const state = parsed.success ? parsed.data.state : "";
      if (state === "delivered" || state === "delivering") return { outcome: "delivered" };
      if (state.startsWith("failed:")) {
        return { outcome: "failed", reason: `The box could not deliver the batch (${state}).` };
      }
    }
    if (Date.now() >= deadline) return { outcome: "unknown" };
    await new Promise((r) => setTimeout(r, opts.pollMs));
  }
}
