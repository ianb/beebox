/**
 * Chat husk schema — a web chat session as a card.
 *
 * The husk is the session's *noun*: a small, searchable card making the
 * conversation addressable (linkable, ref-able, pinnable) while the live
 * session stays the verb. Identity + editorial only — the `session` field
 * points at the SDK session (transcripts live outside the box), and
 * activity/freshness stays in runtime bookkeeping, never on the card.
 * Created automatically at session-id assignment; see
 * docs/plans/chat-husks.md and src/core/chat-husk.ts.
 */

import { z } from "zod";
import { cardSchema, body, renderFrontmatterBlock, type CardSchema } from "../cards/index.js";

const chatFields = {
  /** Claude Agent SDK session id — the pointer to the live session/transcript. */
  session: z.string(),
  /** Box-relative directory the chat is bound to ("" = box root). */
  "context-dir": z.string().optional(),
  /**
   * Id of the last transcript span the nightly chat review folded into
   * `contains-evidence`. Machine-owned; it makes a re-apply after a crash
   * between the card write and the journal write detectable, so the account
   * can't be extended twice with the same material.
   */
  "review-span": z.string().optional(),
  body: body(z.string()),
};

export const ChatSchema: CardSchema = cardSchema("chat", {
  fields: chatFields,
  category: "synced",
  instructions: `# Chat Husk Cards

A \`chat\` card is the durable face of a web chat session — created automatically when a session starts, under \`store/chat/web/\`. The \`session\` field is the association (renaming the file is safe and encouraged once the topic is clear: \`cb mv\` to a meaningful name).

A nightly **chat review** pass maintains \`title\`, \`contains\` and \`contains-evidence\` (a running account of what the conversation amounted to) on sessions that have grown enough to be worth re-reading. **A title you set by hand wins permanently** — the review detects the edit and never touches that field again. \`contains\`/\`contains-evidence\` are machine-owned; \`review-span\` is bookkeeping, leave it alone.

The body is yours: add refs to cards the chat discussed ("decided in this chat: [ref]") and durable notes about the conversation. The review never touches it. Don't record activity timestamps or message counts — runtime state stays off the card.`,
});

/** Starter husk content. `title` included only when known (often not, at assignment time). */
export function createChatHuskTemplate(options: {
  session: string;
  contextDir?: string;
  title?: string;
}): string {
  const fields: Record<string, unknown> = { session: options.session };
  if (options.contextDir !== undefined && options.contextDir !== "") {
    fields["context-dir"] = options.contextDir;
  }
  if (options.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  return renderFrontmatterBlock(fields);
}
