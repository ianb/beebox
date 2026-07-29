/**
 * What a chat session is called in a list.
 *
 * One resolution order, shared by both session-list endpoints: the husk's
 * editorial `title` wins (hand-set or written by the nightly chat review),
 * then the transcript's first user message, then the session id prefix.
 *
 * Extracted because the two endpoints disagreed — `trpc/routers/chat.ts` was
 * title-aware while `trpc/routers/chat-session-procedures.ts` (the one the
 * chat history dropdown actually calls) never read a husk, so a generated
 * title was invisible there. See docs/implemented-plans/chat-review.md § Track D.
 */

import { getSessionMetadata } from "../../cli/lib/session.js";

/** Chars of the first user message used when there is no title. */
export const SNIPPET_MAX_LEN = 400;

/**
 * Resolve a session's display label. `title` is the husk's, when it has one.
 * A transcript that can't be read falls back to the id prefix rather than
 * failing the list — but says so, since a systematically unreadable transcript
 * is worth noticing.
 */
export async function resolveSessionLabel(args: {
  sessionId: string;
  logPath: string;
  title: string | undefined;
}): Promise<string> {
  const { sessionId, logPath, title } = args;
  if (title !== undefined && title !== "") return title;

  try {
    const meta = await getSessionMetadata({
      sessionId,
      logPath,
      snippetMaxLen: SNIPPET_MAX_LEN,
    });
    if (meta.firstUserSnippet) return meta.firstUserSnippet;
  } catch (e) {
    console.warn(`chat: could not read metadata for session ${sessionId}, using id prefix:`, e);
  }
  return sessionId.slice(0, 8);
}
