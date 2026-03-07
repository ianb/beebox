/**
 * Pushover message card schema — outbound push notifications.
 *
 * Agents create these cards in `box/output/` with status="pending".
 * The pushover connector sends them during `cb finalize`, then
 * records the response and deletes the card.
 */

import { element, escapeText } from "cardworks";
import { z } from "zod";

export const PushoverMessageStatus = z.enum(["pending", "sent", "failed"]);

/** Required message body (max 1024 chars). */
export const PushoverMessageBody = element("message", {
  text: z.string().max(1024),
});

/** Optional title/heading (max 250 chars). */
export const PushoverMessageTitle = element("title", {
  text: z.string().max(250),
});

/** Optional supplementary URL (max 512 chars). */
export const PushoverMessageUrl = element("url", {
  text: z.string().url().max(512),
});

/** Optional title for the URL link. */
export const PushoverMessageUrlTitle = element("url-title", {
  text: z.string(),
});

/** Optional priority: -2 (quiet) to 2 (emergency). Default 0. */
export const PushoverMessagePriority = element("priority", {
  text: z.coerce.number().int().min(-2).max(2),
});

/** Optional notification sound. */
export const PushoverMessageSound = element("sound", {
  text: z.string(),
});

/** Set text to "1" to enable HTML in the message body. */
export const PushoverMessageHtml = element("html", {
  text: z.enum(["1", "0"]),
});

/** Added by connector on success. */
export const PushoverMessageResponse = element("response", {
  attrs: {
    "sent-at": z.string().datetime({ offset: true }),
    "request-id": z.string(),
  },
});

/** Added by connector on failure. */
export const PushoverMessageError = element("error", {
  text: z.string(),
});

/**
 * Pushover message card schema.
 *
 * Example (pending):
 * ```xml
 * <pushover-message status="pending">
 * <message>Don't forget to check the garden</message>
 * <title>Reminder</title>
 * <sound>magic</sound>
 * </pushover-message>
 * ```
 *
 * Example (sent):
 * ```xml
 * <pushover-message status="sent">
 * <message>Don't forget to check the garden</message>
 * <title>Reminder</title>
 * <sound>magic</sound>
 * <response sent-at="2026-02-22T10:00:00Z" request-id="abc123" />
 * </pushover-message>
 * ```
 */
export const PushoverMessageSchema = element("pushover-message", {
  attrs: {
    status: PushoverMessageStatus.default("pending"),
  },
  children: z.array(
    z.union([
      PushoverMessageBody,
      PushoverMessageTitle,
      PushoverMessageUrl,
      PushoverMessageUrlTitle,
      PushoverMessagePriority,
      PushoverMessageSound,
      PushoverMessageHtml,
      PushoverMessageResponse,
      PushoverMessageError,
    ])
  ),
  instructions: `# Sending Push Notifications

To send a push notification, create a card in \`box/output/\` with the \`.pushover-message.card\` extension.

## Required Elements
- \`<message>\` — The notification body (max 1024 chars). Supports HTML if \`<html>1</html>\` is set.

## Optional Elements
- \`<title>\` — Heading (max 250 chars). Defaults to app name if omitted.
- \`<url>\` — Supplementary URL (max 512 chars)
- \`<url-title>\` — Title for the URL link
- \`<priority>\` — \`-2\` (quiet), \`-1\` (low), \`0\` (normal, default), \`1\` (high), \`2\` (emergency)
- \`<sound>\` — Notification sound. Values: pushover (default), bike, bugle, cashregister, classical, cosmic, falling, gamelan, incoming, intermission, magic, mechanical, pianobar, siren, spacealarm, tugboat, alien, climb, persistent, echo, updown, vibrate, none
- \`<html>\` — Set to \`1\` to enable HTML in message. Supported tags: \`<b>\`, \`<i>\`, \`<u>\`, \`<font color="...">\`, \`<a href="...">\`

## Lifecycle
1. Create the card with \`status="pending"\`
2. Stage and commit
3. The pushover connector sends it during \`cb finalize\`
4. On success: status becomes "sent", a \`<response>\` element is added, then the card is deleted
5. On failure: status becomes "failed", an \`<error>\` element is added, card is kept for inspection

## Example
\`\`\`xml
<pushover-message status="pending">
<message>Build completed successfully</message>
<title>CI Notification</title>
<sound>magic</sound>
</pushover-message>
\`\`\``,
});

export type PushoverMessage = z.infer<typeof PushoverMessageSchema>;

/**
 * Template for creating a new pushover message card.
 */
export function createPushoverMessageTemplate(options: {
  message: string;
  title?: string;
  url?: string;
  urlTitle?: string;
  priority?: number;
  sound?: string;
  html?: boolean;
}): string {
  const parts: string[] = ["<pushover-message status=\"pending\">"];
  parts.push(`<message>${escapeText(options.message)}</message>`);
  if (options.title) parts.push(`<title>${escapeText(options.title)}</title>`);
  if (options.url) parts.push(`<url>${escapeText(options.url)}</url>`);
  if (options.urlTitle) parts.push(`<url-title>${escapeText(options.urlTitle)}</url-title>`);
  if (options.priority !== undefined) parts.push(`<priority>${options.priority}</priority>`);
  if (options.sound) parts.push(`<sound>${escapeText(options.sound)}</sound>`);
  if (options.html) parts.push("<html>1</html>");
  parts.push("</pushover-message>");
  parts.push("");
  return parts.join("\n");
}
