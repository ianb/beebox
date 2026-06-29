/**
 * Web Push card schema — outbound push notifications to the boxholder's
 * subscribed devices.
 *
 * The durable push analog of telegram-message: written to `box/output/` with
 * `status: pending`, delivered by the push connector during `cb finalize`,
 * deleted on success, or stamped `failed` (and left in place) when delivery
 * fails — so a failed push is an inspectable artifact, never a silent drop.
 *
 * There is no chat-id analog: the audience is "this box's subscribed
 * endpoints", resolved at send time from the server-level subscription store.
 * See docs/plans/web-push-notifications.md (Track C).
 */

import { cardSchema, type CardSchema } from "../cards/index.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const WebPushStatus = z.enum(["pending", "failed"]);
export type WebPushStatusValue = z.infer<typeof WebPushStatus>;

export const WebPushSeverity = z.enum(["info", "alert"]);
export type WebPushSeverityValue = z.infer<typeof WebPushSeverity>;

export const WebPushSchema: CardSchema = cardSchema("web-push", {
  fields: {
    status: WebPushStatus.default("pending"),
    title: z.string(),
    body: z.string(),
    /** Root-relative deep link opened when the notification is clicked. */
    url: z.string(),
    severity: WebPushSeverity.default("alert"),
    tag: z.string().optional(),
    error: z.string().optional(),
  },
  instructions: `# Sending Web Push notifications

Prefer the \`notifyBoxholder\` helper in box code over hand-writing this card —
it fans out to every configured channel (web push + Telegram). To push directly,
create a card in \`box/output/\` with the \`.web-push.card\` extension.

## Required frontmatter
- \`title:\` — Short notification title.
- \`body:\` — Notification body text.
- \`url:\` — Root-relative deep link opened on click (e.g. \`/box/health\`).

## Optional
- \`severity:\` — \`info\` or \`alert\` (default \`alert\`).
- \`tag:\` — Collapses notifications that share a tag.

## Lifecycle
1. Create the card with \`status: pending\`.
2. Stage and commit.
3. The push connector delivers it during \`cb finalize\` to the box's
   subscribed devices.
4. On delivery (at least one device): card is deleted.
5. On failure (no device, or all sends failed): \`status\` becomes \`failed\`,
   an \`error\` field is added. Failed cards are not retried — fix or delete.`,
});

export interface WebPushFields {
  type: "web-push";
  status: WebPushStatusValue;
  title: string;
  body: string;
  url: string;
  severity: WebPushSeverityValue;
  tag?: string;
  error?: string;
}

export function createWebPushTemplate(options: {
  title: string;
  body: string;
  url: string;
  severity?: WebPushSeverityValue | undefined;
  tag?: string | undefined;
}): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    title: options.title,
    body: options.body,
    url: options.url,
    severity: options.severity ?? "alert",
  };
  if (options.tag) fields["tag"] = options.tag;
  return `---\n${stringifyYaml(fields)}---\n`;
}
