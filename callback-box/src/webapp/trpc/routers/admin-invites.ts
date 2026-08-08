/** Owner-only invite minting procedures, split from the main Admin router. */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AuthCapabilityCapacityError,
  AuthCapabilityStoreError,
  mintAuthInvite,
} from "../../auth-capabilities.js";
import { canonicalizeEmail, getLocalOwnerEmail, getLocalUser } from "../../local-users.js";
import { ownerProcedure } from "../trpc.js";

export const inviteAdminProcedures = {
  createInvite: ownerProcedure
    .input(z.object({ email: z.string().max(254).optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "A signed-in owner is required." });
      }
      const currentEmail = canonicalizeEmail(ctx.user.email);
      const localOwner = getLocalOwnerEmail();
      if (!localOwner || canonicalizeEmail(localOwner) !== currentEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Local password accounts aren't initialized for this owner. Create the owner account on the server before issuing invite links.",
        });
      }
      const email = input.email === undefined ? undefined : canonicalizeEmail(input.email);
      if (email !== undefined) {
        if (!email.includes("@")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email address." });
        }
        if (email === currentEmail || getLocalUser(email)) {
          throw new TRPCError({ code: "CONFLICT", message: "That email cannot be invited." });
        }
      }
      let invite;
      try {
        invite = await mintAuthInvite({
          boxRoot: ctx.boxRoot,
          createdBy: currentEmail,
          ...(email === undefined ? {} : { email }),
        });
      } catch (error) {
        if (error instanceof AuthCapabilityCapacityError) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many live invites; wait for one to expire." });
        }
        if (error instanceof AuthCapabilityStoreError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The invite store is unavailable." });
        }
        throw error;
      }
      return {
        invitePath: `/auth/invite?token=${encodeURIComponent(invite.token)}`,
        expiresAt: invite.expiresAt,
      };
    }),
};
