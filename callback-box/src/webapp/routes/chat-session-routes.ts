/**
 * Chat session-management routes.
 *
 * GET  /api/chat/history          - Load conversation history (any session)
 * GET  /api/chat/sessions         - List web chat sessions (history + metadata)
 * POST /api/chat/interrupt        - Interrupt an in-flight turn
 * POST /api/chat/restart          - Kill the subprocess (preserves session id)
 * GET  /api/chat/status           - Session status (running/busy/model)
 * GET  /api/chat/default          - Resolve the "most-active" session id
 * POST /api/chat/set-model        - Change a session's active model
 * GET  /api/chat/features         - Read a session's resolved feature map
 * POST /api/chat/set-feature      - Change a single feature flag
 * GET  /api/chat/schedules        - List active schedules
 * POST /api/chat/schedules/cancel - Cancel a schedule by label
 *
 * Split out of `chat.ts`; shares the registry and schedule manager via
 * {@link ChatRoutesContext}.
 */

import * as fs from "node:fs/promises";
import {
  getFeaturesForSession,
  getMostActive,
  loadHistory,
  resolveSessionLogPath,
} from "../../core/chat-session-history.js";
import { resolveFeatures } from "../../core/chat-features.js";
import { loadPersistedChatModel } from "../../core/chat-session-state.js";
import {
  getSessionMetadata,
  parseSessionLog,
  tailForMinUserMessages,
} from "../../cli/lib/session.js";
import type { ChatRoutesContext } from "./chat-context.js";

interface HistoryQuery {
  session?: string;
  tail?: string;
  offset?: string;
  limit?: string;
  minRealUserMessages?: string;
}

/** Load + slice conversation history for GET /api/chat/history. */
async function loadHistorySlice(
  boxRoot: string,
  query: HistoryQuery,
): Promise<{ sessionId: string; entries: unknown[]; total: number }> {
  const sessionId = query.session as string;
  const tail = query.tail ? parseInt(query.tail, 10) : undefined;
  const offset = query.offset ? parseInt(query.offset, 10) : undefined;
  const limit = query.limit ? parseInt(query.limit, 10) : undefined;
  const minRealUserMessages = query.minRealUserMessages
    ? parseInt(query.minRealUserMessages, 10)
    : undefined;
  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  try {
    const result = await parseSessionLog({ logPath, ...(offset != null ? { offset } : {}), ...(limit != null ? { limit } : {}) });
    const { entries, total } = result;
    const userTail = minRealUserMessages && minRealUserMessages > 0
      ? tailForMinUserMessages(entries, minRealUserMessages)
      : 0;
    const effective = tail && tail > 0 ? Math.max(tail, userTail) : (userTail > 0 ? userTail : undefined);
    if (effective !== undefined && effective < entries.length) {
      return { sessionId, entries: entries.slice(entries.length - effective), total };
    }
    return { sessionId, entries, total };
  } catch (_e) {
    return { sessionId, entries: [], total: 0 };
  }
}

/** Build the labeled, sorted web-chat session list for GET /api/chat/sessions. */
async function listWebChatSessions(boxRoot: string): Promise<{ sessions: unknown[] }> {
  const ids = await loadHistory(boxRoot);
  const mostActive = await getMostActive(boxRoot);

  const sessions = await Promise.all(
    ids.map(async (sessionId) => {
      const logPath = await resolveSessionLogPath(boxRoot, sessionId);
      let label = sessionId.slice(0, 8);
      let lastUsedAt = new Date(0).toISOString();
      try {
        const stat = await fs.stat(logPath);
        lastUsedAt = stat.mtime.toISOString();
        const meta = await getSessionMetadata({ sessionId, logPath });
        if (meta.firstUserSnippet) label = meta.firstUserSnippet;
        if (meta.endTime) lastUsedAt = meta.endTime.toISOString();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`[chat] session ${sessionId} log unreadable, keeping id-prefix label:`, e);
        }
        // JSONL missing or unreadable — keep id-prefix label.
      }
      return {
        sessionId,
        source: "chat",
        label,
        lastUsedAt,
        isActive: sessionId === mostActive,
      };
    })
  );

  sessions.sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());
  return { sessions };
}

export function registerChatSessionRoutes(ctx: ChatRoutesContext): void {
  const { server, boxRoot, registry, scheduleManager, wireSession } = ctx;

  // GET /api/chat/history?session=<id> — load conversation history.
  // `session` is required.
  server.get<{ Querystring: HistoryQuery }>("/api/chat/history", async (request, reply) => {
    if (!request.query.session) {
      return reply.status(400).send({ error: "session is required" });
    }
    return loadHistorySlice(boxRoot, request.query);
  });

  // GET /api/chat/sessions — list web chat sessions only, with first-user-snippet labels.
  server.get("/api/chat/sessions", async () => listWebChatSessions(boxRoot));

  // POST /api/chat/interrupt — interrupt the in-flight turn for a session.
  server.post<{ Body: { session?: string } }>("/api/chat/interrupt", async (request, reply) => {
    const sessionId = request.body?.session;
    if (!sessionId) return reply.status(400).send({ error: "session is required" });
    const target = registry.get(sessionId);
    if (!target) return reply.status(404).send({ error: "session not live" });
    target.interrupt();
    return { ok: true };
  });

  // POST /api/chat/restart — kill subprocess, preserving session id and queue.
  server.post<{ Body: { session?: string } }>("/api/chat/restart", async (request, reply) => {
    const sessionId = request.body?.session;
    if (!sessionId) return reply.status(400).send({ error: "session is required" });
    const target = registry.get(sessionId);
    if (!target) return reply.status(404).send({ error: "session not live" });
    target.restart();
    return { ok: true };
  });

  // GET /api/chat/status?session=<id> — session status (running, busy, model).
  // Without `session`, returns empty/default — bare /chat resolves via /default.
  server.get<{ Querystring: { session?: string } }>("/api/chat/status", async (request) => {
    const sessionId = request.query.session;
    // Model is read from the persisted file, not just the live registry
    // entry: a session that isn't currently instantiated (idle-evicted, or
    // not yet sent to) would otherwise report model=null and the picker
    // would show "default" while the next turn loads the pinned model from
    // disk and uses it — the "shows Opus but runs Fable" desync.
    const persistedModel = loadPersistedChatModel(boxRoot);
    if (!sessionId) {
      return { sessionId: null, running: false, busy: false, model: persistedModel };
    }
    const target = registry.get(sessionId);
    if (!target) {
      return { sessionId, running: false, busy: false, model: persistedModel };
    }
    return {
      sessionId: target.getSessionId(),
      running: target.isRunning(),
      busy: target.isBusy(),
      model: target.getCurrentModel(),
    };
  });

  // GET /api/chat/default — return the most-active session id (for bare /chat).
  server.get("/api/chat/default", async () => {
    const sessionId = await getMostActive(boxRoot);
    return { sessionId };
  });

  // POST /api/chat/set-model — change a session's active model.
  // Uses getOrCreate so an evicted session is re-registered rather than 404'd
  // (the model is persisted to chat-model.json regardless). After saving,
  // restart the live subprocess so the next turn actually picks up the new
  // model — the `set_model` control_request to a live subprocess isn't
  // honored by Claude Code, so without a restart the live proc stays pinned
  // to the `--model` it was spawned with.
  server.post<{ Body: { model: string | null; session?: string } }>(
    "/api/chat/set-model",
    async (request, reply) => {
      const { model, session: sessionId } = request.body;
      if (!sessionId) return reply.status(400).send({ error: "session is required" });
      const target = registry.getOrCreate(sessionId);
      wireSession(target);
      target.setModel(model);
      let restarted = false;
      if (target.isRunning()) {
        if (target.isBusy()) {
          // Mid-turn — defer restart until the current turn ends, otherwise
          // the in-progress response is lost. The close handler drains any
          // queued sends into the fresh subprocess.
          target.once("done", () => {
            if (target.isRunning()) target.restart();
          });
        } else {
          target.restart();
          restarted = true;
        }
      }
      return { ok: true, model: target.getCurrentModel(), restarted };
    }
  );

  // GET /api/chat/features?session=<id> — read the feature map for a session.
  // Returns the resolved map (defaults filled in). Reads directly from
  // history so it doesn't churn the session registry just to surface state.
  server.get<{ Querystring: { session?: string } }>(
    "/api/chat/features",
    async (request, reply) => {
      const sessionId = request.query.session;
      if (!sessionId) return reply.status(400).send({ error: "session is required" });
      const stored = await getFeaturesForSession(boxRoot, sessionId).catch(() => null);
      const features = resolveFeatures(stored);
      return { features };
    },
  );

  // POST /api/chat/set-feature — change a single feature flag for a session.
  // Validates against the registry inside ChatSession.setFeature; throws on
  // unknown features or illegal values. Broadcasts a `chat-features-changed`
  // event so other tabs sync.
  server.post<{ Body: { session?: string; feature?: string; value?: string } }>(
    "/api/chat/set-feature",
    async (request, reply) => {
      const { session: sessionId, feature, value } = request.body;
      if (!sessionId) return reply.status(400).send({ error: "session is required" });
      if (!feature) return reply.status(400).send({ error: "feature is required" });
      if (typeof value !== "string") return reply.status(400).send({ error: "value is required" });
      const target = registry.getOrCreate(sessionId);
      wireSession(target);
      try {
        await target.setFeature(feature, value);
      } catch (e) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
      // `wireSession` bridges the session's `features-changed` event onto the
      // bus, so the SSE broadcast already fired. No explicit emit here.
      //
      // No subprocess restart needed: feature state is communicated to the
      // agent via the per-turn <chat-app> snapshot, and the rules for each
      // feature live in always-included prompt overlays gated on what the
      // snapshot reports. The next user message will reflect the change.
      return { ok: true, features: target.getFeatures() };
    },
  );

  // GET /api/chat/schedules — list active schedules (single per-box manager).
  server.get("/api/chat/schedules", async () => {
    return { schedules: scheduleManager.getActive() };
  });

  // POST /api/chat/schedules/cancel — cancel a schedule by label.
  server.post<{ Body: { label: string } }>(
    "/api/chat/schedules/cancel",
    async (request) => {
      const { label } = request.body;
      const cancelled = scheduleManager.cancelByLabel(label);
      return { ok: cancelled };
    }
  );
}
