/**
 * Chat send + self-note routes.
 *
 * POST /api/chat/send      - Send a message; streams the response over the WS event bus
 * POST /api/chat/self-note - Inject a self-note into a session transcript
 *
 * Split out of `chat.ts`; shares the registry, schedule manager, dedup map and
 * wire-session closure via {@link ChatRoutesContext}.
 */

import { acquireBoxWork } from "../../../lib/box-maintenance.js";
import { getMostActive } from "../../../core/chat/session/history.js";
import { summarizeWhatsChanged } from "../../../core/chat/whats-changed.js";
import type { SessionUser } from "../../auth.js";
import { resolveBoxIdentity } from "../../box-identity.js";
import type { ChatRoutesContext } from "./context.js";
import { resolveSendTargetForRoute } from "./send-target.js";
import type { UserMessageSender } from "../../chat-runtime.js";
import {
  type SendBody,
  type SelfNoteBody,
  type WhatsChangedBody,
  sendBodySchema,
  selfNoteBodySchema,
  whatsChangedBodySchema,
  resolveChannel,
  extractCardFields,
  escapeXmlAttr,
  resolveMobileSender,
  validateImages,
  warnOnUnnormalizedImageOrientation,
} from "./helpers.js";

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

export function registerChatSendRoutes(
  ctx: ChatRoutesContext,
  { sendUserMessage }: { sendUserMessage: UserMessageSender },
): void {
  const { server, boxRoot, registry } = ctx;
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

    // Where the user is sending from, for the snapshot's `channel` attr: the
    // client's own reading (the only one that can see the native shell), with
    // the User-Agent guess as the fallback for a client that sends nothing.
    const channel = resolveChannel(body.channel, request.headers["user-agent"]);

    // Companion-pane state for the `open-card`/`card-activity`/`card-state`
    // snapshot attrs, normalized + filtered at this parse boundary. Rides
    // enqueue and send like `channel`.
    const cardFields = extractCardFields(body);

    const outcome = await sendUserMessage({ target, message, messageId, user, channel, images, cardFields });
    return reply.status(outcome.status).send(outcome.body);
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
      target.enqueue({ text: wrapped, clientComposed: true });
    } else {
      registry.enforceLiveCap(targetId);
      registry.touch(targetId, { subprocessUse: true });
      const work = await acquireBoxWork(boxRoot, { reason: "self-note" });
      work.run(() => target.send({ text: wrapped, clientComposed: true })).finally(work.release).catch((e: unknown) => {
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
