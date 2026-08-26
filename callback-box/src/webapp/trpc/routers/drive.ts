import { router, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { loadDriveConfig } from "../../../connectors/drive-config.js";

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
});
