import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { pubIdSchema } from "../../../publish/manifest.js";
import { getOwnerEmail } from "../../auth.js";
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
import { authedProcedure, router } from "../trpc.js";

const pubIdInput = pubIdSchema;

function publicationError(error: unknown): never {
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
  list: publicationReadProcedure.query(async ({ ctx }) => {
    try {
      return { sites: await listManagedPublications({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug }, ctx.services.managedPublicationRuntime) };
    } catch (error) { publicationError(error); }
  }),

  prepare: publicationReadProcedure
    .input(z.object({ name: z.string().regex(/^[\da-z](?:[\da-z-]{0,61}[\da-z])?$/) }).strict())
    .mutation(async ({ ctx, input }) => {
      try {
        return await prepareManagedPublication({ boxRoot: ctx.boxRoot, boxSlug: ctx.boxSlug, name: input.name, ownerEmail: getOwnerEmail() }, ctx.services.managedPublicationRuntime);
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
