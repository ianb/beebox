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
import {
  MAX_AUDIO_BYTES,
  TranscriptionNotConfiguredError,
  TranscriptionRefusedError,
  TranscriptionShapeError,
  transcribeInputSchema,
} from "../transcribe-contract.js";
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
    .input(z.object({
      relPath: z.string().min(1).max(4096),
      /** The lens being read, so an untracked file resolves in ITS namespace. */
      worktree: workstreamName.nullable().default(null),
    }))
    .output(z.object({ comments: z.array(commentSchema) }))
    .query(async ({ input, ctx }) =>
      passingCliErrors(async () => ({ comments: await ctx.services.comments.forDocument(input) })),
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
      /**
       * Which checkout's namespace an UNTRACKED file belongs to — a different
       * question from `workstream`, which is who the remark is FOR. The app
       * runs from main while the developer reads a branch's file.
       */
      worktree: workstreamName.nullable().default(null),
      quoted: z.string().max(10_000).optional(),
      section: z.string().max(500).optional(),
      fragment: z.string().max(4096).optional(),
    }))
    .output(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => passingCliErrors(() => ctx.services.comments.add(input))),

  /**
   * Audio in, text out — nothing stored, nothing retained.
   *
   * The client puts the result in the composer and submits it through `add`,
   * so the transcript is reviewable before anything is written and the
   * recording only has to survive until this returns. `origin: voice` then
   * records how the text ARRIVED, not that it is verbatim: the boxholder may
   * have corrected it, which is the point.
   */
  transcribe: procedure
    .input(transcribeInputSchema)
    .output(z.object({ text: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const audio = Buffer.from(input.audio, "base64");
      // Capped in BYTES, not seconds: a duration cap is not a byte guarantee,
      // and the app inherits Fastify's 1 MiB body limit. The client caps first
      // so a recording is refused before it is made, not after.
      if (audio.byteLength > MAX_AUDIO_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `That recording is ${String(Math.round(audio.byteLength / 1000))} kB; the limit is ${String(Math.round(MAX_AUDIO_BYTES / 1000))} kB.`,
        });
      }
      try {
        return await ctx.services.transcribe.transcribe({ audio, mimeType: input.mimeType });
      } catch (e) {
        // Every one of these leaves the recording in the page, so the message
        // has to say what to do next rather than just what went wrong.
        if (e instanceof TranscriptionNotConfiguredError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        }
        if (e instanceof TranscriptionRefusedError || e instanceof TranscriptionShapeError) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
        }
        throw e;
      }
    }),

  /** How a comment stops waiting. Nothing expires on its own. */
  clear: procedure
    .input(z.object({
      relPath: z.string().min(1).max(4096),
      worktree: workstreamName.nullable().default(null),
      id: z.string().max(200).optional(),
    }))
    .output(z.object({ cleared: z.literal(true) }))
    .mutation(async ({ input, ctx }) =>
      passingCliErrors(async () => {
        await ctx.services.comments.clear(input);
        return { cleared: true as const };
      }),
    ),
});
