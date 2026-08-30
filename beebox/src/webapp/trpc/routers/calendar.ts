import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { getGoogleAuth } from "../../../connectors/google-auth.js";
import { isGoogleServiceAllowed } from "../../../core/box/config.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import {
  loadCalendarConfig,
  saveCalendarConfig,
  fetchAvailableCalendars,
  type CalendarConfig,
} from "../../../connectors/calendar-config.js";
import { createGoogleCalendarService } from "../../../services/google-calendar.js";
import { createGoogleAuthService } from "../../../services/google-auth.js";

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

    let svc = ctx.services.calendar;
    if (!svc) {
      const auth = await getGoogleAuth(ctx.boxRoot);
      if (!auth) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Google auth not configured. Run: bbx google-auth",
        });
      }
      svc = createGoogleCalendarService(createGoogleAuthService(auth, { boxRoot: ctx.boxRoot }));
    }
    const available = await fetchAvailableCalendars(svc);

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
      // Copy only present keys so an omitted field stays absent rather than
      // becoming an explicit `undefined` (exactOptionalPropertyTypes).
      const config: CalendarConfig = {};
      if (input.calendars !== undefined) config.calendars = input.calendars;
      if (input.syncDaysBack !== undefined) config.syncDaysBack = input.syncDaysBack;
      if (input.syncDaysForward !== undefined) config.syncDaysForward = input.syncDaysForward;
      await saveCalendarConfig(ctx.boxRoot, config);
      await stageAndCommitPaths(ctx.boxRoot, {
        paths: ["config/connectors/google-calendar.json"],
        message: "Update calendar sync config",
      });
      return { success: true };
    }),
});
