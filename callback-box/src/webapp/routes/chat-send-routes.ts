/**
 * Chat send + self-note routes.
 *
 * POST /api/chat/send      - Send a message; streams the response via SSE
 * POST /api/chat/self-note - Inject a self-note into a session transcript
 *
 * Split out of `chat.ts`; shares the registry, schedule manager, dedup map and
 * wire-session closure via {@link ChatRoutesContext}.
 */

import type { FastifyReply } from "fastify";
import { type ChatMessage, type ChatSession } from "../../core/chat-session.js";
import { getMostActive } from "../../core/chat-session-history.js";
import { readLandmarkFeaturesForDir } from "../../core/landmark/features.js";
import { mergeSeedFeatures } from "../../core/chat-features.js";
import { getSessionUser } from "../auth.js";
import type { ChatRoutesContext } from "./chat-context.js";
import {
  type SendBody,
  type SelfNoteBody,
  escapeXmlAttr,
  injectUserAttr,
  validateImages,
} from "./chat-helpers.js";

const MESSAGE_ID_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Stream subprocess messages for an in-flight turn to the hijacked SSE socket
 * until the turn completes (done / error / close / client disconnect). Resolves
 * once the socket is torn down and the pin released.
 */
function streamTurn(
  chatSession: ChatSession,
  { reply, releasePin }: { reply: FastifyReply; releasePin: () => void },
): Promise<void> {
  return new Promise<void>((resolve) => {
    const onMessage = (msg: ChatMessage) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);
      } catch (_e) {
        // Client disconnected — the write target is gone; nothing
        // actionable in the error and the stream is torn down below.
      }
    };

    const finish = () => {
      cleanup();
      reply.raw.end();
      releasePin();
      resolve();
    };

    const onDone = () => finish();

    const onError = (err: Error) => {
      try {
        reply.raw.write(
          `data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`
        );
      } catch (_e) {
        // Client disconnected — the write target is gone; nothing
        // actionable in the error and the stream is torn down below.
      }
      finish();
    };

    const onClose = () => finish();

    const cleanup = () => {
      chatSession.removeListener("message", onMessage);
      chatSession.removeListener("done", onDone);
      chatSession.removeListener("error", onError);
      chatSession.removeListener("close", onClose);
    };

    chatSession.on("message", onMessage);
    chatSession.on("done", onDone);
    chatSession.on("error", onError);
    chatSession.on("close", onClose);

    // Handle client disconnect
    reply.raw.on("close", () => {
      cleanup();
      releasePin();
      resolve();
    });
  });
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

function writeSseHead(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
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

    // Deduplicate retries: if we've already processed this messageId,
    // return success without re-sending to the agent
    if (messageId) {
      pruneMessageIds(processedMessageIds);
      if (processedMessageIds.has(messageId)) {
        console.log(`[chat] Duplicate message ${messageId}, skipping`);
        reply.hijack();
        writeSseHead(reply);
        reply.raw.write(`data: ${JSON.stringify({ type: "result", deduplicated: true })}\n\n`);
        reply.raw.end();
        return;
      }
      processedMessageIds.set(messageId, Date.now());
    }

    // Broadcast the user message to other clients via SSE.
    // For pending-new sessions, sessionId is still unknown; subscribers will
    // see it once `session-assigned` fires.
    eventBus.emit("chat-user-message", {
      sessionId: knownId,
      message: attributed,
      user: user ? { email: user.email, name: user.name } : null,
      timestamp: new Date().toISOString(),
    });

    // Hijack the response so we control the socket directly and can hold
    // it open across the SSE stream lifetime.
    reply.hijack();
    writeSseHead(reply);

    // If busy, queue and return — the queue drains on the next "done".
    if (chatSession.isBusy()) {
      chatSession.enqueue({ text: attributed, ...(images ? { images } : {}) });
      reply.raw.write(`data: ${JSON.stringify({ type: "queued" })}\n\n`);
      reply.raw.end();
      return;
    }

    // Append active schedule info so the agent knows what's pending.
    // Skip for slash commands so they remain at the start of the text.
    const pendingInfo = isSlashCommand ? "" : scheduleManager.formatPendingForPrompt();
    const fullMessage = pendingInfo
      ? attributed + "\n<pending-schedules>" + pendingInfo + "</pending-schedules>"
      : attributed;

    // Touch and pin the entry while the SSE stream is open so it survives
    // the idle sweep. (Pending-new sessions aren't yet in `entries`; they
    // pin on promotion via session-assigned.) Also mark this session as
    // the most-active so bare /chat resolves here next time.
    let releasePin: () => void = () => {};
    if (knownId !== null) {
      registry.touch(knownId, { subprocessUse: true });
      registry.enforceLiveCap(knownId);
      releasePin = registry.pin(knownId);
      void registry.markMostActive(knownId).catch((_e) => {});
    }

    const sent = await chatSession.send({
      text: fullMessage,
      ...(images ? { images } : {}),
    });
    if (!sent) {
      reply.raw.write(
        `data: ${JSON.stringify({ type: "error", error: "Failed to send message" })}\n\n`
      );
      reply.raw.end();
      releasePin();
      return;
    }

    await streamTurn(chatSession, { reply, releasePin });
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
}
