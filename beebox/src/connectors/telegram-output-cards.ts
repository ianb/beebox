/**
 * _bookkeeping/output/ telegram-message card delivery — the documented contract
 * in src/schemas/telegram-message.ts: agents (and the scheduler's
 * health alerter) drop a card with `status: pending`; the telegram
 * connector sends it during sync, deletes it on success, and stamps it
 * `failed` (with the error) on failure. Failed cards are left in place
 * for inspection and are not retried.
 */

import { TelegramMessageSchema, type TelegramMessageFields } from "../schemas/telegram-message.js";
import { deliverPendingOutputCards } from "./output-cards.js";
import type { TelegramService } from "../services/telegram.js";
import { errorMessage } from "../lib/error-guards.js";

const CARD_SUFFIX = ".telegram-message.card";

interface OutputCardsContext {
  boxRoot: string;
  triggeredBy: string | undefined;
  tg: TelegramService;
}

/**
 * Send all pending telegram-message cards in _bookkeeping/output/. Returns the
 * relative paths of cards that were sent (and deleted). One card's
 * failure doesn't stop the rest.
 */
export async function sendOutputCards(ctx: OutputCardsContext): Promise<string[]> {
  const { boxRoot, triggeredBy, tg } = ctx;
  return deliverPendingOutputCards<TelegramMessageFields>({
    boxRoot,
    triggeredBy,
    cardSuffix: CARD_SUFFIX,
    schema: TelegramMessageSchema,
    failureVerb: "send",
    outboxLabel: "Telegram outbox",
    pushedBy: "telegram-connector",
    describeSent: (count) => `send ${count} telegram message${count === 1 ? "" : "s"}`,
    send: async (fields) => {
      try {
        await tg.sendMessage(fields["chat-id"], fields.text);
        return null;
      } catch (sendErr) {
        return errorMessage(sendErr);
      }
    },
  });
}
