/**
 * Server-derived pending capture bubbles for a chat (Track 4).
 *
 * Wraps the `capture.pendingSessions` tRPC query (the reload-safe ground truth
 * for which captures are in flight for this session) and layers live
 * `capture-status` bus refinements on top for a snappier caption. The query is
 * refetched on every capture-status event (and on mount); a delivered capture
 * cleans up its staging session, so it simply drops out of the next query
 * result — no client-side reconcile needed.
 *
 * `applyCaptureStatus` is fed from `useChatWs`'s event dispatcher; `retry`
 * re-POSTs finalize, which the route re-fires from a `failed:*` state.
 */

import { useCallback, useState } from "react";
import { trpc } from "../../lib/trpc";
import { finalizeCaptureSession } from "../../pages/capture/capture-api";
import type { CaptureBubbleModel, CaptureLiveStatus } from "./capture-bubble";

export interface CaptureBubbles {
  bubbles: CaptureBubbleModel[];
  /** Feed a `capture-status` bus event in; refines the live caption + refetches. */
  applyCaptureStatus: (data: { stagingId: string; status: CaptureLiveStatus }) => void;
  /** Retry a failed capture by re-sealing it. */
  retry: (id: string) => void;
}

export function useCaptureBubbles(sessionId: string | null): CaptureBubbles {
  const [liveStatus, setLiveStatus] = useState<Record<string, CaptureLiveStatus>>({});
  const query = trpc.capture.pendingSessions.useQuery(
    { sessionId: sessionId ?? "" },
    { enabled: sessionId !== null },
  );
  const { refetch } = query;

  const applyCaptureStatus = useCallback(
    (data: { stagingId: string; status: CaptureLiveStatus }) => {
      setLiveStatus((prev) => ({ ...prev, [data.stagingId]: data.status }));
      // The query is the source of truth for which bubbles exist; refetch so a
      // delivered/failed transition (and its staging cleanup) is reflected.
      void refetch();
    },
    [refetch],
  );

  const retry = useCallback(
    (id: string) => {
      finalizeCaptureSession(id)
        .then(() => refetch())
        .catch((e: unknown) => {
          console.error(`[capture] Retry of ${id} failed:`, e);
        });
    },
    [refetch],
  );

  const pending = query.data ? query.data.pending : [];
  const bubbles: CaptureBubbleModel[] = pending.map((p) => ({
    id: p.id,
    state: p.state,
    counts: p.counts,
    liveStatus: liveStatus[p.id],
  }));

  return { bubbles, applyCaptureStatus, retry };
}
