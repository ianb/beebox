/**
 * Calendar configuration routes.
 *
 * GET  /api/calendar/available  — list all Google calendars the user has access to
 * GET  /api/calendar/config     — current sync config (which calendars are synced)
 * PUT  /api/calendar/config     — update sync config
 */

import type { FastifyInstance } from "fastify";
import { getGoogleAuth } from "../../connectors/google-auth.js";
import { isGoogleServiceAllowed } from "../box-config.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import {
  loadCalendarConfig,
  saveCalendarConfig,
  fetchAvailableCalendars,
  type CalendarConfig,
} from "../../connectors/calendar-config.js";
import type { GoogleCalendarService } from "../../services/google-calendar.js";

interface CalendarRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  calendar?: GoogleCalendarService | undefined;
}

export async function registerCalendarRoutes(
  options: CalendarRoutesOptions,
): Promise<void> {
  const { server, boxRoot, calendar } = options;

  // GET /api/calendar/available — all calendars from Google, with sync status
  server.get("/api/calendar/available", async (_request, reply) => {
    // Skip policy check when a fake service is injected (tests)
    if (!calendar) {
      const allowed = await isGoogleServiceAllowed(boxRoot, "calendar");
      if (!allowed) {
        return reply
          .status(403)
          .send({ error: "Calendar service not enabled for this box. Enable it in box settings." });
      }
    }

    let available;
    if (calendar) {
      available = await calendar.listCalendars();
    } else {
      const auth = await getGoogleAuth(boxRoot);
      if (!auth) {
        return reply
          .status(503)
          .send({ error: "Google auth not configured. Run: cb google-auth" });
      }
      available = await fetchAvailableCalendars(auth);
    }

    const config = await loadCalendarConfig(boxRoot);
    const syncList = config.calendars || ["primary"];
    const syncing = new Set(syncList);

    // "primary" is an alias for the user's main calendar
    const primaryId = available.find((c) => c.primary)?.id;

    return available.map((cal) => ({
      ...cal,
      syncing:
        syncing.has(cal.id) ||
        (cal.primary === true && syncing.has("primary")),
      ...(cal.primary && primaryId ? { resolvedId: primaryId } : {}),
    }));
  });

  // GET /api/calendar/config — current config
  server.get("/api/calendar/config", async () => {
    return loadCalendarConfig(boxRoot);
  });

  // PUT /api/calendar/config — update config
  server.put<{ Body: CalendarConfig }>(
    "/api/calendar/config",
    async (request) => {
      const config = request.body;
      await saveCalendarConfig(boxRoot, config);
      await stageFiles(boxRoot, ["config/connectors/google-calendar.json"]);
      await commit(boxRoot, { message: "Update calendar sync config" });
      return { success: true };
    }
  );
}
