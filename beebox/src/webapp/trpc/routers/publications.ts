import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { pubIdSchema } from "../../../publish/manifest.js";
import { getOwnerEmail } from "../../auth.js";
import { defaultManagedPublicationRuntime } from "../../../services/managed-publication-runtime/core.js";
import {
  prepareManagedPublication,
} from "../../../publish/managed-publications/core.js";
import {
  approveManagedPublication,
  disableManagedPublication,
  enableManagedPublication,
  revokeManagedPublication,
} from "../../../publish/managed-publication-actions.js";
import { listManagedPublications, readManagedPublicationReleaseFile } from "../../../publish/managed-publication-queries.js";
import { configureManagedPublicationSharedHost } from "../../../publish/managed-publication-shared-host.js";
import { cardBrowseUrl } from "../../../shared/card-browse-url.js";
import { authenticatedOwnerProcedure, authedProcedure, router } from "../procedures.js";

const pubIdInput = pubIdSchema;

function publicationError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof Error) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw new TRPCError({ code: "BAD_REQUEST", message: "Publication operation failed." });
}

/** Box-authorized user and agent requests; credentials still require server grants. */
const publicationReadProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.actor !== "user" && ctx.actor !== "agent") {
    throw new TRPCError({ code: "FORBIDDEN", message: "A signed-in member or box agent session is required." });
  }
  return next();
});

/** Signed-in, box-authorized human only. Agent, device, and open contexts fail closed. */
const publicationHumanProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.actor !== "user" || ctx.user === null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "A signed-in member of this box must perform this action." });
  }
  return next();
});

export const publicationsRouter = router({
  /** Names only, scoped to this box; never expose global connection metadata to agents. */
  connections: publicationReadProcedure.query(async ({ ctx }) => {
    const runtime = ctx.services.managedPublicationRuntime ?? defaultManagedPublicationRuntime;
    const rows = await runtime.listConnections();
    return {
      connections: rows
        .filter((row) => row.tokenStatus === "active" && row.grants.some((grant) => grant.boxSlug === ctx.boxSlug))
        .map((row) => row.name)
        .toSorted(),
    };
  }),

  list: publicationReadProcedure.query(async ({ ctx }) => {
    try {
      return await listManagedPublications({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug }, ctx.services.managedPublicationRuntime);
    } catch (error) { publicationError(error); }
  }),

  prepare: publicationReadProcedure
    .input(z.object({ card: z.string().min(1).max(1024) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        const candidate = await prepareManagedPublication({
          boxRoot: ctx.boxRoot,
          boxSlug: ctx.boxSlug,
          card: input.card,
          ownerEmail: getOwnerEmail(),
        }, ctx.services.managedPublicationRuntime);
        return { ...candidate, approvalUrl: cardBrowseUrl({ boxSlug: ctx.boxSlug, cardPath: candidate.cardPath }) };
      } catch (error) { publicationError(error); }
    }),

  configureSharedHost: authenticatedOwnerProcedure
    .input(z.object({ connectionName: z.string().regex(/^[a-z][\da-z-]{0,39}$/), hostname: z.string().min(1).max(253) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await configureManagedPublicationSharedHost({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug, ...input }, ctx.services.managedPublicationRuntime);
      } catch (error) { publicationError(error); }
    }),

  approve: publicationHumanProcedure
    .input(z.object({ pubId: pubIdInput, expectedRevision: z.string().regex(/^[\da-f]{64}$/) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        await approveManagedPublication({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug, ...input }, ctx.services.managedPublicationRuntime);
        return { ok: true as const };
      } catch (error) { publicationError(error); }
    }),

  /** Agent-readable debugging view of the active release or pending candidate; no write power. */
  releaseFile: publicationReadProcedure
    .input(z.object({ pubId: pubIdInput, releaseId: z.string().regex(/^[\da-f]{64}$/), path: z.string().min(1).max(1024) }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await readManagedPublicationReleaseFile({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug, ...input }, ctx.services.managedPublicationRuntime);
      } catch (error) { publicationError(error); }
    }),

  enable: publicationHumanProcedure
    .input(z.object({ pubId: pubIdInput }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        await enableManagedPublication({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug, ...input }, ctx.services.managedPublicationRuntime);
        return { ok: true as const };
      } catch (error) { publicationError(error); }
    }),

  disable: publicationHumanProcedure
    .input(z.object({ pubId: pubIdInput }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        await disableManagedPublication({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug, ...input }, ctx.services.managedPublicationRuntime);
        return { ok: true as const };
      } catch (error) { publicationError(error); }
    }),

  revoke: publicationHumanProcedure
    .input(z.object({ pubId: pubIdInput }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        await revokeManagedPublication({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug, ...input }, ctx.services.managedPublicationRuntime);
        return { ok: true as const };
      } catch (error) { publicationError(error); }
    }),
});
