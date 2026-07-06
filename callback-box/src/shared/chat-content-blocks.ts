/**
 * Shared `[imageN]` token-parsing algorithm for chat message content blocks.
 * Pure TypeScript — no React, no Node-only APIs (fs, child_process), no DOM
 * types (see src/shared/CLAUDE.md convention, established for
 * markdoc-config.ts).
 *
 * Two callers build near-identical block sequences from a text + image-
 * attachment pair, but each needs its own block shape:
 * - Backend (`chat-session-messages.ts` `buildContentBlocks`) produces the
 *   SDK-shaped `ChatMessageContent` stored in the session log and streamed
 *   to the frontend.
 * - Frontend (`chat-shared.ts` `buildOptimisticContent`) produces the flatter
 *   `SessionContentBlock` shape for the optimistic message bubble shown
 *   before the server responds.
 *
 * This module holds the one shared parsing algorithm, parameterized by
 * block-shape constructors, so the two can't silently drift apart the way
 * they had (see `ensureTrailingTextBlock` below).
 */

/** The minimal image-attachment shape both callers key `[imageN]` tokens against. */
export interface ChatBlockImage {
  id: number;
  mimeType: string;
  dataBase64: string;
}

export interface BuildChatContentBlocksOptions<TBlock extends { type: string }> {
  text: string;
  images: ChatBlockImage[];
  makeTextBlock: (text: string) => TBlock;
  makeImageBlock: (image: ChatBlockImage) => TBlock;
  /**
   * If the parsed result would contain no text block at all (message was
   * only images, none referenced by a `[imageN]` token), prepend an empty
   * text block so downstream filters can still tell this was a user turn.
   *
   * The backend's stored session blocks need this (a real behavioral
   * requirement of the session log, not cosmetic — see `chat-session-
   * messages.ts`). The frontend's optimistic bubble is discarded once the
   * real server entry arrives and nothing reads an "is this a user turn"
   * marker off it in the meantime, so it passes `false`. Before this was
   * unified, the frontend copy silently omitted this step entirely — a
   * latent divergence from the "mirrors the server" comment, though inert
   * in practice since messages are always wrapped in `<typed>`/`<speech>`
   * tags before reaching either copy.
   */
  ensureTrailingTextBlock: boolean;
}

/**
 * Replace `[imageN]` tokens in `text` with the corresponding image block.
 * Attachments whose token is absent from the text are appended at the end.
 * Unknown tokens (id not in `images`) are left as literal text.
 */
export function buildChatContentBlocks<TBlock extends { type: string }>(
  options: BuildChatContentBlocksOptions<TBlock>,
): TBlock[] {
  const { text, images, makeTextBlock, makeImageBlock, ensureTrailingTextBlock } = options;
  if (images.length === 0) {
    return [makeTextBlock(text)];
  }

  const byId = new Map<number, ChatBlockImage>();
  for (const img of images) byId.set(img.id, img);
  const used = new Set<number>();

  const blocks: TBlock[] = [];
  const tokenRe = /\[image(\d+)]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    const idStr = match[1];
    if (idStr === undefined) continue;
    const id = parseInt(idStr, 10);
    const img = byId.get(id);
    if (img === undefined) continue; // leave orphan token as literal text in the next chunk
    if (match.index > cursor) {
      blocks.push(makeTextBlock(text.slice(cursor, match.index)));
    }
    blocks.push(makeImageBlock(img));
    used.add(id);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    blocks.push(makeTextBlock(text.slice(cursor)));
  }

  // Append any unreferenced images at the end
  for (const img of images) {
    if (used.has(img.id)) continue;
    blocks.push(makeImageBlock(img));
  }

  if (ensureTrailingTextBlock && blocks.every((b) => b.type !== "text")) {
    blocks.unshift(makeTextBlock(""));
  }

  return blocks;
}
