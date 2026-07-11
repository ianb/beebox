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

import { useCallback } from "react";
import { trpc } from "../../lib/trpc";
import {
  loadResumeSessionId,
  clearResumeSessionId,
  finalizeCaptureSession,
  cancelCaptureSession,
} from "../../pages/capture/capture-api";

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
  const clientSessionId = loadResumeSessionId();
  const query = trpc.capture.resumableSessions.useQuery({ targetSessionId, clientSessionId });

  const submitNow = useCallback(async (id: string): Promise<void> => {
    await finalizeCaptureSession(id);
    clearResumeSessionId();
  }, []);

  const discard = useCallback(async (id: string): Promise<void> => {
    await cancelCaptureSession(id);
    clearResumeSessionId();
  }, []);

  return {
    loading: query.isLoading,
    resumable: query.data ? query.data.resumable : [],
    submitNow,
    discard,
  };
}
