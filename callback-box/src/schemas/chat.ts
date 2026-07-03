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
import { stringify as stringifyYaml } from "yaml";
import { cardSchema, body, type CardSchema } from "../cards/index.js";

const chatFields = {
  /** Claude Agent SDK session id — the pointer to the live session/transcript. */
  session: z.string(),
  /** Box-relative directory the chat is bound to ("" = box root). */
  "context-dir": z.string().optional(),
  body: body(z.string()),
};

export const ChatSchema: CardSchema = cardSchema("chat", {
  fields: chatFields,
  category: "synced",
  instructions: `# Chat Husk Cards

A \`chat\` card is the durable face of a web chat session — created automatically when a session starts, under \`store/chat/web/\`. The \`session\` field is the association (renaming the file is safe and encouraged once the topic is clear: \`cb mv\` to a meaningful name).

Editorial fields are yours to maintain: set \`title\` and \`contains\` once the conversation has a topic, add refs in the body to cards the chat discussed ("decided in this chat: [ref]"), and use the body for durable notes about the conversation. Don't record activity timestamps or message counts — runtime state stays off the card.`,
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
  return `---\n${stringifyYaml(fields)}---\n`;
}
