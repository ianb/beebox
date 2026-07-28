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
 */
export async function finalizeBulkSession(opts: {
  sessionId: string;
  failedItems: BulkFailedItem[];
}): Promise<void> {
  const res = await fetch(
    bulkUrl(`/sessions/${opts.sessionId}/finalize`),
    withMobileAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ failedItems: opts.failedItems }),
    }),
  );
  if (!res.ok) {
    const message = `Finalize bulk batch failed: ${await errorDetail(res)}`;
    throw new RequestError(message);
  }
  FinalizeResponse.parse(await res.json());
}
