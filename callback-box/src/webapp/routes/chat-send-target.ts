import type { FastifyReply } from "fastify";
import type { ChatSession } from "../../core/chat/session/index.js";
import { readLandmarkFeaturesForDir } from "../../core/landmark/features.js";
import { mergeSeedFeatures } from "../../core/chat/features.js";
import { resolveSessionAvailability } from "../../core/chat/session/availability.js";
import { isResumableSession } from "../../core/chat/session/recent-landmark.js";
import { resolveChatTarget, type ChatTargetSpec } from "../../core/chat/session/target.js";
import type { ChatRoutesContext } from "./chat-context.js";

interface ResolveSendArgs {
  sessionParam: string;
  contextDir: string | undefined;
  requestSeedFeatures: Record<string, string> | undefined;
  exactSession: boolean;
}

async function resolveSendTarget(ctx: ChatRoutesContext, args: ResolveSendArgs): Promise<{ session: ChatSession; id: string | null }> {
  const { registry, boxRoot, wireSession } = ctx;
  if (args.exactSession) await assertExactSessionTarget(ctx, args.sessionParam);
  // `"new"` is the legacy shape: a client that did not coin an id (an older
  // build, the iOS app, a Codex box) asks the harness to name the chat. A
  // client that coined one sends the id itself and takes the `existing` path
  // below, because its reservation is what makes the chat exist.
  const spec: ChatTargetSpec = args.sessionParam === "new"
    ? {
        kind: "fresh",
        ...(args.contextDir !== undefined ? { contextDir: args.contextDir } : {}),
        ...(await freshSeedFeatures(boxRoot, args)),
      }
    : { kind: "existing", sessionId: args.sessionParam };
  if (spec.kind === "existing") {
    const availability = await resolveSessionAvailability({ boxRoot, sessionId: spec.sessionId, registry });
    if (availability.kind === "unavailable") return Promise.reject(new UnavailableChatSessionError());
  }
  const { session, sessionId } = await resolveChatTarget({ boxRoot, registry }, spec);
  wireSession(session);
  return { session, id: sessionId };
}

/** Landmark feature defaults merged with the request's, for a fresh chat. */
async function freshSeedFeatures(
  boxRoot: string,
  args: ResolveSendArgs,
): Promise<{ seedFeatures?: Record<string, string> }> {
  const landmark = args.contextDir !== undefined && args.contextDir !== ""
    ? await readLandmarkFeaturesForDir(boxRoot, args.contextDir)
    : null;
  const seedFeatures = mergeSeedFeatures({ landmark, request: args.requestSeedFeatures });
  return Object.keys(seedFeatures).length > 0 ? { seedFeatures } : {};
}

async function assertExactSessionTarget(ctx: ChatRoutesContext, sessionId: string): Promise<void> {
  if (sessionId === "new") {
    throw new ExactSessionTargetError(400, "exactSession requires an existing session id");
  }
  // `isResumableSession` answers from the session list, which requires a husk
  // AND a transcript — neither of which a reserved chat has until its first
  // turn. The exact-session path bypasses `resolveSessionAvailability`, so the
  // reservation has to be admitted here too.
  if (ctx.registry.getReservation(sessionId) !== null) return;
  if (!(await isResumableSession(ctx.boxRoot, sessionId))) {
    throw new ExactSessionTargetError(404, `Chat session is no longer available: ${sessionId}`);
  }
}

class UnavailableChatSessionError extends Error {
  constructor() {
    super("Conversation is not available on this machine");
    this.name = "UnavailableChatSessionError";
  }
}

class ExactSessionTargetError extends Error {
  constructor(readonly status: 400 | 404, message: string) {
    super(message);
    this.name = "ExactSessionTargetError";
  }
}

/** Resolve a send target while mapping stale/deleting sessions to a named 410. */
export async function resolveSendTargetForRoute(options: {
  ctx: ChatRoutesContext;
  args: ResolveSendArgs;
  reply: FastifyReply;
}): Promise<Awaited<ReturnType<typeof resolveSendTarget>> | null> {
  try {
    return await resolveSendTarget(options.ctx, options.args);
  } catch (error) {
    if (error instanceof ExactSessionTargetError) {
      await options.reply.status(error.status).send({ error: error.message });
      return null;
    }
    if (!(error instanceof UnavailableChatSessionError)) throw error;
    await options.reply.status(410).send({ error: error.message, code: "CHAT_SESSION_UNAVAILABLE" });
    return null;
  }
}
