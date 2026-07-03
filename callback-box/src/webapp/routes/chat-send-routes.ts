/**
 * Chat send + self-note routes.
 *
 * POST /api/chat/send      - Send a message; streams the response over the WS event bus
 * POST /api/chat/self-note - Inject a self-note into a session transcript
 *
 * Split out of `chat.ts`; shares the registry, schedule manager, dedup map and
 * wire-session closure via {@link ChatRoutesContext}.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type ChatMessage, type ChatSession } from "../../core/chat-session.js";
import { getMostActive } from "../../core/chat-session-history.js";
import { readLandmarkFeaturesForDir } from "../../core/landmark/features.js";
import { mergeSeedFeatures } from "../../core/chat-features.js";
import { summarizeWhatsChanged } from "../../core/chat-whats-changed.js";
import { createTurnBuffer, removeTurnBuffer, scheduleTurnCleanup } from "../../core/chat-turn-buffer.js";
import { getSessionUser } from "../auth.js";
import type { ChatRoutesContext } from "./chat-context.js";
import {
  type SendBody,
  type SelfNoteBody,
  type WhatsChangedBody,
  classifyChannel,
  extractCardFields,
  escapeXmlAttr,
  injectUserAttr,
  validateImages,
} from "./chat-helpers.js";

const MESSAGE_ID_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Capture an in-flight turn's messages into a resumable buffer keyed by
 * `turnId`, instead of piping them to one client socket. The turn now outlives
 * any single connection: the client subscribes to `chat.turnStream` for the
 * output and can drop/reconnect without losing it. The pin is released and the
 * buffer scheduled for GC once the turn settles (done / error / session close).
 *
 * Wired up *before* the send so no early frame (system/init, an immediate
 * result, a fast subprocess) is dropped between send-resolves and listener-
 * attach. Returns `cancel`, which the caller invokes if the send fails before
 * the turn runs — it detaches the listeners and forgets the buffer so a never-
 * starting turn doesn't leak a buffer or capture the next turn's output.
 */
function captureTurn(
  chatSession: ChatSession,
  { turnId, releasePin }: { turnId: string; releasePin: () => void },
): { cancel: () => void } {
  const buffer = createTurnBuffer(turnId);

  let settled = false;
  const detach = (): void => {
    chatSession.removeListener("message", onMessage);
    chatSession.removeListener("done", onDone);
    chatSession.removeListener("error", onError);
    chatSession.removeListener("close", onClose);
  };
  const settle = (): void => {
    if (settled) return;
    settled = true;
    detach();
    releasePin();
    scheduleTurnCleanup(turnId);
  };

  const onMessage = (msg: ChatMessage): void => buffer.push(msg);
  const onDone = (): void => {
    buffer.finish();
    settle();
  };
  const onError = (err: Error): void => {
    buffer.fail(err.message);
    settle();
  };
  // The subprocess exited without a `done` (crash / intentional stop). Mark the
  // turn complete so a resuming subscriber stops waiting and falls back to
  // history rather than hanging.
  const onClose = (): void => {
    buffer.finish();
    settle();
  };

  chatSession.on("message", onMessage);
  chatSession.on("done", onDone);
  chatSession.on("error", onError);
  chatSession.on("close", onClose);

  // Send failed before the turn ran: detach and forget the buffer. Leaves the
  // pin to the caller (it releases on the failure path). No-op once settled.
  const cancel = (): void => {
    if (settled) return;
    settled = true;
    detach();
    removeTurnBuffer(turnId);
  };

  return { cancel };
}

/**
 * Resolve the request's `session` param to a `ChatSession`. Handles the
 * "new" sentinel by constructing a pending session and arranging for
 * promotion when its real id arrives.
 *
 * Returns the session and its current id (`null` for a still-pending new
 * session).
 */
async function resolveSendTarget(
  ctx: ChatRoutesContext,
  { sessionParam, contextDir, requestSeedFeatures }: {
    sessionParam: string;
    contextDir: string | undefined;
    requestSeedFeatures: Record<string, string> | undefined;
  },
): Promise<{ session: ChatSession; id: string | null }> {
  const { registry, boxRoot, wireSession } = ctx;
  if (sessionParam === "new") {
    // Layer the client's pre-session choices (e.g. narration toggled on
    // before the first message) over any landmark defaults — the explicit
    // choice wins. The merged map seeds createNew so the very first user
    // message's <chat-app> snapshot reflects it.
    const landmark = contextDir !== undefined && contextDir !== ""
      ? await readLandmarkFeaturesForDir(boxRoot, contextDir)
      : null;
    const seedFeatures = mergeSeedFeatures({ landmark, request: requestSeedFeatures });
    const session = registry.createNew({
      ...(contextDir !== undefined ? { contextDir } : {}),
      ...(Object.keys(seedFeatures).length > 0 ? { seedFeatures } : {}),
    });
    wireSession(session);
    return { session, id: null };
  }
  const session = registry.getOrCreate(sessionParam);
  wireSession(session);
  return { session, id: sessionParam };
}

function pruneMessageIds(processedMessageIds: Map<string, number>): void {
  const cutoff = Date.now() - MESSAGE_ID_TTL_MS;
  for (const [id, ts] of processedMessageIds) {
    if (ts < cutoff) processedMessageIds.delete(id);
  }
}

function dedupStatePath(boxRoot: string): string {
  return path.join(boxRoot, ".callback-box", "message-dedup.json");
}

/**
 * Hydrate the message-dedup map from disk so a server restart between a
 * successful send and the client's retry still suppresses the duplicate.
 * Expired entries (older than the TTL) are dropped on load.
 */
export function loadProcessedMessageIds(boxRoot: string): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const obj = JSON.parse(fs.readFileSync(dedupStatePath(boxRoot), "utf-8")) as Record<string, number>;
    const cutoff = Date.now() - MESSAGE_ID_TTL_MS;
    for (const [id, ts] of Object.entries(obj)) {
      if (typeof ts === "number" && ts >= cutoff) map.set(id, ts);
    }
  } catch (_e) {
    // No prior dedup file (fresh box / first run) — start empty.
  }
  return map;
}

function persistProcessedMessageIds(boxRoot: string, processedMessageIds: Map<string, number>): void {
  try {
    const obj: Record<string, number> = {};
    for (const [id, ts] of processedMessageIds) obj[id] = ts;
    const file = dedupStatePath(boxRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj));
  } catch (e) {
    console.error("[chat] failed to persist message-dedup state:", e);
  }
}

export function registerChatSendRoutes(ctx: ChatRoutesContext): void {
  const { server, boxRoot, eventBus, registry, scheduleManager, processedMessageIds } = ctx;

  // POST /api/chat/send - Send a message and stream the response
  server.post<{ Body: SendBody }>("/api/chat/send", async (request, reply) => {
    const body = request.body ?? ({} as Partial<SendBody>);
    const { message, messageId, images, session: sessionParam, contextDir, seedFeatures } = body;

    if (!message) {
      return reply.status(400).send({ error: "message is required" });
    }
    if (!sessionParam) {
      return reply.status(400).send({ error: "session is required (id or 'new')" });
    }

    if (images && images.length > 0) {
      const invalid = validateImages(images);
      if (invalid) return reply.status(invalid.status).send({ error: invalid.error });
    }

    const { session: chatSession, id: knownId } = await resolveSendTarget(ctx, { sessionParam, contextDir, requestSeedFeatures: seedFeatures });

    // Identify the sender from the session (may be null if auth is disabled)
    const user = getSessionUser(request);

    // Slash commands (e.g. /compact) are parsed by the claude CLI when they
    // appear at the very start of the user text — any prefix/suffix would
    // break detection, so skip user-attr and pending-schedules injection.
    const isSlashCommand = message.startsWith("/");
    const attributed = user && !isSlashCommand ? injectUserAttr(message, user) : message;

    // Deduplicate retries: if we've already processed this messageId, report it
    // as already-done so the client finishes the turn (it will refresh history).
    if (messageId) {
      pruneMessageIds(processedMessageIds);
      if (processedMessageIds.has(messageId)) {
        console.log(`[chat] Duplicate message ${messageId}, skipping`);
        return reply.send({ deduplicated: true });
      }
      processedMessageIds.set(messageId, Date.now());
      persistProcessedMessageIds(boxRoot, processedMessageIds);
    }

    // Broadcast the user message to other clients via the event bus.
    // For pending-new sessions, sessionId is still unknown; subscribers will
    // see it once `session-assigned` fires.
    eventBus.emit("chat-user-message", {
      sessionId: knownId,
      message: attributed,
      user: user ? { email: user.email, name: user.name } : null,
      timestamp: new Date().toISOString(),
    });

    // Where the user is sending from, for the snapshot's `channel` attr.
    const channel = classifyChannel(request.headers["user-agent"]);

    // Companion-pane state for the `open-card`/`card-activity`/`card-state`
    // snapshot attrs, normalized + filtered at this parse boundary. Rides
    // enqueue and send like `channel`.
    const cardFields = extractCardFields(body);

    // If busy, queue and return — the queue drains on the next "done", and the
    // completed turn surfaces via the chat-complete event → history refresh.
    if (chatSession.isBusy()) {
      chatSession.enqueue({
        text: attributed,
        ...(images ? { images } : {}),
        ...(channel !== undefined ? { channel } : {}),
        ...cardFields,
      });
      return reply.send({ queued: true });
    }

    // Append active schedule info so the agent knows what's pending.
    // Skip for slash commands so they remain at the start of the text.
    const pendingInfo = isSlashCommand ? "" : scheduleManager.formatPendingForPrompt();
    const fullMessage = pendingInfo
      ? attributed + "\n<pending-schedules>" + pendingInfo + "</pending-schedules>"
      : attributed;

    // Touch + enforce the live cap + mark most-active for an already-known
    // session. (A pending "new" session has no id yet for these.)
    if (knownId !== null) {
      registry.touch(knownId, { subprocessUse: true });
      registry.enforceLiveCap(knownId);
      void registry.markMostActive(knownId).catch((_e) => {});
    }
    // Pin the session for the turn's lifetime so it survives the idle sweep and
    // a concurrent send's LRU eviction. pinSession works for a pending "new"
    // session too (it carries into the entry's refCount on id promotion), which
    // a by-id pin couldn't. Released when the turn settles (see captureTurn).
    const releasePin = registry.pinSession(chatSession);

    // Wire the session's output into a resumable buffer *before* sending, so a
    // frame emitted before send() resolves (e.g. a prewarmed subprocess) isn't
    // dropped. The output flows over chat.turnStream, resumable by this turnId.
    const turnId = randomUUID();
    const capture = captureTurn(chatSession, { turnId, releasePin });

    const sent = await chatSession.send({
      text: fullMessage,
      ...(images ? { images } : {}),
      ...(channel !== undefined ? { channel } : {}),
      ...cardFields,
    });
    if (!sent) {
      capture.cancel();
      releasePin();
      return reply.status(500).send({ error: "Failed to send message" });
    }

    return reply.send({ turnId });
  });

  // POST /api/chat/self-note — inject a self-note into a session transcript.
  server.post<{ Body: SelfNoteBody }>("/api/chat/self-note", async (request, reply) => {
    const { body, ref, commit, session: requestedSession } = request.body ?? ({} as Partial<SelfNoteBody>);

    if (!body || !body.trim()) {
      return reply.status(400).send({ error: "body is required" });
    }

    // Resolve target session: explicit > most-active.
    const targetId = requestedSession ?? (await getMostActive(boxRoot));
    if (!targetId) {
      return reply.status(404).send({ error: "no live chat session" });
    }
    const target = registry.get(targetId);
    if (!target) {
      return reply.status(404).send({
        error: requestedSession
          ? `session "${requestedSession}" is not live`
          : "no live chat session",
      });
    }

    const attrs: string[] = [];
    if (ref) attrs.push(`ref="${escapeXmlAttr(ref)}"`);
    if (commit) attrs.push(`commit="${escapeXmlAttr(commit)}"`);
    const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
    const wrapped = `<self-note${attrStr}>\n${body.trim()}\n</self-note>`;

    if (target.isBusy()) {
      target.enqueue({ text: wrapped });
    } else {
      registry.enforceLiveCap(targetId);
      registry.touch(targetId, { subprocessUse: true });
      target.send({ text: wrapped }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[self-note] send failed:", msg);
      });
    }

    return reply.send({ ok: true, sessionId: target.getSessionId() });
  });

  // POST /api/chat/whats-changed — git-grounded "what changed since my last
  // reply" for the agent. Resolves the marker against the live/most-active
  // session; the report is committed (marker.head..HEAD) plus the uncommitted
  // working tree, optionally scoped to a card path. No registry liveness needed
  // — the marker is on disk, and a missing one yields the labeled fallback.
  server.post<{ Body: WhatsChangedBody }>("/api/chat/whats-changed", async (request, reply) => {
    const { session: requestedSession, card } = request.body ?? ({} as Partial<WhatsChangedBody>);
    const sessionId = requestedSession ?? (await getMostActive(boxRoot));
    const report = await summarizeWhatsChanged(boxRoot, {
      sessionId,
      ...(card !== undefined && card !== "" ? { card } : {}),
    });
    return reply.send({ report });
  });
}
