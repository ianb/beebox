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
 *
 * Both *engines* now go through it too, for the same reason: Codex chats had
 * their own label path that skipped the cleaning, so every Codex row in the
 * list read as raw `<chat-app …>` envelope. An engine supplies only where its
 * first user message is found ({@link SessionLabelSource}); nothing else about
 * naming a chat is per-engine.
 */

import { readFirstUserSnippet, snippetFromUserText } from "../../cli/lib/session-snippet.js";

/** Chars of the first user message used when there is no title. */
export const SNIPPET_MAX_LEN = 400;

/**
 * Where a label's first-user-message text comes from — the *only* thing the
 * two engines are allowed to disagree about.
 *
 * Claude chats are named by scanning their JSONL transcript; Codex chats are
 * named from the app-server's `preview`, which is the thread's verbatim first
 * user message (one `thread/list` call already carries it for every thread, so
 * naming a Codex row costs no extra I/O). Both then go through the same
 * cleaning and the same order below — the step Codex used to bypass. They
 * still differ in one documented way: how far each looks for a first message
 * (see `firstUserSnippet`).
 */
export type SessionLabelSource =
  | { kind: "transcript"; logPath: string }
  /**
   * Undefined when the thread's metadata never reached us. The chat lists drop
   * such a chat before labelling (`session/list.ts` `loadSessionEntry`), so
   * this is the type's possibility, not a state they reach.
   */
  | { kind: "preview"; text: string | undefined };

/**
 * Resolve a session's display label. `title` is the husk's, when it has one.
 * A transcript that can't be read falls back to the id prefix rather than
 * failing the list — but says so, since a systematically unreadable transcript
 * is worth noticing.
 */
export async function resolveSessionLabel(args: {
  sessionId: string;
  source: SessionLabelSource;
  title: string | undefined;
}): Promise<string> {
  const { sessionId, source, title } = args;
  if (title !== undefined && title !== "") return title;

  try {
    const snippet = await firstUserSnippet(source);
    if (snippet !== null) return snippet;
  } catch (e) {
    console.warn(`chat: could not read metadata for session ${sessionId}, using id prefix:`, e);
  }
  return sessionId.slice(0, 8);
}

async function firstUserSnippet(source: SessionLabelSource): Promise<string | null> {
  if (source.kind === "transcript") {
    return readFirstUserSnippet({ logPath: source.logPath, snippetMaxLen: SNIPPET_MAX_LEN });
  }
  // Only the *first* message, so there is no rescan when it strips to nothing
  // (the transcript path keeps looking, since a transcript's opening turns can
  // be all wrapper markup). An opener with no text left therefore falls back to
  // the id prefix — accepted rather than paying a serialized `thread/read` per
  // row, since a web-composer send always carries the person's text.
  if (source.text === undefined) return null;
  return snippetFromUserText(source.text, SNIPPET_MAX_LEN);
}
