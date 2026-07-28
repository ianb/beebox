/**
 * Bulk-upload queue + per-item state machine (`docs/plans/bulk-file-upload.md`,
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
  /** Seal + fire prepare→deliver, naming any failed items. Throws on finalize error. */
  finalize: () => Promise<void>;
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

export function useBulkUpload(opts: {
  targetSessionId: string;
  contextDir: string;
}): BulkUploadController {
  const { targetSessionId, contextDir } = opts;

  const [items, setItems] = useState<BulkItemView[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Retained payloads + queue engine live in refs so they survive re-renders
  // and a retry always has the original File.
  const filesRef = useRef<Map<string, File>>(new Map());
  const queueRef = useRef<string[]>([]);
  const activeRef = useRef(0);
  const pumpRef = useRef<() => void>(() => {});
  const sessionPromiseRef = useRef<Promise<string> | null>(null);

  const ensureSession = useCallback((): Promise<string> => {
    if (!sessionPromiseRef.current) {
      sessionPromiseRef.current = createBulkSession({ targetSessionId, contextDir }).then((r) => r.sessionId);
    }
    return sessionPromiseRef.current;
  }, [targetSessionId, contextDir]);

  const startUpload = useCallback(
    async (id: string): Promise<void> => {
      const file = filesRef.current.get(id);
      if (!file) return; // cancelled/forgotten
      activeRef.current++;
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "uploading", reason: undefined } : it)));
      try {
        const sessionId = await ensureSession();
        await uploadBulkItem({ sessionId, itemId: id, file });
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "uploaded", reason: undefined } : it)));
      } catch (e) {
        const reason = describeFailure(e);
        console.error(`[bulk] Upload failed (${file.name}): ${reason}`);
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "failed", reason } : it)));
      } finally {
        activeRef.current--;
        pumpRef.current();
      }
    },
    [ensureSession],
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

  const addFiles = useCallback(
    (files: File[]): void => {
      if (files.length === 0) return;
      const fresh = files.map((file) => ({ id: crypto.randomUUID(), file }));
      for (const { id, file } of fresh) {
        filesRef.current.set(id, file);
      }
      setItems((prev) => [
        ...prev,
        ...fresh.map(({ id, file }) => ({ id, name: file.name, size: file.size, state: "queued" as const })),
      ]);
      const descriptors: BulkItemDescriptor[] = fresh.map(({ id, file }) => ({
        id,
        name: file.name,
        size: file.size,
        mimetype: file.type || undefined,
      }));
      void (async () => {
        try {
          const sessionId = await ensureSession();
          await registerBulkItems({ sessionId, items: descriptors });
          for (const { id } of fresh) enqueue(id);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error("[bulk] Registering items failed:", message);
          setError(message);
          const failedIds = new Set<string>(fresh.map((f) => f.id));
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

  const retry = useCallback(
    (id: string): void => {
      if (!filesRef.current.has(id)) return;
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, state: "queued", reason: undefined } : it)));
      enqueue(id);
    },
    [enqueue],
  );

  const cancel = useCallback(async (): Promise<void> => {
    queueRef.current = [];
    const sessionId = await sessionPromiseRef.current;
    if (sessionId) await cancelBulkSession(sessionId);
  }, []);

  const finalize = useCallback(async (): Promise<void> => {
    const sessionId = await ensureSession();
    const failedItems = items
      .filter((it) => it.state === "failed")
      .map((it) => ({ name: it.name, reason: it.reason ?? "upload failed" }));
    await finalizeBulkSession({ sessionId, failedItems });
  }, [ensureSession, items]);

  const clearError = useCallback((): void => setError(null), []);

  const counts = useMemo((): BulkUploadCounts => {
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
  }, [items]);

  return { items, counts, error, clearError, addFiles, retry, cancel, finalize };
}
