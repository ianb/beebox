/**
 * Bulk-upload queue + per-item state machine (`docs/implemented-plans/bulk-file-upload.md`,
 * Track 2).
 *
 * Owns one bulk staging session bound to the launching chat, the per-item
 * lifecycle (queued → uploading → uploaded | failed), a bounded-concurrency
 * upload pump (3 in flight), and the retained `File` objects a retry needs. The
 * model derives from capture's `useCaptureUploads` but adds the bounded queue
 * and a predeclared item registry — the server is told what to expect before
 * any bytes flow, so a dead tab still yields a truthful missing/failed list.
 *
 * The session is created lazily on the first `addFiles` (opening and closing the
 * overlay without adding anything never creates a batch). Retained payloads live
 * in refs, not state, so they survive a retry after a re-render.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BulkUploadItemError,
  cancelBulkSession,
  createBulkSession,
  finalizeBulkSession,
  registerBulkItems,
  uploadBulkItem,
  type BulkItemDescriptor,
} from "../../lib/bulk-upload-api";

/** Per-item upload lifecycle (no byte progress in v1 — states only). */
export type BulkItemState = "queued" | "uploading" | "uploaded" | "failed";

/** One item as the overlay renders it. */
export interface BulkItemView {
  id: string;
  name: string;
  size: number;
  state: BulkItemState;
  /** Human failure reason (set only in the `failed` state). */
  reason?: string;
}

export interface BulkUploadCounts {
  uploaded: number;
  failed: number;
  /** Queued + uploading — the "K pending" in the summary. */
  pending: number;
  /** True while anything is queued or uploading (gates the Done button). */
  inFlight: boolean;
  total: number;
  totalBytes: number;
}

export interface BulkUploadController {
  items: BulkItemView[];
  counts: BulkUploadCounts;
  /** Session-level error (create/register/finalize) surfaced inline; never fatal. */
  error: string | null;
  clearError: () => void;
  addFiles: (files: File[]) => void;
  retry: (id: string) => void;
  /** Discard the whole batch server-side. Safe when no session was ever created. */
  cancel: () => Promise<void>;
  /**
   * Seal + fire prepare→deliver, naming any failed items and carrying the
   * batch's introduction. Throws on finalize error.
   *
   * Returns the batch's session id so the caller can WAIT for actual delivery
   * (`waitForBulkDelivery`) before releasing anything it would need to retry —
   * a successful finalize means "sealed", never "delivered".
   */
  finalize: (opts: { note: string | undefined }) => Promise<string>;
}

const CONCURRENCY = 3;

/** Turn an upload rejection into the reason shown on the item row. */
function describeFailure(e: unknown): string {
  if (e instanceof BulkUploadItemError) {
    switch (e.kind) {
      case "batch-cap":
        return `Batch limit reached: ${e.message}`;
      case "conflict":
        return `Conflict: ${e.message}`;
      case "network":
        return `Network error: ${e.message}`;
      case "rejected":
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** Derive the summary counts from the item list (pure). */
function computeCounts(items: BulkItemView[]): BulkUploadCounts {
  let uploaded = 0;
  let failed = 0;
  let pending = 0;
  let totalBytes = 0;
  for (const it of items) {
    totalBytes += it.size;
    if (it.state === "uploaded") uploaded++;
    else if (it.state === "failed") failed++;
    else pending++;
  }
  return { uploaded, failed, pending, inFlight: pending > 0, total: items.length, totalBytes };
}

export function useBulkUpload(opts: {
  targetSessionId: string;
}): BulkUploadController {
  const { targetSessionId } = opts;

  const [items, setItems] = useState<BulkItemView[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Retained payloads + queue engine live in refs so they survive re-renders
  // and a retry always has the original File.
  const filesRef = useRef<Map<string, File>>(new Map());
  const queueRef = useRef<string[]>([]);
  const activeRef = useRef(0);
  const pumpRef = useRef<() => void>(() => {});
  const sessionPromiseRef = useRef<Promise<string> | null>(null);
  // Item ids the server has acknowledged in the registry — a retry re-registers
  // any that never made it (their register call was the thing that failed).
  const registeredRef = useRef<Set<string>>(new Set());
  // One controller aborts every in-flight upload on cancel/unmount. Lazily
  // (re)created so a resumable batch after a failed cancel still uploads.
  const abortRef = useRef<AbortController | null>(null);
  const getSignal = useCallback((): AbortSignal => {
    if (!abortRef.current) abortRef.current = new AbortController();
    return abortRef.current.signal;
  }, []);

  const ensureSession = useCallback((): Promise<string> => {
    if (!sessionPromiseRef.current) {
      const p = createBulkSession({ targetSessionId }).then((r) => r.sessionId);
      // Clear the cache on rejection so a later addFiles/retry re-attempts create
      // (otherwise every later call awaits the same permanently-rejected promise).
      p.catch(() => {
        if (sessionPromiseRef.current === p) sessionPromiseRef.current = null;
      });
      sessionPromiseRef.current = p;
    }
    return sessionPromiseRef.current;
  }, [targetSessionId]);

  const startUpload = useCallback(
    async (id: string): Promise<void> => {
      const file = filesRef.current.get(id);
      if (!file) return; // cancelled/forgotten
      const signal = getSignal();
      activeRef.current++;
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "uploading", reason: undefined } : it)));
      try {
        const sessionId = await ensureSession();
        await uploadBulkItem({ sessionId, itemId: id, file, signal });
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "uploaded", reason: undefined } : it)));
      } catch (e) {
        // A deliberate cancel/unmount aborted this request — leave the row as-is
        // (the whole overlay is tearing down or the batch is being discarded).
        if (signal.aborted) return;
        const reason = describeFailure(e);
        console.error(`[bulk] Upload failed (${file.name}): ${reason}`);
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "failed", reason } : it)));
      } finally {
        activeRef.current--;
        pumpRef.current();
      }
    },
    [ensureSession, getSignal],
  );

  const pump = useCallback((): void => {
    while (activeRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const id = queueRef.current.shift();
      if (id === undefined) break;
      void startUpload(id);
    }
  }, [startUpload]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const enqueue = useCallback(
    (id: string): void => {
      queueRef.current.push(id);
      pump();
    },
    [pump],
  );

  /**
   * Declare items to the server, then queue their uploads. Shared by the initial
   * add and by a retry whose ORIGINAL failure was the registration call — both
   * need the same register-then-enqueue-or-mark-failed sequence, and an item
   * that never registered can't be uploaded at all.
   */
  const registerAndEnqueue = useCallback(
    (entries: Array<{ id: string; file: File }>, { logLabel }: { logLabel: string }): void => {
      void (async () => {
        try {
          const sessionId = await ensureSession();
          await registerBulkItems({
            sessionId,
            items: entries.map(({ id, file }): BulkItemDescriptor => ({
              id, name: file.name, size: file.size, mimetype: file.type || undefined,
            })),
          });
          for (const { id } of entries) { registeredRef.current.add(id); enqueue(id); }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error(`[bulk] ${logLabel}: ${message}`);
          setError(message);
          const failedIds = new Set(entries.map((entry) => entry.id));
          setItems((prev) =>
            prev.map((it) =>
              failedIds.has(it.id) ? { ...it, state: "failed", reason: "Could not register with server" } : it,
            ),
          );
        }
      })();
    },
    [ensureSession, enqueue],
  );

  const addFiles = useCallback(
    (files: File[]): void => {
      if (files.length === 0) return;
      const fresh = files.map((file) => ({ id: crypto.randomUUID(), file }));
      for (const { id, file } of fresh) filesRef.current.set(id, file);
      setItems((prev) => [
        ...prev,
        ...fresh.map(({ id, file }) => ({ id, name: file.name, size: file.size, state: "queued" as const })),
      ]);
      registerAndEnqueue(fresh, { logLabel: "Registering items failed" });
    },
    [registerAndEnqueue],
  );

  const retry = useCallback(
    (id: string): void => {
      const file = filesRef.current.get(id);
      if (!file) return;
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "queued", reason: undefined } : it)));
      // Already-registered items just re-queue; one whose registration never
      // landed must re-register first (that call was what failed).
      if (registeredRef.current.has(id)) {
        enqueue(id);
        return;
      }
      registerAndEnqueue([{ id, file }], { logLabel: "Re-register on retry failed" });
    },
    [enqueue, registerAndEnqueue],
  );

  const cancel = useCallback(async (): Promise<void> => {
    queueRef.current = [];
    // Abort in-flight uploads, then discard server-side. Reset the controller so a
    // batch that stays open (a failed DELETE throws → overlay keeps it) can upload.
    abortRef.current?.abort();
    abortRef.current = null;
    const sessionId = await sessionPromiseRef.current;
    if (sessionId) await cancelBulkSession(sessionId);
  }, []);

  // Abort any in-flight uploads when the overlay unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const finalize = useCallback(async ({ note }: { note: string | undefined }): Promise<string> => {
    const sessionId = await ensureSession();
    const failedItems = items
      .filter((it) => it.state === "failed")
      .map((it) => ({ id: it.id, name: it.name, reason: it.reason ?? "upload failed" }));
    await finalizeBulkSession({ sessionId, failedItems, note });
    return sessionId;
  }, [ensureSession, items]);

  const clearError = useCallback((): void => setError(null), []);

  const counts = useMemo((): BulkUploadCounts => computeCounts(items), [items]);

  return { items, counts, error, clearError, addFiles, retry, cancel, finalize };
}
