/**
 * Telegram message card schema — outbound messages to Telegram chats.
 *
 * Agents create these cards in `box/output/` with `status: pending`.
 * The telegram connector sends them during sync, then deletes the card
 * on success or stamps it with an error on failure.
 */

import { cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const TelegramMessageStatus = z.enum(["pending", "sent", "failed"]);
export type TelegramMessageStatusValue = z.infer<typeof TelegramMessageStatus>;

const TelegramResponse = z.object({
  "sent-at": z.string().datetime({ offset: true }),
  "message-id": z.string(),
});

export const TelegramMessageSchema: CardSchema = cardSchema("telegram-message", {
  fields: {
    status: TelegramMessageStatus.default("pending"),
    "chat-id": z.string(),
    text: z.string(),
    "reply-to": z.coerce.number().int().optional(),
    response: TelegramResponse.optional(),
    error: z.string().optional(),
  },
  instructions: `# Sending Telegram Messages

To send a message to a Telegram chat, create a card in
\`box/output/\` with the \`.telegram-message.card\` extension.

## Required frontmatter
- \`chat-id:\` — The Telegram chat ID (negative for groups)
- \`text:\` — The message text (max 4096 chars). Supports Telegram
  MarkdownV2 formatting.

## Optional
- \`reply-to:\` — Message ID to reply to (creates a threaded reply)

## Lifecycle
1. Create the card with \`status: pending\`
2. Stage and commit
3. The telegram connector sends it during \`cb wakeup\` or \`cb finalize\`
4. On success: card is deleted
5. On failure: \`status\` becomes \`failed\`, an \`error\` field is added`,
});

export interface TelegramMessageFields {
  type: "telegram-message";
  status: TelegramMessageStatusValue;
  "chat-id": string;
  text: string;
  "reply-to"?: number;
  response?: { "sent-at": string; "message-id": string };
  error?: string;
}

export function createTelegramMessageTemplate(options: {
  chatId: string;
  text: string;
  replyTo?: number;
}): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    "chat-id": options.chatId,
    text: options.text,
  };
  if (options.replyTo !== undefined) {
    fields["reply-to"] = options.replyTo;
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
