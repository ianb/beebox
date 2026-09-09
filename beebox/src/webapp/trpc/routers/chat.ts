/**
 * tRPC router for chat session metadata — directory associations,
 * lookup helpers, and the landmark-grouped picker. Streaming send +
 * history live as raw Fastify routes (see src/webapp/routes/chat.ts)
 * since they don't fit tRPC's shape.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { cardFields, parseCardText } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { BriefingSchema } from "../../../schemas/briefing.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { chatSessionProcedures } from "./chat-session-procedures.js";
import { chatControlProcedures } from "./chat-control-procedures.js";
import { chatBootstrapProcedure } from "./chat-bootstrap-procedure.js";
import { chatPlaceMenuProcedure } from "./chat-place-menu-procedure.js";
import {
  getDirectoryForSession,
  getLastSessionForDirectory,
} from "../../../core/chat/session/history.js";
import { nearestLandmarkDir, boxRelativePathSchema } from "../../../core/landmark/nearest.js";
import { getChatRuntime } from "../../chat-runtime.js";
import { loadChatLists, deadHuskLabel, type ChatSessionRow } from "../../../core/chat/session/list.js";
import type { TranscriptState } from "../../../core/chat/session/availability.js";
import { CHAT_FRESH_WINDOW_MS } from "../../../core/chat/session/recent-landmark.js";
import { loadLandmarkSummaries, type LandmarkProblem } from "../../../core/landmark/summaries.js";
import type { CardSymbolData } from "../../../shared/card-symbol.js";

export interface PickerSession {
  sessionId: string;
  label: string;
  lastActivity: string;
  /** Box-relative path of the session's husk card. */
  huskPath: string;
}

/**
 * A chat that exists only as a card now — its transcript is not on this
 * machine. No `lastActivity`: the transcript that carried it is gone.
 */
export interface DeadPickerSession {
  sessionId: string;
  label: string;
  /** Box-relative path of the husk card — the only place this row can go. */
  huskPath: string;
  transcript: TranscriptState;
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
  /**
   * The bucket's chats with no transcript left. Kept out of `sessions` and
   * `olderSessions` because those are resumable and these are not — a row here
   * links to the card, never to `/chat?session=`.
   */
  dead: DeadPickerSession[];
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
  /** The mark, `src` resolved to a box-relative path; null when there is none. */
  symbol: CardSymbolData | null;
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

/**
 * The `openers:` listed in `<dir>/briefing.briefing.card`, or `null` when that
 * briefing doesn't exist (the caller's signal to fall back). A briefing that
 * exists but is malformed reads as an empty list, not a gap — a broken card
 * shouldn't silently promote another directory's openers into its chat.
 */
async function readBriefingOpeners(boxRoot: string, dir: string): Promise<string[] | null> {
  const relPath = path.posix.join(dir, "briefing.briefing.card");
  let content: string;
  try {
    content = await readFile(path.join(boxRoot, relPath), "utf-8");
  } catch (e) {
    // Absent is ordinary; anything else (permissions, a directory in the way)
    // is worth a log line.
    if (errnoCode(e) === "ENOENT") return null;
    console.warn(`[chat.openers] could not read ${relPath}:`, e);
    return null;
  }
  try {
    const card = parseCardText(content, { source: relPath, schemas: await createCardSchemaMap(boxRoot) });
    const openers = cardFields(card, BriefingSchema).openers ?? [];
    return openers.map((o) => o.trim()).filter((o) => o !== "");
  } catch (e) {
    // A malformed briefing shouldn't blank the chat — degrade to no openers,
    // but say so (the boxholder's card needs fixing).
    console.warn(`[chat.openers] could not parse ${relPath}:`, e);
    return [];
  }
}

/**
 * A coined-but-unstarted chat bound to `contextDir`, or null.
 *
 * Reservations live on the per-box runtime, which a box that is only being
 * read (no chat runtime wired) does not have — hence the soft accessor rather
 * than `requireRuntime`. No runtime means no reservations to find, not an
 * error: the caller falls back to the history answer.
 */
function reservedSessionForDirectory(boxRoot: string, contextDir: string): string | null {
  return getChatRuntime(boxRoot)?.registry.reservationForDirectory(contextDir) ?? null;
}

export const chatRouter = router({
  ...chatSessionProcedures,
  ...chatControlProcedures,
  ...chatBootstrapProcedure,
  ...chatPlaceMenuProcedure,
  /**
   * Most-recently-created session associated with a directory, or null
   * if no chat has been started for that directory.
   *
   * A committed chat wins over a reservation even when the reservation is
   * newer: the reserved one is empty by definition, and "open this landmark"
   * means resume its conversation. The reservation is the fallback so that a
   * fresh landmark chat you left without sending is the one you come back to,
   * rather than a second coined id every time
   * (`ChatReservationStore.latestForDirectory`).
   */
  lastSessionForDirectory: publicProcedure
    .input(z.object({ contextDir: z.string() }))
    .query(async ({ ctx, input }) => {
      const committed = await getLastSessionForDirectory(ctx.boxRoot, input.contextDir);
      const sessionId = committed ?? reservedSessionForDirectory(ctx.boxRoot, input.contextDir);
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
        cardPath: boxRelativePathSchema.refine((d) => d.length > 0, "cardPath must not be empty"),
      }),
    )
    .query(async ({ ctx, input }): Promise<{ contextDir: string; sessionId: string | null }> => {
      const contextDir = await nearestLandmarkDir(ctx.boxRoot, { cardPath: input.cardPath });
      // Same reservation fallback as `lastSessionForDirectory`: without it the
      // card page's chat button coins a second empty chat for a landmark whose
      // only chat is reserved-but-unstarted.
      const committed = await getLastSessionForDirectory(ctx.boxRoot, contextDir);
      const sessionId = committed ?? reservedSessionForDirectory(ctx.boxRoot, contextDir);
      return { contextDir, sessionId };
    }),

  /**
   * The `openers:` a directory's briefing currently lists — what an empty
   * chat bound to that directory shows as clickable openers. `contextDir`
   * omitted (or `""`) means the box root; a directory with no briefing of its
   * own inherits the root briefing's openers.
   *
   * Openers are briefing content the box agent maintains, so "no openers" is
   * the normal answer for an established box: a missing briefing, an
   * unparseable one, or one with no `openers:` all return `[]` and the chat
   * falls back to its plain empty-state line.
   */
  openers: publicProcedure
    .input(
      z.object({
        contextDir: boxRelativePathSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<{ openers: string[] }> => {
      const dir = input.contextDir ?? "";
      // A directory with no briefing of its own inherits the root briefing's
      // openers, the same way it inherits the root briefing's context — most
      // landmark directories never grow a briefing. A briefing that EXISTS and
      // lists none is an answer, not a gap: that is how a directory turns its
      // openers off, so it never falls back.
      for (const candidate of dir === "" ? [""] : [dir, ""]) {
        const openers = await readBriefingOpeners(ctx.boxRoot, candidate);
        if (openers !== null) return { openers };
      }
      return { openers: [] };
    }),

  /**
   * Directory a session is associated with, or null if it isn't.
   *
   * A coined chat is bound at reserve time but has no history row until its
   * first turn commits, so history alone answers `null` for it — which left
   * the app bar naming a landmark-bound chat "Chat", with its landmark
   * directory, curated links and Recent files unreachable, until the chat had
   * been used *and* the page reloaded. The reservation carries the binding in
   * that window; history stays authoritative once it has one.
   */
  directoryFor: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const recorded = await getDirectoryForSession(ctx.boxRoot, input.sessionId);
      const reserved = getChatRuntime(ctx.boxRoot)?.registry.getReservation(input.sessionId) ?? null;
      // "" (the box root), never null: a chat with no recorded binding is a
      // ROOT chat — the same missing→"" rule byLandmark applies above. This
      // procedure answered null instead, and the app bar treats null as "no
      // place at all", so root chats had no folder menu — the root landmark's
      // links were unreachable from chat (boxholder, 2026-08-27→30).
      const contextDir = recorded ?? reserved?.contextDir ?? "";
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
    const [{ summaries: landmarks, problems }, { sessions: allSessions, dead }] = await Promise.all([
      loadLandmarkSummaries(ctx.boxRoot),
      loadChatLists(ctx.boxRoot),
    ]);

    // Dead husks bucket by the same binding as live chats, so a landmark's
    // expired conversations sit under that landmark rather than in a pile.
    const deadByDir = new Map<string, DeadPickerSession[]>();
    for (const husk of dead) {
      const bucket = husk.contextDir ?? "";
      const row: DeadPickerSession = {
        sessionId: husk.sessionId,
        label: deadHuskLabel(husk),
        huskPath: husk.huskPath,
        transcript: husk.transcript,
      };
      const list = deadByDir.get(bucket);
      if (list) list.push(row);
      else deadByDir.set(bucket, [row]);
    }

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
        sessions: visibleFresh.map(toPicker),
        olderSessions: [...inlineOlder, ...older].map(toPicker),
        freshCount: fresh.length,
        latestActivity: newest === undefined ? null : newest.mtime.toISOString(),
        dead: deadByDir.get(lm.dir) ?? [],
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
      // Same rule as the live rows: a dead husk bound to a directory with no
      // landmark card would otherwise be listed nowhere at all.
      dead: [...deadByDir.entries()].filter(([dir]) => !landmarked.has(dir)).flatMap(([, rows]) => rows),
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
