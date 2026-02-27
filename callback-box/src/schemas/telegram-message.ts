/**
 * Telegram message card schema — outbound messages to Telegram chats.
 *
 * Agents create these cards in `box/output/` with status="pending".
 * The telegram connector sends them during sync, then deletes the card.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";

export const TelegramMessageStatus = z.enum(["pending", "sent", "failed"]);

/** Required message text. */
export const TelegramMessageText = element("text", {
  text: z.string(),
});

/** Optional message ID to reply to. */
export const TelegramMessageReplyTo = element("reply-to", {
  text: z.coerce.number().int(),
});

/** Added by connector on success. */
export const TelegramMessageResponse = element("response", {
  attrs: {
    "sent-at": z.string().datetime({ offset: true }),
    "message-id": z.string(),
  },
});

/** Added by connector on failure. */
export const TelegramMessageError = element("error", {
  text: z.string(),
});

/**
 * Telegram message card schema.
 *
 * Example (pending):
 * ```xml
 * <telegram-message status="pending" chat-id="-1001234567890">
 *   <text>Hello from the box!</text>
 * </telegram-message>
 * ```
 *
 * Example (with reply):
 * ```xml
 * <telegram-message status="pending" chat-id="-1001234567890">
 *   <text>Sure, I'll pick you up at 3!</text>
 *   <reply-to>12345</reply-to>
 * </telegram-message>
 * ```
 */
export const TelegramMessageSchema = element("telegram-message", {
  attrs: {
    status: TelegramMessageStatus.default("pending"),
    "chat-id": z.string(),
  },
  children: z.array(
    z.union([
      TelegramMessageText,
      TelegramMessageReplyTo,
      TelegramMessageResponse,
      TelegramMessageError,
    ])
  ),
  instructions: `# Sending Telegram Messages

To send a message to a Telegram chat, create a card in \`box/output/\` with the \`.telegram-message.card\` extension.

## Required
- \`chat-id\` attribute — The Telegram chat ID (negative for groups)
- \`<text>\` — The message text (max 4096 chars). Supports Telegram MarkdownV2 formatting.

## Optional
- \`<reply-to>\` — Message ID to reply to (creates a threaded reply)

## Lifecycle
1. Create the card with \`status="pending"\`
2. Stage and commit
3. The telegram connector sends it during \`cb wakeup\` or \`cb finalize\`
4. On success: card is deleted
5. On failure: status becomes "failed", an \`<error>\` element is added

## Example
\`\`\`xml
<telegram-message status="pending" chat-id="-1001234567890">
  <text>Dinner is ready!</text>
</telegram-message>
\`\`\``,
});

export type TelegramMessage = z.infer<typeof TelegramMessageSchema>;

/**
 * Template for creating a new telegram message card.
 */
export function createTelegramMessageTemplate(options: {
  chatId: string;
  text: string;
  replyTo?: number;
}): string {
  const parts: string[] = [
    `<telegram-message status="pending" chat-id="${escapeAttr(options.chatId)}">`,
  ];
  parts.push(`  <text>${escapeText(options.text)}</text>`);
  if (options.replyTo !== undefined) {
    parts.push(`  <reply-to>${options.replyTo}</reply-to>`);
  }
  parts.push("</telegram-message>");
  parts.push("");
  return parts.join("\n");
}
