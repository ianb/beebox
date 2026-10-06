/**
 * The chat-transcript search index's schema and document shape.
 *
 * A separate index from the card index by design: transcript chunks would
 * multiply the card index's vector-bearing restore cost (paid on every card
 * search — see `search/store/core.ts`'s format notes) and every card query
 * would stat every transcript. This index holds dialogue text only; there
 * are no embeddings here (boxholder decision 2026-09-28 — transcripts never
 * leave the box).
 *
 * Doc ids key on the SESSION id, not the husk path: the session id is the
 * husk's identity key and survives renames (`schemas/chat.ts`), so a
 * boxholder `bbx mv` never orphans indexed chunks.
 */

/** Bump when the chunk schema or extraction shape changes; mismatch rebuilds. */
export const CHAT_SEARCH_SCHEMA_VERSION = 1;

export const chatOramaSchema = {
  /** Engine session id — joins the doc back to the husk and the transcript. */
  sessionId: "string",
  /**
   * The `uuid` of the chunk's first entry — the deep-link anchor a result
   * opens the chat at (`/chat?session=<id>&m=<uuid>`).
   */
  anchor: "string",
  /** The chat's title as of indexing (husk title, else ""). Display joins live labels. */
  title: "string",
  /** The chunk's dialogue text. */
  content: "string",
  /** ISO timestamp of the anchor entry — recency signal and row display. */
  created: "string",
} as const;

/** One chunk document. `id` is `<sessionId>#<anchor>` — unique within the index. */
export interface ChatChunkDoc {
  id: string;
  sessionId: string;
  anchor: string;
  title: string;
  content: string;
  created: string;
}
