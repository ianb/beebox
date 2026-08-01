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
import {
  getDirectoryForSession,
  getLastSessionForDirectory,
} from "../../../core/chat/session/history.js";
import { nearestLandmarkDir, isBoxRelativeCardPath } from "../../../core/landmark/nearest.js";
import { loadAllSessions, type ChatSessionRow } from "../../../core/chat/session/list.js";
import { loadLandmarkSummaries } from "../../../core/landmark/summaries.js";

const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface PickerSession {
  sessionId: string;
  label: string;
  lastActivity: string;
  /** Box-relative path of the session's husk card. */
  huskPath: string;
}

export interface PickerLandmark {
  /** Box-relative directory; empty string for the root tile. */
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
  /** Sessions touched within the fresh window (last 7 days). */
  sessions: PickerSession[];
  /** Sessions older than the fresh window, same landmark. */
  olderSessions: PickerSession[];
}

export const chatRouter = router({
  ...chatSessionProcedures,
  ...chatControlProcedures,
  ...chatBootstrapProcedure,
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
   */
  byLandmark: publicProcedure.query(async ({ ctx }): Promise<{
    landmarks: PickerLandmark[];
    freshCount: number;
  }> => {
    const cutoff = Date.now() - FRESH_WINDOW_MS;
    const [landmarks, allSessions] = await Promise.all([
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
      return {
        dir: lm.dir,
        label: lm.label,
        symbol: lm.symbol,
        symbolSrc: lm.symbolSrc,
        sessions: visibleFresh.map(toPicker),
        olderSessions: [...inlineOlder, ...older].map(toPicker),
      };
    });

    // Sort by latest activity (most-recent landmark first). Landmarks
    // with no fresh chats sink to the bottom — root first within that
    // group so it's always reachable, then alphabetical by label.
    picker.sort((a, b) => {
      const aLatest = a.sessions[0] ? Date.parse(a.sessions[0].lastActivity) : null;
      const bLatest = b.sessions[0] ? Date.parse(b.sessions[0].lastActivity) : null;
      if (aLatest !== null && bLatest !== null) return bLatest - aLatest;
      if (aLatest !== null) return -1;
      if (bLatest !== null) return 1;
      if (a.dir === "") return -1;
      if (b.dir === "") return 1;
      return a.label.localeCompare(b.label);
    });

    const freshCount = picker.reduce((n, l) => n + l.sessions.length, 0);
    return { landmarks: picker, freshCount };
  }),
});
