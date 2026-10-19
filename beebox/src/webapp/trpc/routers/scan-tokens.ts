import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DuplicateScanTokenNameError,
  SCAN_TOKEN_NAME_PATTERN,
  createScanToken,
  listScanTokens,
  revokeScanToken,
  type ScanTokenSummary,
} from "../../../core/scan/tokens.js";
import { mayManageMobileDevice, type DeviceViewer } from "../../../core/mobile/pairing.js";
import { router, authedProcedure } from "../procedures.js";
import type { TrpcContext } from "../context.js";

function viewer(ctx: TrpcContext): DeviceViewer {
  return { isOwner: ctx.isOwner, email: ctx.user?.email ?? null };
}

/** The same rule as paired devices: you manage the uploaders you set up, and
 *  the owner manages every uploader on the box. */
function mayManage(token: Pick<ScanTokenSummary, "createdBy">, who: DeviceViewer): boolean {
  return mayManageMobileDevice(token, who);
}

/**
 * Minting and revoking the box's scan upload credentials. Anyone with access to
 * the box can already add files to it through the web app, so a scan token adds
 * no permission: any signed-in person may mint one, as with pairing a phone
 * beside it. `create` is the ONLY place its plaintext ever exists (the store
 * keeps a hash), so the response is shown once and cannot be re-read.
 */
export const scanTokensRouter = router({
  create: authedProcedure
    .input(z.object({ name: z.string().regex(SCAN_TOKEN_NAME_PATTERN) }))
    .mutation(async ({ ctx, input }) => {
      const createdBy = ctx.user?.email ?? null;
      // A token recorded against nobody is owner-only forever, so its creator
      // could never revoke it. Refuse a caller with no person behind it; the
      // owner is exempt (and covers an open-access box, with no identity).
      if (createdBy === null && !ctx.isOwner) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A scan uploader records who set it up, so it needs a signed-in person.",
        });
      }
      try {
        return await createScanToken(ctx.boxRoot, { name: input.name, createdBy });
      } catch (e) {
        if (e instanceof DuplicateScanTokenNameError) {
          throw new TRPCError({ code: "CONFLICT", message: e.message, cause: e });
        }
        throw e;
      }
    }),

  list: authedProcedure.query(({ ctx }) => {
    const who = viewer(ctx);
    return listScanTokens(ctx.boxRoot).filter((token) => mayManage(token, who));
  }),

  revoke: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // NOT_FOUND, not FORBIDDEN, for somebody else's token: a distinct refusal
      // would confirm the name exists on this box.
      const token = listScanTokens(ctx.boxRoot).find((item) => item.name === input.name && !item.revoked);
      if (!token || !mayManage(token, viewer(ctx)) || !(await revokeScanToken(ctx.boxRoot, input.name))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No active scan token with that name" });
      }
      return { ok: true };
    }),
});
