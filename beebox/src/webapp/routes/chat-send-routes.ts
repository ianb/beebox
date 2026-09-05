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
import type { FastifyReply } from "fastify";
import { errorMessage } from "../../lib/error-guards.js";
import { getMostActive } from "../../core/chat/session/history.js";
import { summarizeWhatsChanged } from "../../core/chat/whats-changed.js";
import type { SessionUser } from "../auth.js";
import { resolveBoxIdentity } from "../box-identity.js";
import type { ChatRoutesContext } from "./chat-context.js";
import { resolveSendTargetForRoute } from "./chat-send-target.js";
import { type TurnCapture, captureTurn, startAckedRun } from "./chat-send-run.js";
import {
  type SendOutcome,
  claimMessageId,
  createInFlightSends,
  recordDurableClaim,
} from "./chat-send-dedup.js";
import {
  type SendBody,
  type SelfNoteBody,
  type WhatsChangedBody,
  sendBodySchema,
  selfNoteBodySchema,
  whatsChangedBodySchema,
  resolveChannel,
  buildSendInput,
  extractCardFields,
  escapeXmlAttr,
  injectUserAttr,
  resolveMobileSender,
  validateImages,
  warnOnUnnormalizedImageOrientation,
} from "./chat-helpers.js";

function validateInboundImages(images: SendBody["images"]): { error: string; status: number } | null {
  if (images === undefined || images.length === 0) return null;
  const invalid = validateImages(images);
  if (invalid !== null) return invalid;
  // Contract check: images should arrive orientation-normalized (see
  // shared/image-orientation.ts). Log, don't reject — there is no server
  // codec to correct it, and rejecting a real photo would be user-hostile.
  warnOnUnnormalizedImageOrientation(images);
  return null;
}

export function registerChatSendRoutes(ctx: ChatRoutesContext): void {
  const { server, boxRoot, eventBus, registry, scheduleManager, processedMessageIds } = ctx;
  // Volatile claims live for one request each, so they belong to this box's
  // route registration — not to the persisted map, which outlives the process.
  const inFlightSends = createInFlightSends();
  // POST /api/chat/send - Send a message and stream the response
  server.post<{ Body: SendBody | undefined }>("/api/chat/send", async (request, reply) => {
    const parsed = sendBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message ?? "invalid request body",
      });
    }
    const { message, messageId, images, session: sessionParam, contextDir, seedFeatures } = parsed.data;
    const body = parsed.data;
    const invalid = validateInboundImages(images);
    if (invalid !== null) return reply.status(invalid.status).send({ error: invalid.error });

    const target = await resolveSendTargetForRoute({
      ctx,
      reply,
      args: {
        sessionParam,
        contextDir,
        requestSeedFeatures: seedFeatures,
        exactSession: parsed.data.exactSession ?? false,
        ...(parsed.data.engine !== undefined ? { engine: parsed.data.engine } : {}),
        ...(parsed.data.model !== undefined ? { model: parsed.data.model } : {}),
      },
    });
    if (target === null) return;
    const { session: chatSession, id: knownId } = target;

    // Identify the sender through the box's one identity resolver — a cookie or
    // hub session is the desktop/web path, and on a box that opted into
    // `agentBrowsing: "owner"` an agent-driven browser is the owner. A paired
    // mobile device authenticates with a bearer token or bbx_mobile cookie and
    // carries neither, so fall back to its `createdBy` identity — without this,
    // every native and mobile-web send is attributed to nobody. May be null when
    // auth is disabled or a device was paired in open mode.
    const identity = await resolveBoxIdentity({ boxRoot, request, openAccess: request.server.openAccess });
    const user: SessionUser | null =
      identity.email !== null
        ? { email: identity.email, name: identity.name ?? identity.email }
        : await resolveMobileSender(boxRoot, request.headers);

    // Slash commands (e.g. /compact) are parsed by the claude CLI when they
    // appear at the very start of the user text — any prefix/suffix would
    // break detection, so skip user-attr and pending-schedules injection.
    const isSlashCommand = message.startsWith("/");
    const attributed = user && !isSlashCommand ? injectUserAttr(message, user) : message;

    // Deduplicate retries: a duplicate either shares the in-flight request's
    // outcome or is answered `deduplicated: true` from the durable claim —
    // never from this process's volatile claim alone (see chat-send-dedup.ts).
    const claim = messageId ? claimMessageId({ messageId, processedMessageIds, inFlightSends }) : null;
    if (claim !== null && claim.kind === "duplicate") {
      const shared = await claim.outcome;
      return reply.status(shared.status).send(shared.body);
    }
    // `respond` gives the volatile claim back with this request's real outcome.
    // EVERY exit below goes through it — a claim left unsettled would park each
    // duplicate POST for this id until its client gave up.
    let settleInFlight = claim === null ? null : claim.settle;
    const respond = (outcome: SendOutcome): FastifyReply => {
      if (settleInFlight !== null) {
        settleInFlight(outcome);
        settleInFlight = null;
      }
      return reply.status(outcome.status).send(outcome.body);
    };

    // Everything from here to the ack runs under the volatile claim, so an
    // unexpected throw (a bus listener, a registry call) must settle it before
    // it escapes — otherwise every duplicate and retry POST for this id parks
    // on a promise nobody resolves, which is worse than the 500 itself. The
    // capture is failed too when one exists: the pin it holds would otherwise
    // keep the session alive with no turn to finish.
    let capture: TurnCapture | null = null;
    try {
      // Broadcast the user message to other clients via the event bus. This is a
      // *persisted* event — the user's turn in the conversation history — and
      // recording it IS acceptance: it happens on both paths immediately before
      // the ack, whether the message was queued or is about to be handed to the
      // engine. A run that then fails to start no longer contradicts it: the
      // failure reaches the client on the turn stream instead of as a 500 that
      // invited a retry which recorded the message a second time
      // (issues/bugs/2026-08-03-intermittent-spawn-ebadf-sdk-chat-run.md).
      // For pending-new sessions, sessionId is still unknown; subscribers will
      // see it once `session-assigned` fires.
      //
      // The durable claim is taken here and nowhere else, so acceptance has ONE
      // durability point: a crash before this loses the claim and the message
      // together (the client's retry runs it once), a crash after loses neither
      // (the retry is answered `deduplicated: true` and history really has it).
      // Message first, claim second — the millisecond between them can only cost
      // a duplicate, never a message the client was told the box had.
      const recordUserMessage = (): void => {
        eventBus.emit("chat-user-message", {
          sessionId: knownId,
          message: attributed,
          user: user ? { email: user.email, name: user.name } : null,
          timestamp: new Date().toISOString(),
        });
        if (messageId) recordDurableClaim(boxRoot, { messageId, processedMessageIds });
      };

      // Where the user is sending from, for the snapshot's `channel` attr: the
      // client's own reading (the only one that can see the native shell), with
      // the User-Agent guess as the fallback for a client that sends nothing.
      const channel = resolveChannel(body.channel, request.headers["user-agent"]);

      // Companion-pane state for the `open-card`/`card-activity`/`card-state`
      // snapshot attrs, normalized + filtered at this parse boundary. Rides
      // enqueue and send like `channel`.
      const cardFields = extractCardFields(body);

      // If busy, record and queue — the queue drains on the next "done", and the
      // completed turn surfaces via the chat-complete event → history refresh.
      // Record first, enqueue second: a throw while recording then leaves nothing
      // queued, so the retry that follows the 500 runs the message once instead
      // of delivering the copy this request already handed to the session.
      if (chatSession.isBusy()) {
        recordUserMessage();
        chatSession.enqueue(buildSendInput({ text: attributed, images, channel, cardFields }));
        return respond({ status: 200, body: { queued: true } });
      }

      // Append active schedule info so the agent knows what's pending.
      // Skip for slash commands so they remain at the start of the text.
      const pendingInfo = isSlashCommand ? "" : scheduleManager.formatPendingForPrompt();
      const fullMessage = pendingInfo ? attributed + "\n<pending-schedules>" + pendingInfo + "</pending-schedules>" : attributed;

      // Touch + enforce the live cap + mark most-active for an already-known
      // session. (A pending "new" session has no id yet for these.)
      if (knownId !== null) {
        registry.touch(knownId, { subprocessUse: true });
        registry.enforceLiveCap(knownId);
        void registry.markMostActive(knownId).catch((e: unknown) => {
          console.error(`[chat] markMostActive(${knownId}) failed:`, e);
        });
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
      capture = captureTurn(chatSession, { turnId, releasePin });

      // Record, ack, THEN start the run — the busy path's shape, extended to the
      // idle one. The response means "the box durably has your message", not "the
      // engine started": a cold spawn takes minutes, and waiting for it left every
      // client (and every retry timer) parked in a pending state for that whole
      // window. The turn buffer is already wired, so no frame the run emits is
      // lost between the ack and the client's subscribe, and a start failure
      // surfaces on that stream instead of as an HTTP status
      // (see startAckedRun; docs/plans/emission-model.md, Track A).
      recordUserMessage();
      startAckedRun(chatSession, {
        input: buildSendInput({ text: fullMessage, images, channel, cardFields }),
        capture,
      });
      return respond({ status: 200, body: { turnId } });
    } catch (e) {
      console.error("[chat] send failed after the message id was claimed:", e);
      capture?.fail(errorMessage(e));
      if (settleInFlight !== null) {
        settleInFlight({ status: 500, body: { error: errorMessage(e) } });
        settleInFlight = null;
      }
      throw e;
    }
  });

  // POST /api/chat/self-note — inject a self-note into a session transcript.
  server.post<{ Body: SelfNoteBody | undefined }>("/api/chat/self-note", async (request, reply) => {
    const parsed = selfNoteBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message ?? "invalid request body",
      });
    }
    const { body, ref, commit, session: requestedSession } = parsed.data;

    // Resolve target session: explicit > most-active.
    const targetId = requestedSession ?? (await getMostActive(boxRoot));
    if (!targetId) {
      return reply.status(404).send({ error: "no live chat session" });
    }
    const target = registry.get(targetId);
    if (!target) {
      return reply.status(404).send({
        error: requestedSession ? `session "${requestedSession}" is not live` : "no live chat session",
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
  server.post<{ Body: WhatsChangedBody | undefined }>("/api/chat/whats-changed", async (request, reply) => {
    const parsed = whatsChangedBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message ?? "invalid request body",
      });
    }
    const { session: requestedSession, card } = parsed.data;
    const sessionId = requestedSession ?? (await getMostActive(boxRoot));
    const report = await summarizeWhatsChanged(boxRoot, {
      sessionId,
      ...(card !== undefined && card !== "" ? { card } : {}),
    });
    return reply.send({ report });
  });
}
