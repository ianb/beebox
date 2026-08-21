/**
 * Server-derived pending capture bubbles for a chat (Track 4).
 *
 * Wraps the `capture.pendingSessions` tRPC query (the reload-safe ground truth
 * for which captures are in flight for this session) and layers live
 * `capture-status` bus refinements on top for a snappier caption. The query is
 * refetched on every capture-status event (and on mount).
 *
 * A capture that finishes leaves the query — its staging session is cleaned up,
 * so the next result no longer contains it. That made success render as a row
 * silently vanishing, which is why this hook holds a finished row locally for
 * {@link RESOLVED_HOLD_MS} and renders it with a resolved face first. The
 * `delivered` event already carries everything needed for that; the hook used
 * to throw it away and merely refetch.
 *
 * `applyCaptureStatus` is fed from `useChatWs`'s event dispatcher. `retry`
 * re-POSTs finalize, which the route re-fires from a `failed:*` state;
 * `discard` deletes the staging session through the guarded cancel route. Both
 * return promises so the buttons can show their own in-flight state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { finalizeCaptureSession, cancelCaptureSession, CaptureAlreadySealedError } from "../../pages/capture/capture-api";
import { errorMessage } from "@shared/error-guards";
import type { CaptureBubbleModel, CaptureLiveStatus, CaptureResolution, CaptureVerbs } from "./capture-bubble";

/** How long a delivered/discarded row stays on screen wearing its resolved face. */
export const RESOLVED_HOLD_MS = 3_000;

/** A row kept on screen after the query dropped it, so its ending is visible. */
interface ResolvedRow {
  model: CaptureBubbleModel;
  resolution: CaptureResolution;
  /** Cancels the hold. Replaced (after cancelling) if the same id resolves twice. */
  timer: number;
}

export interface CaptureBubbles {
  bubbles: CaptureBubbleModel[];
  /** Feed a `capture-status` bus event in; refines the live caption + refetches. */
  applyCaptureStatus: (data: { stagingId: string; status: CaptureLiveStatus }) => void;
  verbs: CaptureVerbs;
}

export function useCaptureBubbles(sessionId: string | null): CaptureBubbles {
  const [liveStatus, setLiveStatus] = useState<Record<string, CaptureLiveStatus>>({});
  const [resolved, setResolved] = useState<Record<string, ResolvedRow>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const query = trpc.capture.pendingSessions.useQuery(
    { sessionId: sessionId ?? "" },
    { enabled: sessionId !== null },
  );
  const { refetch } = query;

  // The rows as last seen, so a capture that has already left the query can
  // still be rendered with its counts while its resolved face is held.
  const latestRows = useRef<CaptureBubbleModel[]>([]);

  // Every scrap of this state is keyed by staging id, and staging ids are not
  // scoped to a chat — the bus hands us every capture's events regardless of
  // which chat started it (see `InteractiveChat-ws.ts`, which forwards them all
  // and relies on this hook to ignore the ones that aren't ours). So switching
  // chats drops all of it: a row held from the chat we just left must not
  // reappear over the one we just opened.
  useEffect(() => {
    setLiveStatus({});
    setActionErrors({});
    setResolved((prev) => {
      for (const row of Object.values(prev)) clearTimeout(row.timer);
      return {};
    });
    latestRows.current = [];
  }, [sessionId]);

  useEffect(() => () => {
    for (const row of Object.values(resolvedRef.current)) clearTimeout(row.timer);
  }, []);

  const hold = useCallback((id: string, resolution: CaptureResolution) => {
    // Nothing to hold if the row was never rendered — a capture that resolved
    // before the query first returned it has no counts to show, and inventing a
    // bubble for it at the moment it ends would be its own kind of confusing.
    // That capture still goes without a resolved face; it is the one gap left.
    const model = latestRows.current.find((row) => row.id === id);
    if (!model) return;
    const timer = window.setTimeout(() => {
      setResolved((prev) => {
        const { [id]: _dropped, ...rest } = prev;
        return rest;
      });
    }, RESOLVED_HOLD_MS);
    setResolved((prev) => {
      // A second status for the same id restarts the hold rather than letting
      // the first timer cut the second face short.
      const existing = prev[id];
      if (existing) clearTimeout(existing.timer);
      return { ...prev, [id]: { model, resolution, timer } };
    });
  }, []);

  const clearError = useCallback((id: string) => {
    setActionErrors((prev) => {
      const { [id]: _cleared, ...rest } = prev;
      return rest;
    });
  }, []);

  const applyCaptureStatus = useCallback(
    (data: { stagingId: string; status: CaptureLiveStatus }) => {
      setLiveStatus((prev) => ({ ...prev, [data.stagingId]: data.status }));
      // The capture moved on; whatever a previous action reported is history.
      clearError(data.stagingId);
      if (data.status === "delivered") hold(data.stagingId, "delivered");
      // The query is the source of truth for which bubbles exist; refetch so a
      // delivered/failed transition (and its staging cleanup) is reflected.
      void refetch();
    },
    [refetch, hold, clearError],
  );

  const retry = useCallback(
    async (id: string) => {
      clearError(id);
      try {
        await finalizeCaptureSession(id);
      } catch (e) {
        console.error(`[capture] Retry of ${id} failed:`, e);
        setActionErrors((prev) => ({ ...prev, [id]: `couldn't retry — ${errorMessage(e)}` }));
      }
      await refetch();
    },
    [refetch, clearError],
  );

  const discard = useCallback(
    async (id: string) => {
      clearError(id);
      try {
        await cancelCaptureSession(id);
        hold(id, "discarded");
      } catch (e) {
        // Sealed under us: not a failure to report as one — the refetch below
        // puts the row back in its working face and it delivers from there.
        const sealed = e instanceof CaptureAlreadySealedError;
        if (sealed) console.warn(`[capture] ${e.message}`);
        else console.error(`[capture] Discard of ${id} failed:`, e);
        setActionErrors((prev) => ({
          ...prev,
          [id]: sealed ? "already being delivered" : `couldn't discard — ${errorMessage(e)}`,
        }));
      }
      await refetch();
    },
    [refetch, hold, clearError],
  );

  const pending = query.data ? query.data.pending : [];
  const live: CaptureBubbleModel[] = pending.map((p) => ({
    id: p.id,
    state: p.state,
    counts: p.counts,
    startedAt: p.startedAt,
    lastActivityAt: p.lastActivityAt,
    liveStatus: liveStatus[p.id],
    actionError: actionErrors[p.id],
  }));

  // A held row outlives the query result it came from, so merge rather than
  // replace — and keep the whole list in capture order, so a row doesn't jump
  // position on its way out.
  // Recorded after render rather than during it: `hold` reads this when a
  // status event arrives, and reads whatever the last render knew.
  useEffect(() => {
    latestRows.current = live;
  });

  // Read only by the unmount cleanup, which must not re-run per resolved row.
  const resolvedRef = useRef(resolved);
  useEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);

  const held = Object.values(resolved)
    .filter((row) => !live.some((p) => p.id === row.model.id))
    .map((row) => ({ ...row.model, resolution: row.resolution }));
  const bubbles = [...live, ...held].toSorted((a, b) => a.startedAt.localeCompare(b.startedAt));

  // One object, memoized, so the message-list context it feeds stays
  // referentially stable across a send (see this directory's CLAUDE.md).
  const verbs = useMemo(() => ({ retry, discard }), [retry, discard]);

  return { bubbles, applyCaptureStatus, verbs };
}
