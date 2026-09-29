/**
 * Telegram message card schema — outbound messages to Telegram chats.
 *
 * Agents create these cards in `_bookkeeping/output/`. The telegram connector
 * sends them during sync, then deletes the card on success or stamps it with
 * `delivery-error` on failure. A card without `delivery-error` is pending.
 */

import { cardSchema, renderFrontmatterBlock, type InferCardFields } from "../exports/cards.js";
import { z } from "zod";

const TelegramResponse = z.object({
  "sent-at": z.string().datetime({ offset: true }),
  "message-id": z.string(),
});

export const TelegramMessageSchema = cardSchema("telegram-message", {
  brief: "A queued outbound Telegram message",
  description: "An outbound Telegram message queued in _bookkeeping/output/ — the connector sends it on sync and deletes the card on success",
  category: "synced",
  fields: {
    "chat-id": z.string(),
    text: z.string(),
    response: TelegramResponse.optional(),
    // Set by the connector when sending fails; the card is then not retried.
    "delivery-error": z.string().optional(),
  },
  instructions: `# Sending Telegram Messages

To send a message to a Telegram chat, create a card in
\`_bookkeeping/output/\` with the \`.telegram-message.card\` extension.

## Required frontmatter
- \`chat-id:\` — The Telegram chat ID (negative for groups)
- \`text:\` — The message text (max 4096 chars), sent as plain text.

## Lifecycle
1. Create the card with \`chat-id\` and \`text\`
2. Stage and commit
3. The telegram connector sends it during \`bbx wakeup\` or \`bbx finalize\`
4. On success: card is deleted
5. On failure: the connector adds \`delivery-error\` with the failure text.
   A card with \`delivery-error\` is not retried — fix or delete it
   (removing \`delivery-error\` queues it again).`,
});

export type TelegramMessageFields = InferCardFields<typeof TelegramMessageSchema>;

export function createTelegramMessageTemplate(options: {
  chatId: string;
  text: string;
}): string {
  const fields: Record<string, unknown> = {
    "chat-id": options.chatId,
    text: options.text,
  };
  return renderFrontmatterBlock(fields);
}
