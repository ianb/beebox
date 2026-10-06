import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../procedures.js";
import type { TrpcContext } from "../context.js";
import { quickChatView, quickChatViewSchema, type QuickChatRecord, type QuickChatView } from "../../../core/chat/routing/quick-chat-record.js";
import {
  chooseQuickChat, discardQuickChat, submitQuickChat,
  QuickChatDestinationFixedError, QuickChatInvalidChoiceError, QuickChatNotFoundError, QuickChatTextConflictError,
  type QuickChatChat, type QuickChatContext, type QuickChatDeliveryOutcome,
} from "../../../core/chat/routing/quick-chat-submit/submit.js";
import { quickChatHome } from "../../../core/chat/routing/quick-chat-home.js";
import { CHAT_CHANNELS, type ChatChannel } from "../../../shared/chat-channel.js";
import type { SendOutcome } from "../../chat-runtime.js";
import { getBoxTime } from "../../../lib/time.js";
import { toError } from "../../../shared/error-guards.js";
import { getChatRuntime } from "../../chat-runtime.js";

const idSchema = z.string().uuid();
const channelSchema = z.enum(CHAT_CHANNELS).optional();
export const quickChatSubmitInput = z.object({ id: idSchema, message: z.string().trim().min(1).max(12000), channel: channelSchema });
export const quickChatChooseInput = z.object({ id: idSchema, candidateId: z.string().min(1), channel: channelSchema });
export const quickChatDiscardInput = z.object({ id: idSchema });
const recentChatSchema = z.object({ sessionId: z.string(), label: z.string(), lastActivity: z.string(),
  landmark: z.object({ dir: z.string(), label: z.string(), symbol: z.string().nullable() }).nullable() });
export const quickChatHomeSchema = z.object({
  open: z.array(quickChatViewSchema), recentlySent: z.array(quickChatViewSchema),
  recentChats: z.array(recentChatSchema), shortcuts: z.array(z.object({ label: z.string(), to: z.string() })),
});

function deliveryOutcome(outcome: SendOutcome): QuickChatDeliveryOutcome {
  const { body } = outcome;
  if ("deduplicated" in body) return { kind: "duplicate" };
  if ("queued" in body) return { kind: "accepted", queued: true };
  if ("turnId" in body) return { kind: "accepted", queued: false };
  return { kind: "failed", error: body.error };
}

/** The box's chat runtime as quick chat delivers through it: the send route's own target resolution and sender. */
function quickChatChat(ctx: TrpcContext, channel: ChatChannel | undefined): QuickChatChat | undefined {
  const runtime = getChatRuntime(ctx.boxRoot);
  if (runtime === undefined) return undefined;
  return {
    reserve: (opts) => runtime.registry.reserve(opts),
    async deliver({ delivery, messageId, message }) {
      const fresh = delivery.session === "new";
      const resolved = await runtime.resolveSendTarget({ sessionParam: delivery.session, exactSession: delivery.exactSession,
        contextDir: fresh ? delivery.contextDir : undefined, requestSeedFeatures: undefined, ...(fresh ? { engine: delivery.engine } : {}) });
      // 410 is a deleted or deleting chat; 404 an exact session that no longer resumes. Both are gone.
      if (!resolved.ok) return resolved.code === "CHAT_SESSION_UNAVAILABLE" || resolved.status === 404 ? { kind: "gone" } : { kind: "failed", error: resolved.error };
      // A typed thought, framed as the composer frames one, so the sender is attributed.
      return deliveryOutcome(await runtime.sendUserMessage({ target: resolved.target, message: `<typed>${message}</typed>`, messageId, user: ctx.user, channel }));
    },
  };
}

function context(ctx: TrpcContext, channel: ChatChannel | undefined): QuickChatContext {
  return { boxRoot: ctx.boxRoot, jev: ctx.services.jev, chat: quickChatChat(ctx, channel) };
}

function view(record: QuickChatRecord, ctx: TrpcContext): QuickChatView {
  return quickChatView(record, getBoxTime(ctx.boxRoot).getTime());
}

function requestFailure(error: unknown): never {
  if (error instanceof QuickChatTextConflictError || error instanceof QuickChatDestinationFixedError) throw new TRPCError({ code: "CONFLICT", message: error.message });
  if (error instanceof QuickChatNotFoundError) throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  if (error instanceof QuickChatInvalidChoiceError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw toError(error);
}

export const quickChatRouter = router({
  /** Store, route, and deliver one thought. A repeat with the same id returns the stored record, retrying a pending delivery. */
  submit: authedProcedure.input(quickChatSubmitInput)
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => view(await submitQuickChat(context(ctx, input.channel), input).catch(requestFailure), ctx)),
  /** Fix the person's chosen destination for a stored thought, and deliver it. */
  choose: authedProcedure.input(quickChatChooseInput)
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => view(await chooseQuickChat(context(ctx, input.channel), input).catch(requestFailure), ctx)),
  /** End a stored thought that was not sent. */
  discard: authedProcedure.input(quickChatDiscardInput)
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => view(await discardQuickChat({ boxRoot: ctx.boxRoot }, input).catch(requestFailure), ctx)),
  /** What the box screen shows. */
  home: authedProcedure.output(quickChatHomeSchema).query(async ({ ctx }) => quickChatHome(ctx.boxRoot)),
});
