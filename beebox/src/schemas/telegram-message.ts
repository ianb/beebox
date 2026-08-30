/**
 * Telegram message card schema — outbound messages to Telegram chats.
 *
 * Agents create these cards in `box/output/` with `status: pending`.
 * The telegram connector sends them during sync, then deletes the card
 * on success or stamps it with an error on failure.
 */

import { cardSchema, renderFrontmatterBlock, type InferCardFields } from "../cards/index.js";
import { z } from "zod";

const TelegramMessageStatus = z.enum(["pending", "sent", "failed"]);
export type TelegramMessageStatusValue = z.infer<typeof TelegramMessageStatus>;

const TelegramResponse = z.object({
  "sent-at": z.string().datetime({ offset: true }),
  "message-id": z.string(),
});

export const TelegramMessageSchema = cardSchema("telegram-message", {
  description: "An outbound Telegram message queued in box/output/ — the connector sends it on sync and deletes the card on success",
  category: "synced",
  fields: {
    status: TelegramMessageStatus.default("pending"),
    "chat-id": z.string(),
    text: z.string(),
    response: TelegramResponse.optional(),
    error: z.string().optional(),
  },
  instructions: `# Sending Telegram Messages

To send a message to a Telegram chat, create a card in
\`box/output/\` with the \`.telegram-message.card\` extension.

## Required frontmatter
- \`chat-id:\` — The Telegram chat ID (negative for groups)
- \`text:\` — The message text (max 4096 chars), sent as plain text.

## Lifecycle
1. Create the card with \`status: pending\`
2. Stage and commit
3. The telegram connector sends it during \`bbx wakeup\` or \`bbx finalize\`
4. On success: card is deleted
5. On failure: \`status\` becomes \`failed\`, an \`error\` field is added.
   Failed cards are not retried — fix or delete them.`,
});

export type TelegramMessageFields = InferCardFields<typeof TelegramMessageSchema>;

export function createTelegramMessageTemplate(options: {
  chatId: string;
  text: string;
}): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    "chat-id": options.chatId,
    text: options.text,
  };
  return renderFrontmatterBlock(fields);
}
