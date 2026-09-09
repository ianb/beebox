import type { FastifyReply } from "fastify";
import type { ChatSession } from "../../core/chat/session/index.js";
import { seedFeaturesForNewChat } from "../../core/landmark/features.js";
import { resolveSessionAvailability } from "../../core/chat/session/availability.js";
import { isResumableSession } from "../../core/chat/session/recent-landmark.js";
import { resolveChatTarget, type ChatTargetSpec } from "../../core/chat/session/target.js";
import type { ChatRoutesContext } from "./chat-context.js";
import { loadEnabledEngines, type AgentEngine } from "../../core/box/config.js";
import { isChatModelAllowed } from "../../shared/chat-models.js";

interface ResolveSendArgs {
  sessionParam: string;
  contextDir: string | undefined;
  requestSeedFeatures: Record<string, string> | undefined;
  exactSession: boolean;
  /** Engine and model chosen before the chat existed; `"new"` sends only. */
  engine?: AgentEngine | undefined;
  model?: string | undefined;
}

/** A `"new"` send naming an engine the box does not offer, or a model that engine cannot run. */
class UnavailableChatChoiceError extends Error {
  constructor(readonly engine: AgentEngine, readonly model: string | null) {
    super("The engine or model chosen for this chat is unavailable");
    this.name = "UnavailableChatChoiceError";
  }

  /** The sentence the client shows — which half was wrong, and for which engine. */
  get detail(): string {
    return this.model === null
      ? `${this.engine} is not enabled for this box`
      : `Model ${this.model} is unavailable for ${this.engine} chats`;
  }
}

/**
 * Validate a pre-first-message engine/model choice against the box.
 *
 * Rejecting is the point: a chat started on an engine the box does not offer,
 * or a model that engine cannot run, would fail at its first turn or silently
 * run something else. Better to refuse the send and say which.
 */
async function validatedChoice(
  boxRoot: string,
  args: ResolveSendArgs,
): Promise<{ engine?: AgentEngine; model?: string }> {
  if (args.engine === undefined && args.model === undefined) return {};
  const enabled = await loadEnabledEngines(boxRoot);
  const engine = args.engine ?? enabled[0] ?? "claude";
  if (!enabled.includes(engine)) {
    throw new UnavailableChatChoiceError(engine, null);
  }
  if (args.model !== undefined && !isChatModelAllowed(engine, args.model)) {
    throw new UnavailableChatChoiceError(engine, args.model);
  }
  return {
    ...(args.engine !== undefined ? { engine } : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
  };
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
        ...(await validatedChoice(boxRoot, args)),
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
  const seedFeatures = await seedFeaturesForNewChat({ boxRoot, contextDir: args.contextDir, request: args.requestSeedFeatures });
  return Object.keys(seedFeatures).length > 0 ? { seedFeatures } : {};
}

/** Exact sends admit committed live sessions before engine history catches up. */
export async function assertExactSessionTarget(ctx: Pick<ChatRoutesContext, "registry" | "boxRoot">, sessionId: string): Promise<void> {
  if (sessionId === "new") {
    throw new ExactSessionTargetError(400, "exactSession requires an existing session id");
  }
  // Deletion always wins, even while the assigned entry is still live.
  if (ctx.registry.deletion.isBlocked(sessionId)) throw new UnavailableChatSessionError();
  // An engine can assign an id before its transcript becomes enumerable.
  // Only the committed registry entry (or an existing reservation) admits
  // that window; a pending session's early init frame is not commitment.
  if (ctx.registry.isKnownSession(sessionId)) return;
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
    if (error instanceof UnavailableChatChoiceError) {
      await options.reply.status(400).send({ error: error.detail });
      return null;
    }
    if (!(error instanceof UnavailableChatSessionError)) throw error;
    await options.reply.status(410).send({ error: error.message, code: "CHAT_SESSION_UNAVAILABLE" });
    return null;
  }
}
