import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { getGoogleAuth } from "../../../connectors/google-auth.js";
import {
  loadCalendarConfig,
  saveCalendarConfig,
  fetchAvailableCalendars,
  type CalendarConfig,
} from "../../../connectors/calendar-config.js";

export const calendarRouter = router({
  available: publicProcedure.query(async ({ ctx }) => {
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
      return { success: true };
    }),
});
