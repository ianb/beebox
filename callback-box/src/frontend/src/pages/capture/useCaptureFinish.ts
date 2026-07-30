/**
 * The Done / Skip / Cancel end of capture mode.
 *
 * Split out of `useCaptureSession` (which owns acquisition) because sealing has
 * its own rules and its own line budget. Two of them are load-bearing:
 *
 * - **Done is never gated on uploads finishing.** It waits, showing the count
 *   and a Skip affordance, so a slow link delays the seal while a broken one
 *   doesn't trap the user. Gating Done on "no uploads in progress" is what made
 *   the failure banner's "press Done to finalize without them" a lie.
 * - **A failure that appears during the wait hands the decision back.** The
 *   banner the user saw before pressing Done only covered failures that had
 *   already happened; sealing over new ones would discard that media without
 *   ever offering the retry.
 */

import { useState, useRef, useCallback } from "react";
import { clearResumeSessionId } from "./capture-api";

export interface CaptureFinish {
  finalizing: boolean;
  handleDone: () => Promise<void>;
  handleCancel: () => Promise<void>;
  skipPendingUploads: () => void;
}

export function useCaptureFinish(opts: {
  sessionId: string | null;
  recording: boolean;
  /** Stops the recorder and awaits its tail chunk; null when not recording. */
  stopRecorder: () => Promise<void>;
  /** Monotonic failure counter, read synchronously across the await. */
  readFailureSeq: () => number;
  /** Refuse new media for the rest of the seal. */
  closeForSealing: () => void;
  /** Re-open when a Done bounces back instead of sealing. */
  reopenAfterSealing: () => void;
  awaitPending: () => Promise<void>;
  abortPending: () => void;
  clearPendingAndFailed: () => void;
  stopCamera: () => void;
  finalizeCaptureSession: (sessionId: string) => Promise<void>;
  cancelCaptureSession: (sessionId: string) => Promise<void>;
  setError: (message: string) => void;
  onExit: () => void;
}): CaptureFinish {
  const [finalizing, setFinalizing] = useState(false);
  const skipRequested = useRef(false);

  const { sessionId, recording, stopRecorder, readFailureSeq } = opts;
  const { closeForSealing, reopenAfterSealing } = opts;
  const { awaitPending, abortPending, clearPendingAndFailed, stopCamera } = opts;
  const { finalizeCaptureSession, cancelCaptureSession, setError, onExit } = opts;

  // Abandon whatever is still on the wire so the pending Done proceeds with what
  // has landed. Aborted transfers settle as failures, so the `awaitPending` that
  // `handleDone` is sitting on resolves right after this. The flag records that
  // those failures were asked for, so the seal doesn't bounce the user back.
  const skipPendingUploads = useCallback(() => {
    skipRequested.current = true;
    abortPending();
  }, [abortPending]);

  // Read through a call so the flag survives control-flow narrowing: TypeScript
  // otherwise treats it as still `false` after the reset below, since it can't
  // see `skipPendingUploads` mutate it from an event handler mid-await.
  const skipWasRequested = useCallback((): boolean => skipRequested.current, []);

  const handleDone = useCallback(async () => {
    if (!sessionId || finalizing) return;
    skipRequested.current = false;
    setFinalizing(true);
    try {
      const failuresBefore = readFailureSeq();
      // Stop the recorder BEFORE closing the barrier: its final `dataavailable`
      // is legitimate media for this capture, and closing first would drop the
      // tail chunk that `stopAsync` exists to preserve.
      if (recording) await stopRecorder();
      closeForSealing();
      await awaitPending();
      if (!skipWasRequested() && readFailureSeq() > failuresBefore) {
        reopenAfterSealing();
        setFinalizing(false);
        setError("Some uploads failed while finishing. Retry them, or press Done again to finalize without them.");
        return;
      }
      await finalizeCaptureSession(sessionId);
      clearResumeSessionId(); // sealed — no longer resumable
      stopCamera();
      clearPendingAndFailed();
      onExit();
    } catch (err) {
      reopenAfterSealing();
      setError(`Finalize failed: ${err instanceof Error ? err.message : "unknown"}`);
      setFinalizing(false);
    }
  }, [
    sessionId, finalizing, recording, stopRecorder, readFailureSeq, awaitPending,
    closeForSealing, reopenAfterSealing, skipWasRequested, finalizeCaptureSession,
    stopCamera, clearPendingAndFailed, setError, onExit,
  ]);

  const handleCancel = useCallback(async () => {
    // Await the tail chunk even on cancel: it may become a resumable session.
    if (recording) await stopRecorder();
    clearPendingAndFailed();
    stopCamera();
    if (sessionId) {
      try {
        await cancelCaptureSession(sessionId);
        clearResumeSessionId(); // discarded — no longer resumable
      } catch (err) {
        console.error("[capture] Cancel failed:", err);
      }
    }
    onExit();
  }, [sessionId, recording, stopRecorder, clearPendingAndFailed, stopCamera, cancelCaptureSession, onExit]);

  return { finalizing, handleDone, handleCancel, skipPendingUploads };
}
