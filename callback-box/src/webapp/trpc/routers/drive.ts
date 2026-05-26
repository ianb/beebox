import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { getGoogleAuth } from "../../../connectors/google-auth.js";
import { isGoogleServiceAllowed } from "../../box-config.js";
import { loadDriveConfig, saveDriveConfig } from "../../../connectors/drive-config.js";
import { stageFiles, commit } from "../../../cli/lib/git.js";
import { extractDriveFileId } from "../../../connectors/drive-types.js";
import { createGoogleAuthService } from "../../../services/google-auth.js";
import { createGoogleDriveService } from "../../../services/google-drive.js";
import type { GoogleDriveService } from "../../../services/google-drive.js";

async function getDriveService(boxRoot: string, injected?: GoogleDriveService): Promise<GoogleDriveService> {
  if (injected) return injected;

  const auth = await getGoogleAuth(boxRoot);
  if (!auth) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Google auth not configured. Run: cb google-auth",
    });
  }
  const authService = createGoogleAuthService(auth);
  return createGoogleDriveService(authService);
}

export const driveRouter = router({
  config: publicProcedure.query(async ({ ctx }) => {
    return loadDriveConfig(ctx.boxRoot);
  }),

  available: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.services.drive) {
      const allowed = await isGoogleServiceAllowed(ctx.boxRoot, "drive");
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Drive service not enabled for this box. Enable it in box settings.",
        });
      }
    }

    const service = await getDriveService(ctx.boxRoot, ctx.services.drive);
    return service.listSpreadsheets();
  }),

  inspect: publicProcedure
    .input(z.object({ urlOrId: z.string() }))
    .query(async ({ input, ctx }) => {
      const fileId = extractDriveFileId(input.urlOrId);
      if (!fileId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not extract file ID from input",
        });
      }

      const service = await getDriveService(ctx.boxRoot, ctx.services.drive);
      const file = await service.getFile(fileId);

      let tabs: Array<{ title: string; gid: number }> = [];
      if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
        const ss = await service.getSpreadsheet(fileId);
        tabs = ss.sheets.map((s) => ({
          title: s.properties.title,
          gid: s.properties.sheetId,
        }));
      }

      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        owner: file.owners?.[0]?.emailAddress ?? "unknown",
        link: file.webViewLink,
        tabs,
      };
    }),

  updateConfig: publicProcedure
    .input(
      z.object({
        folders: z.array(z.object({
          driveFolderId: z.string(),
          localPath: z.string(),
        })).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const config = input.folders ? { folders: input.folders } : {};
      await saveDriveConfig(ctx.boxRoot, config);
      await stageFiles(ctx.boxRoot, ["config/connectors/google-drive.json"]);
      await commit(ctx.boxRoot, { message: "Update Drive sync config" });
      return { success: true };
    }),
});
