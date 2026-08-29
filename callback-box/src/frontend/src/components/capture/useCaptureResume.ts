/**
 * Crash-resume query for capture mode (Track 5).
 *
 * On entering capture mode we ask the box whether an earlier staging session
 * for this chat (or the exact session id this client still holds in
 * localStorage) is still `open` with media on it — a capture a crash or
 * navigation left mid-flight. If so, the overlay prompts resume / submit-now /
 * discard before starting a fresh capture. Submit-now and discard act on the
 * staging session directly through the capture REST API.
 */

import { useCallback, useEffect, useState } from "react";
import {
  loadResumeSessionId,
  clearResumeSessionId,
} from "../../pages/capture/capture-api";
import { useCaptureApi } from "../../pages/capture/capture-api-context";

export interface ResumableCaptureView {
  id: string;
  counts: { photos: number; files: number; audioSegments: number };
  startedAt: string;
}

export interface CaptureResume {
  loading: boolean;
  /** Resumable captures, oldest first; the overlay prompts on the newest. */
  resumable: ResumableCaptureView[];
  /** Finalize the abandoned session as-is (a deliberate, non-partial submit). */
  submitNow: (id: string) => Promise<void>;
  /** Discard the abandoned session's staged media. */
  discard: (id: string) => Promise<void>;
}

export function useCaptureResume(targetSessionId: string | null): CaptureResume {
  const { listResumableCaptureSessions, finalizeCaptureSession, cancelCaptureSession } = useCaptureApi();
  const clientSessionId = loadResumeSessionId();
  const [loading, setLoading] = useState(true);
  const [resumable, setResumable] = useState<ResumableCaptureView[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listResumableCaptureSessions(targetSessionId, clientSessionId)
      .then((result) => {
        if (active) setResumable(result.resumable);
      })
      .catch((error: unknown) => {
        console.error("[capture] Failed to load resumable sessions:", error);
        if (active) setResumable([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientSessionId, listResumableCaptureSessions, targetSessionId]);

  const submitNow = useCallback(async (id: string): Promise<void> => {
    await finalizeCaptureSession(id);
    clearResumeSessionId();
  }, [finalizeCaptureSession]);

  const discard = useCallback(async (id: string): Promise<void> => {
    await cancelCaptureSession(id);
    clearResumeSessionId();
  }, [cancelCaptureSession]);

  return {
    loading,
    resumable,
    submitNow,
    discard,
  };
}
