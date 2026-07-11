/**
 * Pending-capture selection (Track 4).
 *
 * A staging session that has been sealed but not yet delivered is an in-flight
 * capture: the chat that started it should show a pending bubble until delivery
 * lands (or the retry affordance if it failed). This module is the pure,
 * server-derived source of truth behind the `capture.pendingSessions` tRPC
 * query — the pending bubble renders from it (reload-safe) and refines the
 * caption live from `capture-status` bus events.
 *
 * `delivered` sessions are cleaned up off disk, so they never appear here; a
 * still-`open` session (capture mode is live, nothing finalized) is not pending.
 */

import { stagingSessionIsEmpty, type StagingSession, type StagingSessionState } from "./staging-store.js";

/** Media tallies shown in the pending bubble's caption line. */
export interface PendingCaptureCounts {
  photos: number;
  files: number;
  audioSegments: number;
}

/** One in-flight capture surfaced to a chat's pending-bubble UI. */
export interface PendingCapture {
  id: string;
  state: StagingSessionState;
  counts: PendingCaptureCounts;
  /** When capture started (the staging session's creation time). */
  startedAt: string;
}

/**
 * A sealed-but-undelivered state: the capture is finalized and working its way
 * through preparation/delivery, or has failed and can be retried. Excludes
 * `open` (still capturing) and `delivered` (done, and cleaned up off disk).
 */
export function isPendingCaptureState(state: StagingSessionState): boolean {
  return state === "sealed" || state === "preparing" || state === "delivering" || state.startsWith("failed:");
}

/**
 * The in-flight captures bound to one chat session, oldest first. Filters the
 * on-disk staging sessions to those whose `targetSessionId` matches and whose
 * state is pending, projecting each to the minimal shape the bubble needs.
 */
export function selectPendingCaptures(opts: {
  sessions: StagingSession[];
  sessionId: string;
}): PendingCapture[] {
  const { sessions, sessionId } = opts;
  return sessions
    .filter((s) => s.targetSessionId === sessionId && isPendingCaptureState(s.state))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((s) => ({
      id: s.id,
      state: s.state,
      counts: { photos: s.photos.length, files: s.files.length, audioSegments: s.segments.length },
      startedAt: s.createdAt,
    }));
}

/** A resumable staged capture surfaced to the resume prompt (Track 5). */
export interface ResumableCapture {
  id: string;
  counts: PendingCaptureCounts;
  /** When capture started (the staging session's creation time). */
  startedAt: string;
}

/**
 * The still-`open`, non-empty staged captures a returning client may resume
 * (Track 5). A session qualifies when it's bound to the chat capture is being
 * entered from (`targetSessionId`) OR it's the exact session id the client
 * still holds in localStorage (`clientSessionId` — belt-and-braces for the
 * standalone `targetSessionId: null` case). Empty sessions (a bare create with
 * no media, including the fresh one the client just made) are excluded, so the
 * prompt only offers a capture with real content to lose.
 *
 * Cross-user isolation (X4): only a session whose `createdBy` matches the
 * requesting user is ever returned, so presenting another user's chat id or a
 * stale localStorage id (shared browser) can't surface their capture. `null`
 * matches `null` — an unauthenticated caller sees only unauthenticated captures.
 */
export function selectResumableCaptures(opts: {
  sessions: StagingSession[];
  targetSessionId: string | null;
  clientSessionId: string | null;
  requestingUser: string | null;
}): ResumableCapture[] {
  const { sessions, targetSessionId, clientSessionId, requestingUser } = opts;
  return sessions
    .filter((s) => s.state === "open" && !stagingSessionIsEmpty(s))
    .filter((s) => s.createdBy === requestingUser)
    .filter(
      (s) =>
        (targetSessionId !== null && s.targetSessionId === targetSessionId) ||
        (clientSessionId !== null && s.id === clientSessionId),
    )
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((s) => ({
      id: s.id,
      counts: { photos: s.photos.length, files: s.files.length, audioSegments: s.segments.length },
      startedAt: s.createdAt,
    }));
}
