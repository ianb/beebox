import type { FastifyReply } from "fastify";
import type { ChatSession } from "../../core/chat/session/index.js";
import { readLandmarkFeaturesForDir } from "../../core/landmark/features.js";
import { mergeSeedFeatures } from "../../core/chat/features.js";
import { resolveSessionAvailability } from "../../core/chat/session/availability.js";
import type { ChatRoutesContext } from "./chat-context.js";

interface ResolveSendArgs {
  sessionParam: string;
  contextDir: string | undefined;
  requestSeedFeatures: Record<string, string> | undefined;
}

async function resolveSendTarget(ctx: ChatRoutesContext, args: ResolveSendArgs): Promise<{ session: ChatSession; id: string | null }> {
  const { registry, boxRoot, wireSession } = ctx;
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

class UnavailableChatSessionError extends Error {
  constructor() {
    super("Conversation is not available on this machine");
    this.name = "UnavailableChatSessionError";
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
    if (!(error instanceof UnavailableChatSessionError)) throw error;
    await options.reply.status(410).send({ error: error.message, code: "CHAT_SESSION_UNAVAILABLE" });
    return null;
  }
}
