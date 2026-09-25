/**
 * The two Gmail verbs that need the credential, over tRPC.
 *
 * `bbx connector gmail track` and `bbx connector gmail gws` built a Gmail
 * client in their own process, which a box agent's shell is deliberately not
 * allowed to do. Both now have a server counterpart running the same
 * connector-level function, so the CLI verb works from an agent's shell with
 * the credential never leaving this process
 * (`docs/plans/agent-capability-delegation.md`).
 *
 * `pending` has no procedure here on purpose: it reads the box's own transient
 * state and needs nothing from Google, so it stays in-process in every profile.
 */

import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { googleService } from "../google-service.js";
import { resolveGmailService, resolveGoogleAuth } from "../../../connectors/google-access.js";
import { trackGmailThread } from "../../../connectors/gmail-track.js";
import { runReadOnlyGws, UnsafeGwsCommandError } from "../../../connectors/gmail-gws.js";
import { TRPCError } from "@trpc/server";

/**
 * Enough output to work with, without making the response a log shipper. The
 * head, not the tail: a gws read prints its answer first and gws's own errors
 * are short.
 */
const MAX_OUTPUT_CHARS = 8000;

function capped(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n…(${String(output.length - MAX_OUTPUT_CHARS)} further characters omitted)`;
}

export const gmailRouter = router({
  /**
   * Materialize one Gmail thread as a synchronized card and commit it.
   *
   * A mutation: it writes cards. `trackedBy` records that a delegated call did
   * it, which is the same string the in-process verb stamps.
   */
  track: publicProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const service = await googleService({
        injected: ctx.services.gmail,
        resolve: () => resolveGmailService(ctx.boxRoot),
      });
      return trackGmailThread({
        boxRoot: ctx.boxRoot,
        service,
        threadId: input.threadId,
        trackedBy: "explicit-command",
      });
    }),

  /**
   * Run one read-only Google Workspace CLI command and hand back what it said.
   *
   * A mutation despite being read-only upstream: it spawns a child process with
   * a minted access token, which is not something a cached GET should do. The
   * read-only vocabulary check is `assertReadOnlyGwsArgs`, inside the runner —
   * re-checking it here would be a second place for that rule to drift from.
   */
  gws: publicProcedure
    .input(z.object({ args: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const auth = await googleService({
        injected: ctx.services.googleAuth,
        resolve: () => resolveGoogleAuth(ctx.boxRoot, "gmail"),
      });
      const run = ctx.services.gwsRunner ?? runReadOnlyGws;
      let result;
      try {
        result = await run({ args: input.args, auth });
      } catch (error) {
        // A command outside the read-only vocabulary is the caller's to fix,
        // and nothing ran — anything else (a missing runner, a dead child) is
        // ours and stays a 500.
        if (error instanceof UnsafeGwsCommandError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }
      return {
        exitCode: result.exitCode,
        stdout: capped(result.stdout),
        stderr: capped(result.stderr),
      };
    }),
});
