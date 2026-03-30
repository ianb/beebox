import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { getGoogleAuth } from "../../../connectors/google-auth.js";
import { isGoogleServiceAllowed } from "../../box-config.js";
import { stageFiles, commit } from "../../../cli/lib/git.js";
import {
  loadCalendarConfig,
  saveCalendarConfig,
  fetchAvailableCalendars,
  type CalendarConfig,
} from "../../../connectors/calendar-config.js";

export const calendarRouter = router({
  available: publicProcedure.query(async ({ ctx }) => {
    // Skip policy check when a fake service is injected (tests)
    if (!ctx.services.calendar) {
      const allowed = await isGoogleServiceAllowed(ctx.boxRoot, "calendar");
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Calendar service not enabled for this box. Enable it in box settings.",
        });
      }
    }

    let available;
    if (ctx.services.calendar) {
      available = await ctx.services.calendar.listCalendars();
    } else {
      const auth = await getGoogleAuth(ctx.boxRoot);
      if (!auth) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Google auth not configured. Run: cb google-auth",
        });
      }
      available = await fetchAvailableCalendars(auth);
    }

    const config = await loadCalendarConfig(ctx.boxRoot);
    const syncList = config.calendars || ["primary"];
    const syncing = new Set(syncList);
    const primaryId = available.find((c) => c.primary)?.id;

    return available.map((cal) => ({
      ...cal,
      syncing: syncing.has(cal.id) || (cal.primary === true && syncing.has("primary")),
      ...(cal.primary && primaryId ? { resolvedId: primaryId } : {}),
    }));
  }),

  config: publicProcedure.query(async ({ ctx }) => {
    return loadCalendarConfig(ctx.boxRoot);
  }),

  updateConfig: publicProcedure
    .input(
      z.object({
        calendars: z.array(z.string()).optional(),
        syncDaysBack: z.number().optional(),
        syncDaysForward: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await saveCalendarConfig(ctx.boxRoot, input as CalendarConfig);
      await stageFiles(ctx.boxRoot, ["config/connectors/google-calendar.json"]);
      await commit(ctx.boxRoot, { message: "Update calendar sync config" });
      return { success: true };
    }),
});
