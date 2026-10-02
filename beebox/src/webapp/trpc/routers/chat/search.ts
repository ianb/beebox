/**
 * `chat.search` — full-text search over the box's chat transcripts
 * (`core/chat-search/`). Text-only by design: no embeddings key is
 * consulted and no transcript text leaves the box.
 */

import { z } from "zod";
import { publicProcedure } from "../../procedures.js";
import { searchChats } from "../../../../core/chat-search/query.js";

export const chatSearchProcedures = {
  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().positive().max(50).default(10),
      })
    )
    .query(({ ctx, input }) =>
      searchChats(ctx.boxRoot, {
        query: input.query,
        limit: input.limit,
        // A panel search should never make the user wait on lock retry
        // backoff — serve the persisted index, marked stale, like the card
        // search endpoint (`routers/search.ts`).
        lockRetries: 3,
        lockRetryMs: 100,
      })
    ),
};
