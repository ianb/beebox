import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { searchBox } from "../../../core/search/query.js";

const prefix = z.string().min(1).max(500).refine((value) => !value.startsWith("/"), "path prefixes must be box-relative");

export const searchRouter = router({
  query: publicProcedure.input(z.object({
    query: z.string().max(500),
    kinds: z.array(z.string().min(1).max(100)).max(32).optional(),
    pathPrefixes: z.array(prefix).max(32).optional(),
    limit: z.number().int().positive().max(100).default(10),
    mode: z.enum(["text", "hybrid"]).default("text"),
  })).query(({ ctx, input }) => searchBox(ctx.boxRoot, {
    query: input.query,
    limit: input.limit,
    mode: input.mode,
    lockRetries: 3,
    lockRetryMs: 100,
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    ...(input.pathPrefixes === undefined ? {} : { pathPrefixes: input.pathPrefixes }),
  })),
});
