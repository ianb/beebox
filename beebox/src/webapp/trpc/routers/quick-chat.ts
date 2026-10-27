import { z } from "zod";
import { router, authedProcedure } from "../procedures.js";
import { quickChatHqServiceSchema, QUICK_CHAT_ORIGINS, QUICK_CHAT_SOURCES, quickChatViewSchema } from "../../../core/chat/routing/quick-chat-record.js";
import { chooseQuickChat, discardQuickChat, retryQuickChat, submitQuickChat } from "../../../core/chat/routing/quick-chat-submit/submit.js";
import { quickChatHome, quickChatHomeSchema } from "../../../core/chat/routing/quick-chat-home.js";
import { CHAT_CHANNELS } from "../../../shared/chat-channel.js";
import { quickChatContext, quickChatRecordView, quickChatRequestFailure } from "../quick-chat-delivery.js";

const idSchema = z.string().uuid();
const channelSchema = z.enum(CHAT_CHANNELS).optional();
/** `origin` is absent from clients built before it existed; their thoughts were typed. */
export const quickChatSubmitInput = z.object({ id: idSchema, message: z.string().trim().min(1).max(12000),
  origin: z.enum(QUICK_CHAT_ORIGINS).default("typed"), source: z.enum(QUICK_CHAT_SOURCES).optional(),
  /** The engine of an HQ pass the phone ran (docs/implemented-plans/ios-quick-chat-hq.md); absent is live text. */
  hqService: quickChatHqServiceSchema.optional(), channel: channelSchema })
  .superRefine((input, ctx) => {
    if (input.origin !== "voice" && input.hqService !== undefined) ctx.addIssue({ code: "custom", message: "hqService is only valid for a voice quick chat.", path: ["hqService"] });
    if (input.origin === "external" && input.source === undefined) ctx.addIssue({ code: "custom", message: "External quick chat requires a source.", path: ["source"] });
    if (input.origin !== "external" && input.source !== undefined) ctx.addIssue({ code: "custom", message: "Source is only valid for external quick chat.", path: ["source"] });
  });
export const quickChatChooseInput = z.object({ id: idSchema, candidateId: z.string().min(1), channel: channelSchema });
export const quickChatDiscardInput = z.object({ id: idSchema });
export const quickChatRetryInput = z.object({ id: idSchema, channel: channelSchema });

export const quickChatRouter = router({
  /** Store, route, and deliver one thought. A repeat with the same id returns the stored record, retrying a pending delivery. */
  submit: authedProcedure.input(quickChatSubmitInput)
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => {
      const request = { id: input.id, message: input.message, origin: input.origin,
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.hqService === undefined ? {} : { hqService: input.hqService }) };
      return quickChatRecordView(await submitQuickChat(quickChatContext(ctx, input.channel), request).catch(quickChatRequestFailure), ctx);
    }),
  /** Fix the person's chosen destination for a stored thought, and deliver it. */
  choose: authedProcedure.input(quickChatChooseInput)
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => quickChatRecordView(await chooseQuickChat(quickChatContext(ctx, input.channel), input).catch(quickChatRequestFailure), ctx)),
  /**
   * Deliver a stored thought again, with its own words. The box screen's Retry
   * uses it: a page sent from the Clerk may have no words, which `submit` refuses.
   */
  retry: authedProcedure.input(quickChatRetryInput)
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => quickChatRecordView(await retryQuickChat(quickChatContext(ctx, input.channel), input).catch(quickChatRequestFailure), ctx)),
  /** End a stored thought that was not sent. */
  discard: authedProcedure.input(quickChatDiscardInput)
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => quickChatRecordView(await discardQuickChat({ boxRoot: ctx.boxRoot }, input).catch(quickChatRequestFailure), ctx)),
  /** What the box screen shows. */
  home: authedProcedure.output(quickChatHomeSchema).query(async ({ ctx }) => quickChatHome(ctx.boxRoot)),
});
