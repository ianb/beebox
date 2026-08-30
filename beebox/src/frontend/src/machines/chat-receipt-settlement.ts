/** Receipt settlement that outlives the streaming actor which issued the POST. */

import type { ChatTurnStart } from "../api-chat";
import { settleReceipt } from "../input/targets/receipts";
import { chatSendReasonKind, recordChatSendEvent } from "../lib/chat-send-diagnostics";

interface TurnStartSettlement {
  messageId: string;
  result: ChatTurnStart;
  actorCancelled?: boolean;
}

/** Map every successful POST shape to a receipt, then report whether UI work may continue. */
export function settleFromTurnStart(options: TurnStartSettlement): boolean {
  const { messageId, result } = options;
  recordChatSendEvent(messageId, { event: "post-response", detail: {
    outcome: result.deduplicated ? "deduplicated" : result.queued ? "queued" : result.turnId ? "turn-started" : "empty" } });
  if (result.deduplicated) {
    settleReceipt({ disposition: "sent", emissionId: messageId, deduplicated: true });
  } else if (result.queued) {
    settleReceipt({ disposition: "queued", emissionId: messageId });
  } else if (result.turnId) {
    settleReceipt({ disposition: "sent", emissionId: messageId, deduplicated: false });
  } else {
    settleReceipt({ disposition: "rejected", emissionId: messageId, reason: "Send returned no turn id" });
  }
  return options.actorCancelled !== true;
}

/** Report a rejected POST even if the streaming actor no longer owns UI state. */
export function settleRejectedTurnStart(options: {
  messageId: string;
  reason: string;
  actorCancelled?: boolean;
}): boolean {
  recordChatSendEvent(options.messageId, {
    event: "post-error",
    detail: { reasonKind: chatSendReasonKind(options.reason) },
  });
  settleReceipt({ disposition: "rejected", emissionId: options.messageId, reason: options.reason });
  return options.actorCancelled !== true;
}
