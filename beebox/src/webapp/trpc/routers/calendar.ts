import { z } from "zod";
import { router, publicProcedure } from "../procedures.js";
import { stageAndCommitPaths } from "../../../lib/git/core/operations.js";
import {
  availableCalendarsWithSyncing,
  loadCalendarConfig,
  saveCalendarConfig,
  type CalendarConfig,
} from "../../../connectors/google-calendar/config.js";
import { resolveCalendarService } from "../../../google/access.js";
import { googleService } from "../google-service.js";
import { BOX_DIRS } from "../../../lib/paths/core.js";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { resolveCardPath } from "../card-path.js";
import { cardFolder } from "../../../connectors/google-calendar/calendar-folders.js";
import { loadCardEvents } from "../../../connectors/google-calendar/card-events.js";

export const calendarRouter = router({
  /**
   * Every calendar the grant can see, marked with whether this box syncs it.
   *
   * The settings page's picker and `bbx calendar calendars` from an agent's
   * shell are the same call: the credential stays in this process either way
   * (`docs/implemented-plans/agent-capability-delegation.md`).
   */
  available: publicProcedure.query(async ({ ctx }) => {
    const service = await googleService({
      injected: ctx.services.calendar,
      resolve: () => resolveCalendarService(ctx.boxRoot),
    });
    return availableCalendarsWithSyncing({ boxRoot: ctx.boxRoot, service });
  }),

  /**
   * The events of one calendar card's folder between `from` and `to`, for the
   * card's page. `path` must be a calendar card directly in `_content/calendar/`.
   * Files that do not parse come back in `unreadable`; a folder that cannot be
   * read is an error, never an empty list.
   */
  cardEvents: publicProcedure
    .input(z.object({ path: z.string().min(1), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }))
    .query(async ({ input, ctx }) => {
      const { relPath, fullPath } = await resolveCardPath({ boxRoot: ctx.boxRoot, inputPath: input.path, mode: "read" });
      if (path.dirname(relPath) !== BOX_DIRS.calendar || !relPath.endsWith(".calendar.card")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Not a calendar card in ${BOX_DIRS.calendar}/: ${relPath}` });
      }
      const folder = cardFolder(fullPath);
      const loaded = await loadCardEvents(folder, { from: new Date(input.from), to: new Date(input.to) });
      const folderRel = path.relative(ctx.boxRoot, folder);
      return {
        events: loaded.events.map((event) => ({ ...event, file: `${folderRel}/${event.file}` })),
        unreadable: loaded.unreadable.map((file) => `${folderRel}/${file}`),
      };
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
      // Start from the stored config so the names and roles the sync caches
      // there survive a settings save, then copy only present keys so an
      // omitted field keeps its stored value (exactOptionalPropertyTypes).
      const config: CalendarConfig = { ...await loadCalendarConfig(ctx.boxRoot) };
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
