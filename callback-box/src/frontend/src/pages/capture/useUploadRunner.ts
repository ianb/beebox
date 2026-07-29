/**
 * The transport half of capture uploads: a serial queue, one abort scope, the
 * drain list Done waits on, and the live progress of whichever transfer holds
 * the wire.
 *
 * Split out of `useCaptureUploads` (which owns the per-kind bookkeeping) so
 * each stays within its line budget and the queueing policy has one home.
 *
 * Serial by design (`concurrency: 1`). Six concurrent multi-megabyte photos
 * share one uplink, so on a weak link none completes before any per-request
 * deadline — they abort together, retry from byte zero, and spend the link
 * re-sending bytes. One at a time, each transfer gets the whole pipe and stays
 * done. Audio chunks take the priority lane: small, near-live, and they must
 * not wait behind a 10 MB photo.
 */

import { useState, useRef, useCallback } from "react";
import { UploadQueue } from "../../lib/upload-queue";

/** The one transfer currently on the wire, for the status bar's progress read. */
export interface ActiveUpload {
  filename: string;
  /** 0–100, or null while the content length is still unknown. */
  percent: number | null;
}

/** What an upload needs from the runner to do its work. */
export interface UploadRunContext {
  signal: AbortSignal;
  onProgress: (event: { loaded: number; total: number }) => void;
}

export interface EnqueueOptions {
  filename: string;
  /** Jump ahead of waiting ordinary uploads (audio chunks). */
  priority: boolean;
  send: (context: UploadRunContext) => Promise<void>;
  onSuccess: () => void;
  onFailure: (error: unknown) => void;
}

export interface UploadRunner {
  activeUpload: ActiveUpload | null;
  enqueue: (options: EnqueueOptions) => void;
  /** Resolves once every accepted upload has settled (success or failure). */
  awaitPending: () => Promise<void>;
  /** Abort queued and in-flight transfers; their promises settle as failures. */
  abortPending: () => void;
  /** Drop the drain list and reset the abort scope, abandoning in-flight work. */
  clearPending: () => void;
  /** Re-arm the abort scope so a retry after an abort can actually run. */
  rearm: () => void;
  clearActive: () => void;
}

export function useUploadRunner(): UploadRunner {
  const [activeUpload, setActiveUpload] = useState<ActiveUpload | null>(null);
  const queueRef = useRef<UploadQueue>(new UploadQueue({ concurrency: 1 }));
  const pending = useRef<Promise<void>[]>([]);
  const abortRef = useRef<AbortController>(new AbortController());

  const enqueue = useCallback((options: EnqueueOptions) => {
    const { filename, priority, send, onSuccess, onFailure } = options;
    const { signal } = abortRef.current;
    const task = queueRef.current
      .run(async () => {
        setActiveUpload({ filename, percent: null });
        try {
          await send({ signal, onProgress: reportProgress({ filename, setActiveUpload }) });
        } finally {
          // Clear only if this upload is still the displayed one — the next
          // queued task may already have claimed the slot.
          setActiveUpload((prev) => (prev && prev.filename === filename ? null : prev));
        }
      }, { priority })
      .then(onSuccess, onFailure);
    pending.current.push(task);
  }, []);

  // Every queued promise settles — failures are captured as state by
  // `onFailure`, not rejected — so this resolves even while uploads are
  // failing, and never leaves Done waiting on a rejection.
  const awaitPending = useCallback(async () => {
    await Promise.all(pending.current);
    pending.current = [];
  }, []);

  const rearm = useCallback(() => {
    if (abortRef.current.signal.aborted) abortRef.current = new AbortController();
  }, []);

  const abortPending = useCallback(() => {
    abortRef.current.abort();
    abortRef.current = new AbortController();
  }, []);

  const clearPending = useCallback(() => {
    abortRef.current.abort();
    abortRef.current = new AbortController();
    pending.current = [];
  }, []);

  const clearActive = useCallback(() => setActiveUpload(null), []);

  return { activeUpload, enqueue, awaitPending, abortPending, clearPending, rearm, clearActive };
}

/**
 * Progress reporter that only re-renders when the whole percent changes — a
 * multi-megabyte upload fires progress events far faster than the UI can
 * usefully show them.
 */
function reportProgress(opts: {
  filename: string;
  setActiveUpload: React.Dispatch<React.SetStateAction<ActiveUpload | null>>;
}): (event: { loaded: number; total: number }) => void {
  const { filename, setActiveUpload } = opts;
  return ({ loaded, total }) => {
    const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
    setActiveUpload((prev) =>
      prev && prev.filename === filename && prev.percent === percent ? prev : { filename, percent },
    );
  };
}
