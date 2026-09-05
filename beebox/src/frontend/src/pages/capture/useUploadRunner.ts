/**
 * The transport half of capture uploads: a serial queue, one abort scope, the
 * drain list Done waits on, and the live progress of whichever transfer holds
 * the wire.
 *
 * Split out of `useCaptureUploads` (which owns the per-kind bookkeeping) so
 * each stays within its line budget and the queueing policy has one home.
 *
 * One bulk transfer at a time (`concurrency: 1`). Six concurrent multi-megabyte
 * photos share one uplink, so on a weak link none completes before any
 * per-request deadline — they abort together, retry from byte zero, and spend
 * the link re-sending bytes. One at a time, each transfer gets essentially the
 * whole pipe and stays done.
 *
 * Audio chunks run in the queue's separate small lane (`priority: true`) rather
 * than sharing the bulk slot. A 40 KB chunk queued behind a 10 MB photo would
 * wait out the entire photo — minutes on the link that motivated this — so
 * "priority" inside one lane would not have kept audio near-live. Its own slot
 * does, and the split also means a steady chunk stream can't starve photos.
 */

import { useState, useRef, useCallback, useEffect } from "react";
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
  /** Run in the small dedicated lane rather than the bulk one (audio chunks). */
  priority: boolean;
  send: (context: UploadRunContext) => Promise<void>;
  onSuccess: () => void;
  onFailure: (error: unknown) => void;
}

export interface UploadRunner {
  activeUpload: ActiveUpload | null;
  enqueue: (options: EnqueueOptions) => void;
  /** Resolves once every accepted upload has settled (success or failure),
   *  including any enqueued while the drain was already waiting. */
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
  const queueRef = useRef<UploadQueue>(new UploadQueue({ concurrency: 1, priorityConcurrency: 1 }));
  const pending = useRef<Promise<void>[]>([]);
  const abortRef = useRef<AbortController>(new AbortController());

  const enqueue = useCallback((options: EnqueueOptions) => {
    const { filename, priority, send, onSuccess, onFailure } = options;
    const { signal } = abortRef.current;
    const task = queueRef.current
      .run(async () => {
        // Only the bulk lane drives the progress readout. The two lanes run
        // concurrently and share one `activeUpload` slot, so letting audio write
        // to it too would make a photo's percentage jump to a 40 KB chunk's and
        // back — and the status bar attaches that number to the photo/file
        // counts. Audio has no percentage of its own to show.
        const showsProgress = !priority;
        if (showsProgress) setActiveUpload({ filename, percent: null });
        try {
          await send({
            signal,
            onProgress: showsProgress
              ? reportProgress({ filename, setActiveUpload })
              : () => { /* audio lane: no progress readout (see above) */ },
          });
        } finally {
          // Clear only if this upload is still the displayed one — the next
          // queued task may already have claimed the slot.
          if (showsProgress) setActiveUpload((prev) => (prev && prev.filename === filename ? null : prev));
        }
      }, { priority })
      .then(onSuccess, onFailure);
    pending.current.push(task);
  }, []);

  // Every queued promise settles — failures are captured as state by
  // `onFailure`, not rejected — so this resolves even while uploads are
  // failing, and never leaves Done waiting on a rejection.
  //
  // Loops rather than awaiting one snapshot: an upload can be enqueued WHILE
  // the drain waits (the recorder's tail chunk is the normal case), and a
  // single `Promise.all` over the array as it was would neither await that
  // late arrival nor notice it — and then the reset would discard it, letting
  // finalize seal ahead of media the user had every reason to expect.
  const awaitPending = useCallback(async () => {
    while (pending.current.length > 0) {
      const inFlight = pending.current;
      pending.current = [];
      await Promise.all(inFlight);
    }
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

  // Abort on unmount. The overlay can go away without Done or Cancel — a route
  // change, or a parent dropping it — and a multi-minute XHR would otherwise
  // keep running with its watchdog interval and listeners attached, pushing
  // state into a hook nobody is rendering.
  // Reads the ref at teardown, not at mount: `abortPending`/`clearPending`
  // swap in a fresh controller, so a captured one would be the spent scope and
  // would abort nothing.
  useEffect(() => () => abortRef.current.abort(), []);

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
