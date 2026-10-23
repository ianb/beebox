/**
 * The text a chat turn shows once the chat folds lines written between steps,
 * for audits with `final_reply`. Mirrors `groupIntoParts`
 * (`src/frontend/src/components/chat/assistant-parts.ts`) on text blocks:
 * text after the last tool call is the reply; earlier text with `<speech>` or
 * a `<callout>` stays; when the reply has nothing but acks, the last earlier
 * text stays. Progress updates (thinking blocks) are not in the audit's text.
 */

const ACK = /<ack\b[^>]*?(?:\/\s*>|>[\S\s]*?<\/ack\s*>)|<no-response\b[^>]*>(?:<\/no-response\s*>)?/giu;
const KEPT_BEFORE_A_STEP = /<speech[\s>]|<callout\b/iu;

/** `chunks` are the turn's text blocks in order; those before `replyStart` came before the last tool call. */
export function visibleReplyText(chunks: string[], replyStart: number): string {
  const reply = chunks.slice(replyStart);
  const replyShown = reply.some((text) => text.replace(ACK, "").trim() !== "");
  const lastEarlier = replyShown ? -1 : replyStart - 1;
  return chunks
    .filter((text, i) => i >= replyStart || i === lastEarlier || KEPT_BEFORE_A_STEP.test(text))
    .join("\n")
    .trim();
}
