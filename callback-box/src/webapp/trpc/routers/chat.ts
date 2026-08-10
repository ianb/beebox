/**
 * tRPC router for chat session metadata — directory associations,
 * lookup helpers, and the landmark-grouped picker. Streaming send +
 * history live as raw Fastify routes (see src/webapp/routes/chat.ts)
 * since they don't fit tRPC's shape.
 */

import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { chatSessionProcedures } from "./chat-session-procedures.js";
import { chatControlProcedures } from "./chat-control-procedures.js";
import { chatBootstrapProcedure } from "./chat-bootstrap-procedure.js";
import { chatPlaceMenuProcedure } from "./chat-place-menu-procedure.js";
import {
  getDirectoryForSession,
  getLastSessionForDirectory,
} from "../../../core/chat/session/history.js";
import { nearestLandmarkDir, isBoxRelativeCardPath } from "../../../core/landmark/nearest.js";
import { loadAllSessions, type ChatSessionRow } from "../../../core/chat/session/list.js";
import { CHAT_FRESH_WINDOW_MS } from "../../../core/chat/session/recent-landmark.js";
import { loadLandmarkSummaries, type LandmarkProblem } from "../../../core/landmark/summaries.js";

export interface PickerSession {
  sessionId: string;
  label: string;
  lastActivity: string;
  /** Box-relative path of the session's husk card. */
  huskPath: string;
}

/** Fields every bucket carries, landmark-backed or not. */
interface PickerBucket {
  /** Sessions touched within the fresh window (last 7 days). */
  sessions: PickerSession[];
  /** Sessions older than the fresh window, same bucket. */
  olderSessions: PickerSession[];
  /**
   * How many of the bucket's sessions are inside the fresh window — the true
   * count, NOT `sessions.length`: a non-root landmark shows one fresh session
   * inline and folds the rest into `olderSessions`, so the count isn't
   * recoverable from the rendered lists.
   */
  freshCount: number;
  /** ISO mtime of the bucket's newest session (fresh or not); null when empty. */
  latestActivity: string | null;
}

export interface PickerLandmark extends PickerBucket {
  /**
   * Box-relative path of the landmark card. Two cards in one directory each
   * get their own bucket, so this — not `dir` — is a bucket's identity (and the
   * only stable React key for a rendered row).
   */
  path: string;
  /** Box-relative directory; empty string for the root tile. */
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
}

/** A session in the unassigned bucket, which spans directories. */
export interface UnassignedSession extends PickerSession {
  /** The session's binding; "" for root-bound (and legacy unbound) chats. */
  contextDir: string;
}

/**
 * Chats whose `contextDir` has no landmark card — the box root when there's no
 * root landmark, and dirs whose landmark was deleted. They used to be dropped
 * from the picker entirely, since it mapped over landmarks only.
 */
export interface PickerUnassigned extends PickerBucket {
  sessions: UnassignedSession[];
  olderSessions: UnassignedSession[];
}

export const chatRouter = router({
  ...chatSessionProcedures,
  ...chatControlProcedures,
  ...chatBootstrapProcedure,
  ...chatPlaceMenuProcedure,
  /**
   * Most-recently-created session associated with a directory, or null
   * if no chat has been started for that directory.
   */
  lastSessionForDirectory: publicProcedure
    .input(z.object({ contextDir: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionId = await getLastSessionForDirectory(ctx.boxRoot, input.contextDir);
      return { sessionId };
    }),

  /**
   * Resolve where a "chat about this card" click should land: the nearest
   * enclosing landmark directory for the card, plus the most-recent session
   * already bound to it (null when none exists, so the caller starts a new
   * one). The card path is validated here — it flows into `?card=` and thence
   * `card.get`, so reject anything that could escape the box.
   */
  openForCard: publicProcedure
    .input(
      z.object({
        cardPath: z
          .string()
          .min(1)
          .refine(isBoxRelativeCardPath, "card path must be box-relative and contain no '..' segments"),
      }),
    )
    .query(async ({ ctx, input }): Promise<{ contextDir: string; sessionId: string | null }> => {
      const contextDir = await nearestLandmarkDir(ctx.boxRoot, { cardPath: input.cardPath });
      const sessionId = await getLastSessionForDirectory(ctx.boxRoot, contextDir);
      return { contextDir, sessionId };
    }),

  /**
   * Directory a session is associated with, or null if it isn't.
   */
  directoryFor: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const contextDir = await getDirectoryForSession(ctx.boxRoot, input.sessionId);
      return { contextDir };
    }),

  /**
   * Chats grouped by landmark for the picker page and nav badge.
   *
   * Only sessions whose log was touched within the last 7 days are
   * included. For non-root landmarks the picker shows just the latest
   * fresh session per landmark (older threads sit in the SessionList).
   * For the root tile we show *every* fresh root chat — root is the
   * catch-all and a long active thread plus a quick one-off both
   * deserve a row.
   *
   * Sessions bound to a dir with no landmark card land in the trailing
   * `unassigned` bucket instead of being dropped, and landmark cards that
   * don't parse are reported in `problems` — the switch menu reads this
   * procedure only, so both have to ride it.
   */
  byLandmark: publicProcedure.query(async ({ ctx }): Promise<{
    landmarks: PickerLandmark[];
    unassigned: PickerUnassigned;
    freshCount: number;
    problems: LandmarkProblem[];
  }> => {
    const cutoff = Date.now() - CHAT_FRESH_WINDOW_MS;
    const [{ summaries: landmarks, problems }, allSessions] = await Promise.all([
      loadLandmarkSummaries(ctx.boxRoot),
      loadAllSessions(ctx.boxRoot),
    ]);

    // Group sessions by binding. `contextDir === undefined` (legacy
    // unbound) and `contextDir === ""` (explicit root) both belong to
    // the root bucket.
    const byDir = new Map<string, ChatSessionRow[]>();
    for (const session of allSessions) {
      const bucket = session.contextDir ?? "";
      const list = byDir.get(bucket);
      if (list) list.push(session);
      else byDir.set(bucket, [session]);
    }

    const toPicker = (s: ChatSessionRow): PickerSession => ({
      sessionId: s.sessionId,
      label: s.label,
      lastActivity: s.mtime.toISOString(),
      huskPath: s.huskPath,
    });

    const picker: PickerLandmark[] = landmarks.map((lm) => {
      const all = byDir.get(lm.dir) ?? [];
      const fresh = all.filter((s) => s.mtime.getTime() >= cutoff);
      const older = all.filter((s) => s.mtime.getTime() < cutoff);
      // Non-root tiles only show the latest fresh chat inline; older
      // ones go in the collapsible "Older" list.
      const visibleFresh = lm.dir === "" ? fresh : fresh.slice(0, 1);
      const inlineOlder = lm.dir === "" ? [] : fresh.slice(1);
      const newest = all[0];
      return {
        path: lm.path,
        dir: lm.dir,
        label: lm.label,
        symbol: lm.symbol,
        symbolSrc: lm.symbolSrc,
        sessions: visibleFresh.map(toPicker),
        olderSessions: [...inlineOlder, ...older].map(toPicker),
        freshCount: fresh.length,
        latestActivity: newest === undefined ? null : newest.mtime.toISOString(),
      };
    });

    // Everything landmark-less: the root when no root landmark card exists, and
    // dirs whose landmark was deleted. Uncapped like the root tile — there is no
    // landmark page to send the overflow to.
    const landmarked = new Set(landmarks.map((lm) => lm.dir));
    const orphaned = [...byDir.entries()]
      .filter(([dir]) => !landmarked.has(dir))
      .flatMap(([dir, sessions]) => sessions.map((s) => ({ dir, session: s })));
    orphaned.sort((a, b) => b.session.mtime.getTime() - a.session.mtime.getTime());
    const toUnassigned = (entry: { dir: string; session: ChatSessionRow }): UnassignedSession => ({
      ...toPicker(entry.session),
      contextDir: entry.dir,
    });
    const orphanFresh = orphaned.filter((e) => e.session.mtime.getTime() >= cutoff);
    const newestOrphan = orphaned[0];
    const unassigned: PickerUnassigned = {
      sessions: orphanFresh.map(toUnassigned),
      olderSessions: orphaned.filter((e) => e.session.mtime.getTime() < cutoff).map(toUnassigned),
      freshCount: orphanFresh.length,
      latestActivity: newestOrphan === undefined ? null : newestOrphan.session.mtime.toISOString(),
    };

    // Sort by latest activity (most-recent landmark first), reading
    // `latestActivity` rather than the visible rows: a landmark whose only
    // chats are older than the fresh window has activity to sort on even
    // though `sessions` is empty, and sinking it among the never-used
    // landmarks would misreport it. Landmarks with no chats at all sink to
    // the bottom — root first within that group so it's always reachable,
    // then alphabetical by label.
    picker.sort((a, b) => {
      const aLatest = a.latestActivity === null ? null : Date.parse(a.latestActivity);
      const bLatest = b.latestActivity === null ? null : Date.parse(b.latestActivity);
      if (aLatest !== null && bLatest !== null) return bLatest - aLatest;
      if (aLatest !== null) return -1;
      if (bLatest !== null) return 1;
      if (a.dir === "") return -1;
      if (b.dir === "") return 1;
      return a.label.localeCompare(b.label);
    });

    // Unchanged: the nav badge counts the landmark tiles' visible rows. (It is
    // already an undercount by design — capped tiles hide their overflow — and
    // the per-bucket `freshCount`s are the honest numbers.)
    const freshCount = picker.reduce((n, l) => n + l.sessions.length, 0);
    return { landmarks: picker, unassigned, freshCount, problems };
  }),
});
