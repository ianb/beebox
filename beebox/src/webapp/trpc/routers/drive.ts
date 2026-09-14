/**
 * Drive mounts over tRPC: what the box mirrors, and the four writes that
 * change it.
 *
 * The procedures are thin — every one of them delegates to the same
 * `connectors/drive-mounts.ts` operations `bbx drive mount` / `link` /
 * `unmount` call, so the settings page and the agent cannot drift apart. What
 * lives here is one piece of boundary work: a refusal (`DriveMountError` — a
 * bad URL, an occupied directory, a path that climbs out of the box) rendered
 * as BAD_REQUEST while a Drive outage or a disk error stays a 500. Path
 * containment is NOT re-checked here: the mount operations resolve every target
 * through `connectors/drive-mount-path.ts` themselves, so a second check here
 * would be a second place for the rule to drift from.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { driveServiceAvailable, resolveDriveService } from "../../../connectors/google-access.js";
import { googleService } from "../google-service.js";
import type { GoogleDriveService } from "../../../services/google-drive.js";
import { addDriveFile } from "../../../connectors/drive-add-file.js";
import { inspectDriveItem } from "../../../connectors/drive-inspect.js";
import { loadDriveConfig } from "../../../connectors/drive-config.js";
import { listFolderMounts } from "../../../connectors/drive-mount-list.js";
import { DriveMountError } from "../../../connectors/drive-mount-errors.js";
import { syncFolderMount } from "../../../connectors/drive-mount-sync.js";
import {
  linkDriveItem,
  mountDriveFolder,
  requireDriveId,
  unmountDriveFolder,
} from "../../../connectors/drive-mounts.js";

/** A tRPC context's box root and injected services — all these procedures need. */
interface DriveCtx {
  boxRoot: string;
  services: { drive?: GoogleDriveService | undefined };
}

/**
 * The Drive service, or the reason there isn't one. A box that has not
 * connected Google, or has Drive switched off, gets a message it can act on
 * rather than a stack trace from the first API call — in the same two codes
 * every Google family refuses with (`trpc/google-service.ts`).
 */
async function driveService(ctx: DriveCtx): Promise<GoogleDriveService> {
  return googleService({
    injected: ctx.services.drive,
    resolve: () => resolveDriveService(ctx.boxRoot),
  });
}

/** Whether a mount write would find a usable Drive service, without making one. */
async function driveConnected(ctx: DriveCtx): Promise<boolean> {
  if (ctx.services.drive) return true;
  return driveServiceAvailable(ctx.boxRoot);
}

/**
 * Run a mount operation, translating its refusals.
 *
 * A `DriveMountError` is something the person who asked has to fix — a URL
 * that is not a Drive link, a directory that already mirrors something else —
 * so it is a BAD_REQUEST carrying the refusal's own message. Anything else
 * (Drive down, git wedged) is ours, and stays a 500 with a generic shape.
 */
async function mountWrite<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof DriveMountError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
    }
    throw error;
  }
}

export const driveRouter = router({
  /**
   * The connector config. Only the legacy `folders` array lives there now, and
   * only until the next sync converts it into `.gfolder.card` mounts — a Drive
   * mount is a card, so there is nothing here to write.
   */
  config: publicProcedure.query(async ({ ctx }) => {
    const config = await loadDriveConfig(ctx.boxRoot);
    if (!config.ok) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: config.error });
    }
    return config.value;
  }),

  /**
   * Every folder mount on the box, plus whether Drive is reachable at all —
   * an empty list means something different when Google was never connected,
   * and the settings page has to say which.
   */
  mounts: publicProcedure.query(async ({ ctx }) => {
    return {
      connected: await driveConnected(ctx),
      mounts: await listFolderMounts(ctx.boxRoot),
    };
  }),

  /** Mirror a Drive folder into `dir` — writes the mount card and syncs once. */
  mount: publicProcedure
    .input(z.object({ url: z.string().min(1), dir: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const service = await driveService(ctx);
      return mountWrite(
        mountDriveFolder({
          boxRoot: ctx.boxRoot,
          service,
          input: input.url,
          dir: input.dir,
          actor: ctx.actor,
        }),
      );
    }),

  /** Write a pointer to any Drive item at `path`. Nothing is copied. */
  link: publicProcedure
    .input(z.object({ url: z.string().min(1), path: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const service = await driveService(ctx);
      return mountWrite(
        linkDriveItem({
          boxRoot: ctx.boxRoot,
          service,
          input: input.url,
          target: input.path,
          actor: ctx.actor,
        }),
      );
    }),

  /**
   * Stop mirroring. The mount card goes to `_bookkeeping/trash/`; every child stays
   * where it is, so this needs no Drive service at all.
   */
  unmount: publicProcedure
    .input(z.object({ cardPath: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return mountWrite(unmountDriveFolder({ boxRoot: ctx.boxRoot, target: input.cardPath }));
    }),

  /**
   * What a Drive URL or id actually is, without writing anything — the
   * verification step an agent needs before and after it writes a mount, and
   * the name the settings page currently learns only once a mount succeeds.
   */
  inspect: publicProcedure
    .input(z.object({ url: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const service = await driveService(ctx);
      return mountWrite(inspectDriveItem({ boxRoot: ctx.boxRoot, service, input: input.url }));
    }),

  /** Sync a Doc or Sheet two-way at `path`. The file verb behind `bbx drive add`. */
  add: publicProcedure
    .input(z.object({ url: z.string().min(1), path: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const service = await driveService(ctx);
      return mountWrite(
        addDriveFile({
          boxRoot: ctx.boxRoot,
          service,
          input: input.url,
          target: input.path,
          actor: ctx.actor,
        }),
      );
    }),

  /** Browse Drive: one folder's contents, or every spreadsheet the grant sees. */
  list: publicProcedure
    .input(z.object({ folder: z.string().min(1).optional() }))
    .query(async ({ input, ctx }) => {
      const service = await driveService(ctx);
      // `requireDriveId` throws SYNCHRONOUSLY, so it has to run inside the
      // promise `mountWrite` wraps — otherwise an unreadable folder id escapes
      // as a 500 instead of the BAD_REQUEST every other bad input gets.
      const folder = input.folder;
      const files = await mountWrite(
        Promise.resolve().then(() =>
          folder === undefined ? service.listSpreadsheets() : service.listFiles(requireDriveId(folder)),
        ),
      );
      return files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        owner: file.owners?.[0]?.emailAddress ?? null,
      }));
    }),

  /** Mirror one mount now, rather than waiting for the next wakeup sync. */
  syncFolder: publicProcedure
    .input(z.object({ cardPath: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const service = await driveService(ctx);
      return mountWrite(
        syncFolderMount({ boxRoot: ctx.boxRoot, service, target: input.cardPath }),
      );
    }),
});
