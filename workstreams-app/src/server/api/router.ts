import { workstreamListResultSchema } from "../../shared/workstreams.js";
import { procedure, router } from "./trpc.js";

const workstreamsRouter = router({
  list: procedure
    .output(workstreamListResultSchema)
    .query(async ({ ctx }) => ({ items: await ctx.services.workstreams.list() })),
});

export const appRouter = router({
  workstreams: workstreamsRouter,
});

export type AppRouter = typeof appRouter;
