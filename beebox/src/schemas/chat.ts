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
import { sdkSessionIdSchema } from "../core/chat/session/session-id.js";
import { AGENT_ENGINES, type AgentEngine } from "../shared/agent-models.js";

const chatFields = {
  /**
   * Engine session id — the pointer to the live session/transcript, and the
   * husk's only key (the filename is a naming convention; see
   * docs/implemented-plans/chat-session-identity.md). Validated as the same strict UUID
   * shape `chat.delete` parses before it builds a path, via the one
   * `sdkSessionIdSchema` definition: Claude Agent SDK ids are UUIDv4 and Codex
   * thread ids are UUIDv7, so a single UUID check covers both engines.
   */
  session: sdkSessionIdSchema,
  /** Box-relative directory the chat is bound to ("" = box root). */
  "context-dir": z.string().optional(),
  /**
   * Which engine ran the chat. Machine-written at session start; the durable
   * copy of what the per-checkout history file holds (`session/history.ts`).
   */
  engine: z.enum(AGENT_ENGINES).optional(),
  /**
   * Id of the machine whose engine store holds this session's transcript
   * (`session/origin.ts`) — the one fact nothing can derive later, and what
   * tells "the transcript expired" from "it was never on this machine".
   */
  origin: z.string().optional(),
  /** That machine's hostname when the field was written. A label only. */
  "origin-name": z.string().optional(),
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

A \`chat\` card is the durable face of a web chat session — created automatically when a session starts, under \`_content/chat/web/\`. The \`session\` field is the association (renaming the file is safe and encouraged once the topic is clear: \`bbx mv\` to a meaningful name).

A nightly **chat review** pass maintains \`title\`, \`contains\` and \`contains-evidence\` (a running account of what the conversation amounted to) on sessions that have grown enough to be worth re-reading. **A title you set by hand wins permanently** — the review detects the edit and never touches that field again. \`contains\`/\`contains-evidence\` are machine-owned; \`review-span\` is bookkeeping, leave it alone. \`engine\`, \`origin\` and \`origin-name\` are machine-owned provenance — which engine ran the chat and which machine holds its transcript — so leave those alone too.

The body is yours: add refs to cards the chat discussed ("decided in this chat: [ref]") and durable notes about the conversation. The review never touches it. Don't record activity timestamps or message counts — runtime state stays off the card.`,
});

/** Starter husk content. `title` included only when known (often not, at assignment time). */
export function createChatHuskTemplate(options: {
  session: string;
  contextDir?: string;
  engine?: AgentEngine;
  origin?: string;
  originName?: string;
  title?: string;
}): string {
  const fields: Record<string, unknown> = { session: options.session };
  if (options.contextDir !== undefined && options.contextDir !== "") {
    fields["context-dir"] = options.contextDir;
  }
  if (options.engine !== undefined) fields["engine"] = options.engine;
  if (options.origin !== undefined && options.origin !== "") {
    fields["origin"] = options.origin;
  }
  if (options.originName !== undefined && options.originName !== "") {
    fields["origin-name"] = options.originName;
  }
  if (options.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  return renderFrontmatterBlock(fields);
}
