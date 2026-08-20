import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  dashboardSchema,
  workstreamDetailSchema,
  workstreamListResultSchema,
} from "../../shared/workstreams.js";
import {
  issueChangeSchema,
  issueRelPathSchema,
  issueSchema,
  issueVisibilitySchema,
  planSchema,
  quotaSchema,
  testingQueueSchema,
} from "../../shared/documents.js";
import { askQueueSchema } from "../../shared/exhibits.js";
import {
  actionResultSchema,
  actionVerbSchema,
  lifecycleJobSchema,
} from "../../shared/actions.js";
import { procedure, router } from "./trpc.js";

const workstreamsRouter = router({
  list: procedure
    .output(workstreamListResultSchema)
    .query(async ({ ctx }) => ctx.services.workstreams.list()),
  detail: procedure
    .input(z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]+$/u) }))
    .output(workstreamDetailSchema)
    .query(async ({ input, ctx }) => {
      const workstreams = await ctx.services.workstreams.list();
      const workstream = workstreams.items.find((candidate) => candidate.name === input.name);
      if (!workstream) throw new TRPCError({ code: "NOT_FOUND", message: "Workstream not found" });
      return {
        workstream,
        issues: await ctx.services.documents.issuesForWorkstream(input.name),
      };
    }),
});

const issuesRouter = router({
  list: procedure.output(z.object({ items: z.array(issueSchema) })).query(async ({ ctx }) => ({
    items: await ctx.services.documents.listIssues(),
  })),
  detail: procedure.input(z.object({
    relPath: issueRelPathSchema,
    visibility: issueVisibilitySchema,
  })).output(issueSchema).query(async ({ input, ctx }) =>
    ctx.services.documents.issueDetail(input.relPath, input.visibility)),
  save: procedure.input(z.object({ changes: z.array(issueChangeSchema).max(1_000) }))
    .output(z.object({ saved: z.number().int().nonnegative() }))
    .mutation(async ({ input, ctx }) => ({
      saved: await ctx.services.documents.saveIssueChanges(input.changes),
    })),
});

const plansRouter = router({
  list: procedure.output(z.object({ items: z.array(planSchema) })).query(async ({ ctx }) => ({
    items: await ctx.services.documents.listPlans(),
  })),
});

const testingRouter = router({
  list: procedure.output(testingQueueSchema).query(async ({ ctx }) =>
    ctx.services.documents.testingQueue()),
});

/** Read-only: answering an ask happens on the exhibits origin, never here. */
const exhibitsRouter = router({
  askQueue: procedure.output(askQueueSchema).query(async ({ ctx }) => ctx.services.exhibits.askQueue()),
});

const quotasRouter = router({
  get: procedure.output(z.object({ items: z.array(quotaSchema) })).query(async ({ ctx }) => ({
    items: await ctx.services.quotas.get(),
  })),
});

const actionTargetSchema = z.object({
  verb: actionVerbSchema,
  name: z.string().min(1),
}).superRefine((value, context) => {
  const pattern = value.verb === "confirm-tested"
    ? /^[a-zA-Z0-9_-]+\.md$/u
    : /^[a-zA-Z0-9_-]+$/u;
  if (!pattern.test(value.name)) context.addIssue({ code: "custom", message: "Invalid action target" });
});

const actionsRouter = router({
  run: procedure.input(actionTargetSchema).output(actionResultSchema)
    .mutation(async ({ input, ctx }) => ctx.services.actions.run(input.verb, input.name)),
  job: procedure.input(z.object({ id: z.string().uuid() }))
    .output(lifecycleJobSchema.nullable())
    .query(({ input, ctx }) => ctx.services.actions.job(input.id)),
});

const dashboardRouter = router({
  get: procedure.output(dashboardSchema).query(async ({ ctx }) => {
    const [workstreamResult, issues, plans, quotas, testing] = await Promise.all([
      ctx.services.workstreams.list(),
      ctx.services.documents.listIssues(),
      ctx.services.documents.listPlans(),
      ctx.services.quotas.get(),
      ctx.services.documents.testingQueue(),
    ]);
    return { workstreams: workstreamResult.items, workstreamWarnings: workstreamResult.warnings, issues, plans, quotas, testing };
  }),
});

export const appRouter = router({
  dashboard: dashboardRouter,
  workstreams: workstreamsRouter,
  issues: issuesRouter,
  plans: plansRouter,
  testing: testingRouter,
  quotas: quotasRouter,
  exhibits: exhibitsRouter,
  actions: actionsRouter,
});

export type AppRouter = typeof appRouter;
