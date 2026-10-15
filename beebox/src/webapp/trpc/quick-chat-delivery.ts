/**
 * Quick chat as the tRPC routers use it: delivery through the box's chat
 * runtime, the per-request context, the client view, and error mapping.
 * Shared by `quickChat.*` and `clerk.send`, so it sits outside the routers.
 */

import { TRPCError } from "@trpc/server";
import { observeAssignedSession } from "../../core/chat/session/deliver-user-message.js";
import type { TrpcContext } from "./context.js";
import { quickChatView, type QuickChatRecord, type QuickChatView } from "../../core/chat/routing/quick-chat-record.js";
import {
  QuickChatDestinationFixedError, QuickChatInvalidChoiceError, QuickChatNotFoundError, QuickChatTextConflictError,
  type QuickChatChat, type QuickChatContext, type QuickChatDeliveryOutcome,
} from "../../core/chat/routing/quick-chat-submit/submit.js";
import type { ChatChannel } from "../../shared/chat-channel.js";
import { getChatRuntime, type SendOutcome } from "../chat-runtime.js";
import { getBoxTime } from "../../lib/time.js";
import { toError } from "../../shared/error-guards.js";
import { frameExternalCapture } from "../../core/quick-capture/framing.js";
import { locateSentCard } from "../../core/clerk-incoming.js";

const SENT_PAGE_REMOVED = "The sent page was removed.";

function deliveryOutcome(outcome: SendOutcome): QuickChatDeliveryOutcome {
  const { body } = outcome;
  if ("deduplicated" in body) return { kind: "duplicate" };
  if ("queued" in body) return { kind: "accepted", queued: true };
  if ("turnId" in body) return { kind: "accepted", queued: false };
  return { kind: "failed", error: body.error };
}

/** The box's chat runtime as quick chat delivers through it: the send route's own target resolution and sender. */
export function quickChatChat(ctx: Pick<TrpcContext, "boxRoot" | "user">, channel?: ChatChannel): QuickChatChat | undefined {
  const runtime = getChatRuntime(ctx.boxRoot);
  if (runtime === undefined) return undefined;
  return {
    reserve: (opts) => runtime.registry.reserve(opts),
    async deliver({ delivery, messageId, message, origin, source, sourceRef, retainedRecording, recordingInterrupted, captureInputKind, hqService, onSessionAssigned }) {
      // A Clerk page may have been filed before delivery: deliver its current path, or nothing.
      let ref = sourceRef;
      if (source === "browser-clerk" && sourceRef !== undefined) {
        const current = await locateSentCard(ctx.boxRoot, { id: messageId, sourceRef });
        if (current === null) return { kind: "failed", error: SENT_PAGE_REMOVED };
        ref = current;
      }
      const fresh = delivery.session === "new";
      const resolved = await runtime.resolveSendTarget({ sessionParam: delivery.session, exactSession: delivery.exactSession,
        contextDir: fresh ? delivery.contextDir : undefined, requestSeedFeatures: undefined, ...(fresh ? { engine: delivery.engine } : {}) });
      // 410 is a deleted or deleting chat; 404 an exact session that no longer resumes. Both are gone.
      if (!resolved.ok) return resolved.code === "CHAT_SESSION_UNAVAILABLE" || resolved.status === 404 ? { kind: "gone" } : { kind: "failed", error: resolved.error };
      // Framed as the composer frames a message, so the sender is attributed, and tagged with how it arrived.
      // A dictated thought carries the HQ engine when the phone ran its own HQ pass
      // (docs/plans/ios-quick-chat-hq.md); otherwise it is the live transcript and carries the live
      // marker (docs/plans/hq-always.md). No recording reaches the box, so there is no server pass.
      const tag = origin === "voice" ? "speech" : "typed";
      const framedMessage = origin === "external"
        ? frameExternalCapture({ message, source, sourceRef: ref, retainedRecording, recordingInterrupted, captureInputKind })
        : origin === "voice"
          ? `<speech source="box-screen" ${hqService === undefined ? "stt=\"live\"" : `stt-service="${hqService}"`}>${message}</speech>`
          : `<${tag} source="box-screen">${message}</${tag}>`;
      const stopWatching = fresh && onSessionAssigned !== undefined
        ? observeAssignedSession({ registry: runtime.registry, session: resolved.target.session, onAssigned: onSessionAssigned, logPrefix: "quick-chat" }) : undefined;
      const result = deliveryOutcome(await runtime.sendUserMessage({ target: resolved.target, message: framedMessage, messageId, user: ctx.user, channel }));
      if (result.kind !== "accepted") stopWatching?.();
      const actualId = result.kind === "accepted" || !fresh
        ? resolved.target.id ?? (onSessionAssigned === undefined ? null : resolved.target.session.getSessionId()) : null;
      return (result.kind === "accepted" || result.kind === "duplicate") && actualId !== null ? { ...result, sessionId: actualId } : result;
    },
  };
}


export function quickChatContext(ctx: TrpcContext, channel?: ChatChannel): QuickChatContext {
  return { boxRoot: ctx.boxRoot, jev: ctx.services.jev, chat: quickChatChat(ctx, channel) };
}

export function quickChatRecordView(record: QuickChatRecord, ctx: TrpcContext): QuickChatView {
  return quickChatView(record, getBoxTime(ctx.boxRoot).getTime());
}

export function quickChatRequestFailure(error: unknown): never {
  if (error instanceof QuickChatTextConflictError || error instanceof QuickChatDestinationFixedError) throw new TRPCError({ code: "CONFLICT", message: error.message });
  if (error instanceof QuickChatNotFoundError) throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  if (error instanceof QuickChatInvalidChoiceError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw toError(error);
}
