/**
 * tRPC router for chat session metadata — directory associations,
 * lookup helpers, and the landmark-grouped picker. Streaming send +
 * history live as raw Fastify routes (see src/webapp/routes/chat.ts)
 * since they don't fit tRPC's shape.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseXml, type ElementNode } from "cardworks";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import {
  getDirectoryForSession,
  getLastSessionForDirectory,
  loadHistoryEntries,
  resolveSessionLogPath,
} from "../../../core/chat-session-history.js";
import { getSessionMetadata } from "../../../cli/lib/session.js";

const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface PickerSession {
  sessionId: string;
  label: string;
  lastActivity: string;
}

export interface PickerLandmark {
  /** Box-relative directory; empty string for the root tile. */
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
  sessions: PickerSession[];
}

function readChildText(element: ElementNode, tagName: string): string {
  for (const child of element.children) {
    if (child.tagName === tagName && typeof child.text === "string") {
      return child.text.trim();
    }
  }
  return "";
}

function readSymbol(
  element: ElementNode,
  { landmarkDir, boxRoot }: { landmarkDir: string; boxRoot: string },
): { text: string; src: string | null } {
  for (const child of element.children) {
    if (child.tagName !== "symbol") continue;
    const rawSrc = child.attrs["src"];
    let src: string | null = null;
    if (typeof rawSrc === "string" && rawSrc !== "") {
      const absolute = path.resolve(landmarkDir, rawSrc);
      src = path.relative(boxRoot, absolute);
    }
    const text = typeof child.text === "string" ? child.text.trim() : "";
    return { text, src };
  }
  return { text: "", src: null };
}

interface LandmarkSummary {
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
}

/**
 * Like `landmarks.list` but without resolving links/expand — just the
 * tile-level metadata the picker needs.
 */
async function loadLandmarkSummaries(boxRoot: string): Promise<LandmarkSummary[]> {
  const matches = await glob("**/*.landmark.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
  });

  const out: LandmarkSummary[] = [];
  for (const relPath of matches) {
    const absPath = path.join(boxRoot, relPath);
    let element: ElementNode;
    try {
      const content = await fs.readFile(absPath, "utf-8");
      element = await parseXml(content, absPath);
    } catch {
      continue;
    }
    if (element.tagName !== "landmark") continue;

    const dir = path.dirname(relPath);
    const symbol = readSymbol(element, { landmarkDir: path.dirname(absPath), boxRoot });
    out.push({
      dir: dir === "." ? "" : dir,
      label: readChildText(element, "label") || path.basename(relPath, ".landmark.card"),
      symbol: symbol.text,
      symbolSrc: symbol.src,
    });
  }
  out.sort((a, b) => {
    // Root first, then alphabetical.
    if (a.dir === "") return -1;
    if (b.dir === "") return 1;
    return a.dir.localeCompare(b.dir);
  });
  return out;
}

interface SessionRow {
  sessionId: string;
  /** "" for root-bound, undefined for legacy unbound (treated as root). */
  contextDir: string | undefined;
  mtime: Date;
  label: string;
}

async function loadFreshSessions(
  boxRoot: string,
  cutoff: number,
): Promise<SessionRow[]> {
  const entries = await loadHistoryEntries(boxRoot);
  const rows: SessionRow[] = [];
  for (const entry of entries) {
    let logPath: string;
    try {
      logPath = await resolveSessionLogPath(boxRoot, entry.id);
    } catch {
      continue;
    }
    let mtime: Date;
    try {
      const stat = await fs.stat(logPath);
      mtime = stat.mtime;
    } catch {
      continue; // log missing — session was cleaned up
    }
    if (mtime.getTime() < cutoff) continue;

    let label = entry.id.slice(0, 8);
    try {
      const meta = await getSessionMetadata({ sessionId: entry.id, logPath });
      if (meta.firstUserSnippet) label = meta.firstUserSnippet;
    } catch {
      // keep the id-prefix fallback
    }

    rows.push({
      sessionId: entry.id,
      contextDir: entry.contextDir,
      mtime,
      label,
    });
  }
  rows.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return rows;
}

export const chatRouter = router({
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
    const [landmarks, freshSessions] = await Promise.all([
      loadLandmarkSummaries(ctx.boxRoot),
      loadFreshSessions(ctx.boxRoot, cutoff),
    ]);

    // Group fresh sessions by binding. `contextDir === undefined`
    // (legacy unbound) and `contextDir === ""` (explicit root) both
    // belong to the root bucket.
    const byDir = new Map<string, SessionRow[]>();
    for (const session of freshSessions) {
      const bucket = session.contextDir ?? "";
      const list = byDir.get(bucket);
      if (list) list.push(session);
      else byDir.set(bucket, [session]);
    }

    const picker: PickerLandmark[] = landmarks.map((lm) => {
      const sessions = byDir.get(lm.dir) ?? [];
      const visible = lm.dir === "" ? sessions : sessions.slice(0, 1);
      return {
        dir: lm.dir,
        label: lm.label,
        symbol: lm.symbol,
        symbolSrc: lm.symbolSrc,
        sessions: visible.map((s) => ({
          sessionId: s.sessionId,
          label: s.label,
          lastActivity: s.mtime.toISOString(),
        })),
      };
    });

    const freshCount = picker.reduce((n, l) => n + l.sessions.length, 0);
    return { landmarks: picker, freshCount };
  }),
});
