import { initTRPC, TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context.js";

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Requires a box-authorized request: a valid session (or auth disabled).
 * `ctx.authed` already folds in the auth-disabled dev case, so this mirrors
 * the box auth preHandler.
 */
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.authed) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next();
});

/**
 * Requires the box owner. Mirrors the raw `addOwnerCheck` gate exactly
 * (`ctx.isOwner` = `!isAuthEnabled() || isOwner(request)`), so auth-disabled
 * dev passes and every other caller must be the owner.
 */
export const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Owner access required" });
  }
  return next();
});
