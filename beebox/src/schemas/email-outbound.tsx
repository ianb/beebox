/**
 * Email outbound card schema — agent-authored emails that go OUT through Gmail.
 *
 * This is the schema the agent writes when composing an email. Headers
 * live in the YAML frontmatter; the body of the email is the markdown
 * body of the card itself — what's between the closing `---` and EOF.
 *
 * Every outbound email starts as a draft uploaded to Gmail's Drafts
 * folder for the user to review and send. Future states (e.g.
 * `status: sent` for direct-send without human review) layer onto the
 * same schema.
 *
 * Pairs with `email-message` (incoming, plus eventually mirrored sent
 * messages from the Gmail Sent folder). The two are intentionally
 * separate card types so triage code that globs `*.email-message.card`
 * doesn't pick up an outbound draft and try to process it like a
 * received email.
 *
 * Example (reply draft):
 *
 *   ---
 *   type: email-outbound
 *   status: draft
 *   to: alice@example.com
 *   subject: Re Weekend plans
 *   in-reply-to:
 *     ref: msg-001.email-message.card
 *   ---
 *   Sounds good — let's meet at 11.
 *
 *   We can do the usual place.
 */

import { z } from "zod";
import { body, cardSchema, type InferCardFields } from "../cards/index.js";

export const EmailOutboundSchema = cardSchema("email-outbound", {
  description: "An agent-composed outgoing email — uploaded to Gmail as a draft for the user to review and send",
  category: "authored",
  fields: {
    status: z.enum(["draft", "sent"]).default("draft"),
    to: z.string(),
    cc: z.string().optional(),
    bcc: z.string().optional(),
    subject: z.string(),
    "in-reply-to": z.object({ ref: z.string() }).optional(),
    "gmail-draft-id": z.string().optional(),
    "gmail-draft-url": z.string().optional(),
    body: body(z.string()),
  },
  instructions: `# Authoring Outbound Emails

You compose an email by writing an \`email-outbound\` card. Headers live
in the YAML frontmatter; the message body is the markdown body of the
card. The Gmail connector picks the card up on the next sync and
creates a Gmail draft for the user to review and send.

## Required fields (frontmatter)

- \`to:\` — recipient address(es), comma-separated
- \`subject:\` — subject line. For replies, prefix with \`Re:\` to match
  the source thread's subject.

The card's body is the email body. Markdown subset only:
\`**bold**\`, \`*italic*\`, \`[text](url)\`. Nothing else.

## Optional fields

- \`cc:\` and \`bcc:\` — additional recipients
- \`in-reply-to.ref:\` — for replies, points at the source
  \`email-message\` card. Use a path **relative to the draft's
  directory** (typically just \`msg-NNN.email-message.card\` since the
  draft sits in the same thread directory). The connector reads the
  source card's \`message-id\` and \`thread-id\` to set Gmail threading
  headers — if the ref doesn't resolve, the upload fails rather than
  silently lose threading.

## Placement

- **Reply drafts** go inside the existing thread's \`.attach/\` next to
  the source message, e.g.
  \`box/inbox/email/thread-X.attach/draft-001.email-outbound.card\`. This
  keeps the conversation co-located.
- **New emails (no thread)** go in a fresh directory under
  \`box/inbox/email/\`.

## Lifecycle

- \`status: draft\` (default) — the connector uploads to Gmail's Drafts
  folder on next sync and stamps the card with \`gmail-draft-id:\` and
  \`gmail-draft-url:\`. Share the URL with the user so they can review
  and send. Once stamped, the draft is **not** re-uploaded; editing
  the card after upload doesn't update the Gmail draft (yet).
- Deleting the card does **not** delete the Gmail draft — once Gmail
  has it, the user owns it.

## Threading checklist for replies

1. Place the draft in the **same directory** as the source message.
2. Set \`in-reply-to.ref:\` pointing at the specific message you're
   replying to.
3. Set \`subject: Re: <original subject>\`.
4. Don't set \`status\` explicitly — it defaults to \`draft\`.`,
});

export type EmailOutboundFields = InferCardFields<typeof EmailOutboundSchema>;
