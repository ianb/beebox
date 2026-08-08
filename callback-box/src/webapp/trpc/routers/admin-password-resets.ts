/** Owner-only member password-reset capability minting. */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AuthCapabilityCapacityError,
  AuthCapabilityStoreError,
  mintAuthPasswordReset,
} from "../../auth-capabilities.js";
import { normalizeAllowedEmails } from "../../box-config-write.js";
import { loadBoxConfig } from "../../../core/box/config.js";
import { canonicalizeEmail, getLocalOwnerEmail, getLocalUser } from "../../local-users.js";
import { ownerProcedure } from "../trpc.js";

export const passwordResetAdminProcedures = {
  createPasswordReset: ownerProcedure
    .input(z.object({ email: z.string().min(1).max(254) }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "A signed-in owner is required." });
      }
      const currentEmail = canonicalizeEmail(ctx.user.email);
      const localOwner = getLocalOwnerEmail();
      if (!localOwner || canonicalizeEmail(localOwner) !== currentEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Initialize the matching local owner account before creating password resets.",
        });
      }
      const email = canonicalizeEmail(input.email);
      const user = getLocalUser(email);
      const config = await loadBoxConfig(ctx.boxRoot);
      const allowedEmails = normalizeAllowedEmails(config.allowedEmails ?? []);
      if (user?.role !== "member" || !allowedEmails.includes(email)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That member cannot be reset from this box." });
      }

      try {
        const reset = await mintAuthPasswordReset({ boxRoot: ctx.boxRoot, createdBy: currentEmail, email });
        return {
          resetPath: `/auth/reset-password?token=${encodeURIComponent(reset.token)}`,
          expiresAt: reset.expiresAt,
        };
      } catch (error) {
        if (error instanceof AuthCapabilityCapacityError) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many live links; wait for one to expire." });
        }
        if (error instanceof AuthCapabilityStoreError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The password reset store is unavailable." });
        }
        throw error;
      }
    }),
};
