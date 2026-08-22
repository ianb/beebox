// The comment channel's procedures (`docs/plans/document-comments.md`).
//
// Everything mutating goes through tRPC — a CONSTRAINT, not a preference.
// `bin/router-auth.ts:228-239` classifies a POST under `/workstreams/` as
// `control` only for `/workstreams/api/trpc[/*]`; anything else returns
// `{kind: "unknown"}` and is denied before it reaches this app. A raw
// `POST /workstreams/api/comments` would never arrive.

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { commentOriginSchema, commentSchema } from "../../shared/comments.js";
import { CommentsCliError } from "../comments-service.js";
import { procedure, router } from "./trpc.js";

const workstreamName = z.string().regex(/^[a-zA-Z0-9_-]+$/u);

/**
 * The CLI's refusals are already phrased for a human; surface them as
 * BAD_REQUEST rather than letting a 500 hide what it said.
 */
async function passingCliErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof CommentsCliError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    }
    throw e;
  }
}

export const commentsRouter = router({
  /** Every comment on one document — what the viewer shows beside the text. */
  forDocument: procedure
    .input(z.object({ relPath: z.string().min(1).max(4096) }))
    .output(z.object({ comments: z.array(commentSchema) }))
    .query(async ({ input, ctx }) =>
      passingCliErrors(async () => ({
        comments: await ctx.services.comments.forDocument(input.relPath),
      })),
    ),

  /** Everything waiting, optionally narrowed to one workstream's mail. */
  waiting: procedure
    .input(z.object({ workstream: workstreamName.nullable().default(null) }))
    .output(z.object({
      documents: z.array(z.object({ relPath: z.string(), comments: z.array(commentSchema) })),
    }))
    .query(async ({ input, ctx }) =>
      passingCliErrors(async () => ({
        documents: await ctx.services.comments.waiting(input.workstream),
      })),
    ),

  add: procedure
    .input(z.object({
      relPath: z.string().min(1).max(4096),
      body: z.string().min(1).max(10_000),
      origin: commentOriginSchema.default("typed"),
      // Null is a real state, not a missing value: commenting on a file nobody
      // is working on is how new work starts.
      workstream: workstreamName.nullable().default(null),
      quoted: z.string().max(10_000).optional(),
      section: z.string().max(500).optional(),
      fragment: z.string().max(4096).optional(),
    }))
    .output(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => passingCliErrors(() => ctx.services.comments.add(input))),

  /** How a comment stops waiting. Nothing expires on its own. */
  clear: procedure
    .input(z.object({ relPath: z.string().min(1).max(4096), id: z.string().max(200).optional() }))
    .output(z.object({ cleared: z.literal(true) }))
    .mutation(async ({ input, ctx }) =>
      passingCliErrors(async () => {
        await ctx.services.comments.clear(input);
        return { cleared: true as const };
      }),
    ),
});
