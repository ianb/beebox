import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { pubIdSchema } from "../../../publish/manifest.js";
import { getOwnerEmail } from "../../auth.js";
import { defaultManagedPublicationRuntime } from "../../../services/managed-publication-runtime.js";
import {
  prepareManagedPublication,
} from "../../../publish/managed-publications.js";
import {
  approveManagedPublication,
  disableManagedPublication,
  enableManagedPublication,
  revokeManagedPublication,
} from "../../../publish/managed-publication-actions.js";
import { listManagedPublications, previewManagedPublicationFile } from "../../../publish/managed-publication-queries.js";
import { configureManagedPublicationSharedHost } from "../../../publish/managed-publication-shared-host.js";
import { ensurePublicationReferenceCard } from "../../../publish/publication-reference-card.js";
import { publicationCardUrl } from "../../../shared/publication-card.js";
import { stageAndCommitPaths } from "../../../lib/git/core.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { authenticatedOwnerProcedure, authedProcedure, router } from "../trpc.js";

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
    .input(z.object({ name: z.string().regex(/^[\da-z](?:[\da-z-]{0,61}[\da-z])?$/) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        let reference: { cardPath: string; created: boolean } | undefined;
        const candidate = await prepareManagedPublication({
          boxRoot: ctx.boxRoot,
          boxSlug: ctx.boxSlug,
          name: input.name,
          ownerEmail: getOwnerEmail(),
          ensureReferenceCard: async (identity) => {
            reference = await ensurePublicationReferenceCard(identity);
            return reference;
          },
        }, ctx.services.managedPublicationRuntime);
        if (reference === undefined) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Publication reference card was not prepared." });
        const commitWarning = reference.created ? await commitReferenceCard(ctx.boxRoot, reference.cardPath) : null;
        if (reference.created) ctx.eventBus.emitTransient("file-change", { event: "add", path: reference.cardPath, timestamp: getBoxTimeISO(ctx.boxRoot) });
        return {
          ...candidate,
          cardPath: reference.cardPath,
          approvalUrl: publicationCardUrl(ctx.boxSlug, reference.cardPath),
          commitWarning,
        };
      } catch (error) { publicationError(error); }
    }),

  /** Explicitly create/open the reference card for an existing server binding. */
  ensureCard: publicationHumanProcedure
    .input(z.object({ pubId: pubIdInput }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        const { sites } = await listManagedPublications({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug }, ctx.services.managedPublicationRuntime);
        const site = sites.find((candidate) => candidate.pubId === input.pubId);
        if (site === undefined) throw new TRPCError({ code: "NOT_FOUND", message: "This publication is not registered to this box." });
        const reference = await ensurePublicationReferenceCard({ boxRoot: ctx.boxRoot, pubId: input.pubId, title: site.title });
        const commitWarning = reference.created ? await commitReferenceCard(ctx.boxRoot, reference.cardPath) : null;
        if (reference.created) ctx.eventBus.emitTransient("file-change", { event: "add", path: reference.cardPath, timestamp: getBoxTimeISO(ctx.boxRoot) });
        return {
          cardPath: reference.cardPath,
          approvalUrl: publicationCardUrl(ctx.boxSlug, reference.cardPath),
          created: reference.created,
          commitWarning,
        };
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

  previewFile: publicationHumanProcedure
    .input(z.object({ pubId: pubIdInput, expectedRevision: z.string().regex(/^[\da-f]{64}$/), path: z.string().min(1).max(1024) }).strict())
    .query(async ({ ctx, input }) => {
      try {
        return await previewManagedPublicationFile({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug, ...input }, ctx.services.managedPublicationRuntime);
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

async function commitReferenceCard(boxRoot: string, cardPath: string): Promise<string | null> {
  try {
    await stageAndCommitPaths(boxRoot, {
      paths: [cardPath],
      message: `Create publication card: ${cardPath}`,
      trailers: { "Created-By": "publication-prepare" },
    });
    return null;
  } catch (error) {
    return `Publication card was created but could not be committed: ${errorMessage(error)}`;
  }
}
