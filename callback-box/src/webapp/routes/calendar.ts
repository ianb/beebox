/**
 * Calendar configuration routes.
 *
 * GET  /api/calendar/available  — list all Google calendars the user has access to
 * GET  /api/calendar/config     — current sync config (which calendars are synced)
 * PUT  /api/calendar/config     — update sync config
 */

import type { FastifyInstance } from "fastify";
import { getGoogleAuth } from "../../connectors/google-auth.js";
import {
  loadCalendarConfig,
  saveCalendarConfig,
  fetchAvailableCalendars,
  type CalendarConfig,
} from "../../connectors/calendar-config.js";

export async function registerCalendarRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<void> {
  // GET /api/calendar/available — all calendars from Google, with sync status
  server.get("/api/calendar/available", async (_request, reply) => {
    const auth = await getGoogleAuth(boxRoot);
    if (!auth) {
      return reply
        .status(503)
        .send({ error: "Google auth not configured. Run: cb google-auth" });
    }

    const config = await loadCalendarConfig(boxRoot);
    const syncList = config.calendars || ["primary"];
    const syncing = new Set(syncList);

    const available = await fetchAvailableCalendars(auth);

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
      return { success: true };
    }
  );
}
