import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DuplicateScanTokenNameError,
  SCAN_TOKEN_NAME_PATTERN,
  createScanToken,
  listScanTokens,
  revokeScanToken,
} from "../../../core/scan/tokens.js";
import { router, ownerProcedure } from "../trpc.js";

/**
 * Minting and revoking the box's scan upload credentials. Owner-only, like the
 * mobile pairing procedures beside it — a scan token is a credential, and
 * `create` is the ONLY place its plaintext ever exists (the store keeps a hash),
 * so the response is shown once and cannot be re-read.
 */
export const scanTokensRouter = router({
  create: ownerProcedure
    .input(z.object({ name: z.string().regex(SCAN_TOKEN_NAME_PATTERN) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createScanToken(ctx.boxRoot, { name: input.name, createdBy: ctx.user?.email ?? null });
      } catch (e) {
        if (e instanceof DuplicateScanTokenNameError) {
          throw new TRPCError({ code: "CONFLICT", message: e.message, cause: e });
        }
        throw e;
      }
    }),

  list: ownerProcedure.query(({ ctx }) => {
    return listScanTokens(ctx.boxRoot);
  }),

  revoke: ownerProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ok = await revokeScanToken(ctx.boxRoot, input.name);
      if (!ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No active scan token with that name" });
      }
      return { ok: true };
    }),
});
