import type { FastifyReply } from "fastify";
import type { ChatSession } from "../../core/chat/session/index.js";
import { readLandmarkFeaturesForDir } from "../../core/landmark/features.js";
import { mergeSeedFeatures } from "../../core/chat/features.js";
import { resolveSessionAvailability } from "../../core/chat/session/availability.js";
import { isResumableSession } from "../../core/chat/session/recent-landmark.js";
import type { ChatRoutesContext } from "./chat-context.js";

interface ResolveSendArgs {
  sessionParam: string;
  contextDir: string | undefined;
  requestSeedFeatures: Record<string, string> | undefined;
  exactSession: boolean;
}

async function resolveSendTarget(ctx: ChatRoutesContext, args: ResolveSendArgs): Promise<{ session: ChatSession; id: string | null }> {
  const { registry, boxRoot, wireSession } = ctx;
  if (args.exactSession) await assertExactSessionTarget(boxRoot, args.sessionParam);
  if (args.sessionParam === "new") {
    const landmark = args.contextDir !== undefined && args.contextDir !== "" ? await readLandmarkFeaturesForDir(boxRoot, args.contextDir) : null;
    const seedFeatures = mergeSeedFeatures({ landmark, request: args.requestSeedFeatures });
    const session = registry.createNew({
      ...(args.contextDir !== undefined ? { contextDir: args.contextDir } : {}),
      ...(Object.keys(seedFeatures).length > 0 ? { seedFeatures } : {}),
    });
    wireSession(session);
    return { session, id: null };
  }
  const availability = await resolveSessionAvailability({ boxRoot, sessionId: args.sessionParam, registry });
  if (availability.kind === "unavailable") return Promise.reject(new UnavailableChatSessionError());
  const session = registry.getOrCreate(args.sessionParam);
  wireSession(session);
  return { session, id: args.sessionParam };
}

async function assertExactSessionTarget(boxRoot: string, sessionId: string): Promise<void> {
  if (sessionId === "new") {
    throw new ExactSessionTargetError(400, "exactSession requires an existing session id");
  }
  if (!(await isResumableSession(boxRoot, sessionId))) {
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
