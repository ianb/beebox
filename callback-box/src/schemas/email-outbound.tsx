/** @jsxImportSource cardworks/jsx */
/**
 * Email outbound card schema — agent-authored emails that go OUT through Gmail.
 *
 * Today, every outbound email starts as a draft uploaded to Gmail's Drafts
 * folder for the user to review and send. Future states (e.g. `status="sent"`
 * for direct-send without human review) layer onto the same schema.
 *
 * Pairs with `email-message` (incoming, plus eventually mirrored sent
 * messages from the Gmail Sent folder). The two are intentionally separate
 * card types so triage code that globs `*.email-message.card` doesn't pick
 * up an outbound draft and try to process it like a received email.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";
import { EmailTo, EmailCc, EmailMessageSubject } from "./email-message.js";

/**
 * BCC recipient(s).
 */
export const EmailOutboundBcc = element("bcc", {
  text: z.string(),
});

/**
 * For replies: pointer to the source email-message card being replied to.
 * The connector reads that card's message-id/thread-id to set
 * `In-Reply-To`/`References` headers and Gmail threading.
 */
export const EmailOutboundInReplyTo = element("in-reply-to", {
  attrs: {
    ref: z.string(),
  },
});

/**
 * Inline body content. Markdown subset only: bold, italic, links.
 */
export const EmailOutboundBody = element("body", {
  text: z.string(),
});

/**
 * Email outbound card schema.
 *
 * Example (reply draft):
 * ```xml
 * <email-outbound status="draft">
 * <to>alice@example.com</to>
 * <subject>Re: Weekend plans</subject>
 * <in-reply-to ref="msg-001.email-message.card" />
 * <body>Sounds good — let's meet at 11.</body>
 * </email-outbound>
 * ```
 */
export const EmailOutboundSchema = element("email-outbound", {
  attrs: {
    status: z.enum(["draft", "sent"]).default("draft"),
    "gmail-draft-id": z.string().optional(),
    "gmail-draft-url": z.string().optional(),
  },
  children: z.array(
    z.union([
      EmailTo,
      EmailCc,
      EmailOutboundBcc,
      EmailMessageSubject,
      EmailOutboundInReplyTo,
      EmailOutboundBody,
    ])
  ),
  instructions: `# Authoring Outbound Emails

You can compose an email by writing an email-outbound card. The Gmail
connector picks it up on the next sync and creates a Gmail draft for the
user to review and send.

## Required children

- \`<to>\` — recipient address(es), comma-separated
- \`<subject>\` — subject line. For replies, prefix with \`Re: \` to match the
  source thread's subject.
- \`<body>\` — the message body. Markdown subset only:
  \`**bold**\`, \`*italic*\`, \`[text](url)\`. Nothing else.

## Optional children

- \`<cc>\` and \`<bcc>\` — additional recipients
- \`<in-reply-to ref="..." />\` — for replies, points at the source
  email-message card. Use a path **relative to the draft's directory**
  (typically just \`msg-NNN.email-message.card\` since the draft sits in
  the same thread directory). The connector reads the source card's
  \`message-id\` and \`thread-id\` to set Gmail threading headers — if the
  ref doesn't resolve, the upload fails rather than silently lose
  threading.

## Placement

- **Reply drafts** go inside the existing thread directory next to the
  source message, e.g.
  \`box/inbox/email/thread-X/draft-001.email-outbound.card\`. This keeps
  the conversation co-located.
- **New emails (no thread)** go in a fresh directory under
  \`box/inbox/email/\`, e.g.
  \`box/inbox/email/new-2026-04-28-greeting/draft-001.email-outbound.card\`.

## Lifecycle

- \`status="draft"\` (default) — the connector uploads to Gmail's Drafts
  folder on next sync and stamps the card with \`gmail-draft-id\` and
  \`gmail-draft-url\`. Share the URL with the user so they can review and
  send. Once stamped, the draft is **not** re-uploaded; editing the card
  after upload doesn't update the Gmail draft (yet).
- Deleting the card does **not** delete the Gmail draft — once Gmail
  has it, the user owns it.

## Threading checklist for replies

1. Place the draft in the **same directory** as the source message.
2. Set \`<in-reply-to ref="msg-NNN.email-message.card" />\` pointing at
   the specific message you're replying to.
3. Set \`<subject>Re: <original subject></subject>\`.
4. Don't set \`status\` explicitly — it defaults to \`"draft"\`.`,
});

export type EmailOutbound = z.infer<typeof EmailOutboundSchema>;

/**
 * Template for an agent-authored outbound email card.
 *
 * For replies, set `inReplyToRef` to the path of the source email-message
 * card relative to the directory the draft will be written into (typically
 * just `msg-NNN.email-message.card`).
 */
export function createEmailOutboundTemplate(options: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyToRef?: string;
}): string {
  const card = (
    <email-outbound status="draft">
      <to>{options.to}</to>
      {options.cc && <cc>{options.cc}</cc>}
      {options.bcc && <bcc>{options.bcc}</bcc>}
      <subject>{options.subject}</subject>
      {options.inReplyToRef && <in-reply-to ref={options.inReplyToRef} />}
      <body>{options.body}</body>
    </email-outbound>
  );

  return serialize(card) + "\n";
}
