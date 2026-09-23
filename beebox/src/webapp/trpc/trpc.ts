import { withBoxWork } from "../../lib/box-maintenance.js";
import { BoxMaintenanceError } from "../../lib/box-maintenance-error.js";
import { initTRPC, TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context.js";
import { movedCardRecoveryFromCause } from "../../core/moved-card-recovery.js";

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
      data: {
        ...shape.data,
        recovery: movedCardRecoveryFromCause(error.cause),
      },
    };
  },
});

// WebSocket mutations arrive after the handshake and need their own root
// admission; HTTP mutations inherit the request lease through async context.
// Queries (including bootstrap and schema-cache reads) do not write box files.
const admission = t.middleware(async ({ ctx, type, path, next }) => {
  if (type !== "mutation") return next();
  try { return await withBoxWork({ boxRoot: ctx.boxRoot, reason: `trpc ${path}` }, () => next()); }
  catch (error) {
    if (error instanceof BoxMaintenanceError) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: error.message });
    throw error;
  }
});

export const router = t.router;
export const publicProcedure = t.procedure.use(admission);

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
}).use(admission);

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
}).use(admission);

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
}).use(admission);
