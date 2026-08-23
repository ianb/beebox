// The general browser's read side (`callback-box/docs/plans/general-browser.md`).
//
// Split out of api/router.ts to keep that file under the 300-line ceiling, and
// because these five procedures are one surface: an address space, its listing,
// and the two directions of the workstream lens.
//
// Refusals are TYPED rather than generic, so the browser can say which rule
// refused. A path that escapes the checkout is BAD_REQUEST; a path that simply
// is not there, or a worktree that does not exist, is NOT_FOUND. Collapsing
// those into one error would tell the reader "you did something wrong" when the
// file merely moved.

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  documentSchema,
  pathIndexSchema,
  recentFeedSchema,
  workstreamChangesSchema,
} from "../../shared/documents.js";
import { DocumentNotFoundError, InvalidDocumentPathError, UnknownWorkstreamError } from "../document-read.js";
import { procedure, router } from "./trpc.js";

/** Node's errno on a caught `unknown`, without an `as` cast at the boundary. */
function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : undefined;
}

/** A workstream name is one safe segment — never a path. */
const workstreamName = z.string().regex(/^[a-zA-Z0-9_-]+$/u);

export const documentsRouter = router({
  read: procedure
    .input(z.object({
      // `""` is the repository root, which reads as a directory listing.
      relPath: z.string().max(4096),
      workstream: workstreamName.nullable().default(null),
    }))
    .output(documentSchema)
    .query(async ({ input, ctx }) => {
      try {
        return await ctx.services.documents.readDocument(input);
      } catch (e) {
        if (e instanceof UnknownWorkstreamError || e instanceof DocumentNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: e.message });
        }
        if (e instanceof InvalidDocumentPathError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") {
          throw new TRPCError({ code: "NOT_FOUND", message: `no such path: ${input.relPath}` });
        }
        throw e;
      }
    }),
  /** Quick-open's corpus: every browsable path in one checkout. */
  paths: procedure
    .input(z.object({
      workstream: workstreamName.nullable().default(null),
    }))
    .output(pathIndexSchema)
    .query(async ({ input, ctx }) => {
      try {
        return await ctx.services.documents.pathIndex(input.workstream);
      } catch (e) {
        if (e instanceof UnknownWorkstreamError) {
          throw new TRPCError({ code: "NOT_FOUND", message: e.message });
        }
        throw e;
      }
    }),
  /** The front door: what changed recently, anywhere. */
  recent: procedure
    .output(recentFeedSchema)
    .query(async ({ ctx }) => ctx.services.documents.recentFiles()),
  /** One workstream's changed paths — the lens read the other way round. */
  changedFiles: procedure
    .input(z.object({ workstream: workstreamName }))
    .output(workstreamChangesSchema)
    .query(async ({ input, ctx }) => ctx.services.documents.changedFiles(input.workstream)),
});

