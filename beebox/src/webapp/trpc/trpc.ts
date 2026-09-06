import { initTRPC, TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context.js";

// Client responses never need server frames or raw internal error messages,
// either of which can contain absolute filesystem paths. Keep diagnosis in the
// adapter's server-side onError log rather than letting tRPC derive response
// disclosure from ambient NODE_ENV.
const t = initTRPC.context<TrpcContext>().create({
  isDev: false,
  errorFormatter({ error, shape }) {
    return {
      ...shape,
      message: error.code === "INTERNAL_SERVER_ERROR" ? "Internal server error" : shape.message,
    };
  },
});

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
 * (`ctx.isOwner` = open mode (`identity.source === "open"`) OR the caller is the
 * owner), so an open (opt-out) box passes and every other caller must be the
 * owner.
 */
export const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Owner access required" });
  }
  return next();
});

/**
 * Requires a REAL authenticated owner — the strict variant of
 * {@link ownerProcedure}, which also passes an open-access box (where nobody
 * proved anything). Used by the secrets router alone: those procedures read and
 * mutate the MACHINE-level store, which spans every box on the host, so one
 * box's opt-out from the auth wall must never become a management surface for
 * its neighbours' credentials (`docs/implemented-plans/secret-custody.md`).
 */
export const authenticatedOwnerProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticatedOwner) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "secrets management requires an authenticated owner session — open-access does not qualify (the store is machine-level, spanning every box on this host)",
    });
  }
  return next();
});
