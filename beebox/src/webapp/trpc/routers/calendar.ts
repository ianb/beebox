import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import {
  availableCalendarsWithSyncing,
  loadCalendarConfig,
  saveCalendarConfig,
  type CalendarConfig,
} from "../../../connectors/calendar-config.js";
import { resolveCalendarService } from "../../../connectors/google-access.js";
import { googleService } from "../google-service.js";
import { BOX_DIRS } from "../../../lib/paths.js";
import * as path from "node:path";

export const calendarRouter = router({
  /**
   * Every calendar the grant can see, marked with whether this box syncs it.
   *
   * The settings page's picker and `bbx calendar calendars` from an agent's
   * shell are the same call: the credential stays in this process either way
   * (`docs/plans/agent-capability-delegation.md`).
   */
  available: publicProcedure.query(async ({ ctx }) => {
    const service = await googleService({
      injected: ctx.services.calendar,
      resolve: () => resolveCalendarService(ctx.boxRoot),
    });
    return availableCalendarsWithSyncing({ boxRoot: ctx.boxRoot, service });
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
        paths: [path.join(BOX_DIRS.connectors, "google-calendar.json")],
        message: "Update calendar sync config",
      });
      return { success: true };
    }),
});
