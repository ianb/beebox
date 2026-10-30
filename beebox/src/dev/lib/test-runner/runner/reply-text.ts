/**
 * The text a chat turn shows once the chat folds lines written between steps,
 * for audits with `final_reply`. Mirrors `groupIntoParts`
 * (`src/frontend/src/components/chat/assistant-parts.ts`): text after the last
 * tool call is the reply; progress updates and earlier text fold, except that
 * earlier text with `<speech>` stays and a folded text's callouts stay; when
 * the reply has nothing but acks, the last foldable line stays.
 */

/** One text block or progress update of a turn, in order. */
export interface ReplyBlock { text: string; update: boolean }

const ACK = /<ack\b[^>]*?(?:\/\s*>|>[\S\s]*?<\/ack\s*>)|<no-response\b[^>]*>(?:<\/no-response\s*>)?/giu;
const SPEECH = /<speech[\s>]/iu;
const CALLOUT = /<callout\b[^>]*>[\S\s]*?<\/callout\s*>/giu;

/** `blocks` before `replyStart` came before the last tool call. */
export function visibleReplyText(blocks: ReplyBlock[], replyStart: number): string {
  const replyShown = blocks.some((b, i) => i >= replyStart && !b.update && b.text.replace(ACK, "").trim() !== "");
  const foldable = (b: ReplyBlock, i: number): boolean => b.update || (i < replyStart && !SPEECH.test(b.text));
  const kept = replyShown ? -1 : blocks.findLastIndex(foldable);
  return blocks
    .map((b, i) => (i === kept || !foldable(b, i) ? b.text : b.update ? "" : (b.text.match(CALLOUT) ?? []).join("\n")))
    .filter((text) => text.trim() !== "")
    .join("\n")
    .trim();
}
