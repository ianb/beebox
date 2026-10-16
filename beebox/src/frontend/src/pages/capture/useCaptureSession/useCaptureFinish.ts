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
 * - **Nothing landed is not a capture.** The box seals an empty session and
 *   drops it without a message, so a Done after every upload failed (or was
 *   skipped) used to close the overlay onto a chat that said nothing at all.
 *   It stays open instead and says why.
 */

import { useState, useRef, useCallback } from "react";
import { clearResumeSessionId, CaptureAlreadySealedError } from "../api";

/** How the capture surface closed: sealed for delivery, or left without sending. */
export type CaptureExit = "sealed" | "left";

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
  /** True while no media of this capture is on the box, read after the wait. */
  nothingLanded: () => boolean;
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
  /** `sealed`: Done handed the capture to the box, which delivers it to the chat. */
  onExit: (outcome: CaptureExit) => void;
}): CaptureFinish {
  const [finalizing, setFinalizing] = useState(false);
  const skipRequested = useRef(false);

  const { sessionId, recording, stopRecorder, readFailureSeq, nothingLanded } = opts;
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
      if (nothingLanded()) {
        reopenAfterSealing();
        setFinalizing(false);
        setError("Nothing uploaded, so there is nothing to send. Retry the failed uploads, or use the trash button to leave.");
        return;
      }
      await finalizeCaptureSession(sessionId);
      clearResumeSessionId(); // sealed — no longer resumable
      stopCamera();
      clearPendingAndFailed();
      onExit("sealed");
    } catch (err) {
      reopenAfterSealing();
      setError(`Finalize failed: ${err instanceof Error ? err.message : "unknown"}`);
      setFinalizing(false);
    }
  }, [
    sessionId, finalizing, recording, stopRecorder, readFailureSeq, nothingLanded, awaitPending,
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
        // A capture the worker already owns is not discardable, and the user
        // still leaves — but it is not lost either: it delivers into the chat
        // this capture was started from, where its bubble says so. Anything
        // else is a real failure.
        if (err instanceof CaptureAlreadySealedError) console.warn(`[capture] ${err.message}`);
        else console.error("[capture] Cancel failed:", err);
      }
    }
    onExit("left");
  }, [sessionId, recording, stopRecorder, clearPendingAndFailed, stopCamera, cancelCaptureSession, onExit]);

  return { finalizing, handleDone, handleCancel, skipPendingUploads };
}
