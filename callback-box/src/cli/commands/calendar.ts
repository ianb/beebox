/**
 * cb calendar — View calendar events from local .ics files.
 *
 * Usage:
 *   cb calendar              — next 7 days (default)
 *   cb calendar 3d           — next 3 days
 *   cb calendar 2w           — next 2 weeks
 *   cb calendar today        — today only
 *   cb calendar calendars    — list available calendars (from Google API)
 *   cb calendar add <id>     — add a calendar to sync
 *   cb calendar remove <id>  — remove a calendar from sync
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { getGoogleAuth } from "../../connectors/google-auth.js";
import {
  loadCalendarConfig,
  saveCalendarConfig,
  fetchAvailableCalendars,
} from "../../connectors/calendar-config.js";
import { createGoogleCalendarService } from "../../services/google-calendar.js";
import { createGoogleAuthService } from "../../services/google-auth.js";
import {
  loadAllEvents,
  filterByDateRange,
  formatEvent,
  parseTimespan,
} from "../../connectors/calendar-utils.js";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export const calendarCommand = new Command("calendar")
  .description("View calendar events (default: next 7 days)")
  .argument("[timespan]", 'Time range: "today", "3d", "2w", "1m" (default: 7d)')
  .action(async (timespan?: string) => {
    const boxRoot = await requireBoxRoot();
    const calDir = path.join(boxRoot, "store/calendar");
    const now = new Date();

    let from: Date;
    let to: Date;
    let label: string;

    if (timespan === "today") {
      from = startOfDay(now);
      to = endOfDay(now);
      label = "today";
    } else {
      from = startOfDay(now);
      const ms = parseTimespan(timespan || "7d");
      to = new Date(from.getTime() + ms);
      label = `next ${timespan || "7d"}`;
    }

    // Pass range to loadAllEvents so recurring events get expanded
    const events = await loadAllEvents(calDir, { from, to });
    const filtered = filterByDateRange(events, { from, to });

    if (filtered.length === 0) {
      console.log(`No events ${label}.`);
      return;
    }

    for (const event of filtered) {
      console.log(formatEvent(event));
    }
  });

calendarCommand
  .command("calendars")
  .description("List available Google calendars")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const auth = await getGoogleAuth(boxRoot);
    if (!auth) {
      console.error("Google auth not configured. Run: cb google-auth");
      process.exit(1);
    }

    const config = await loadCalendarConfig(boxRoot);
    const syncList = config.calendars || ["primary"];
    const syncing = new Set(syncList);

    const svc = createGoogleCalendarService(createGoogleAuthService(auth));
    const available = await fetchAvailableCalendars(svc);

    // "primary" is an alias for the user's main calendar
    const primaryId = available.find((c) => c.primary)?.id;

    function isSyncing(calId: string): boolean {
      if (syncing.has(calId)) return true;
      if (primaryId && calId === primaryId && syncing.has("primary")) return true;
      return false;
    }

    // Read state for event count
    const statePath = path.join(boxRoot, "config/connectors/google-calendar-state.json");
    let eventCount = 0;
    try {
      const content = await fs.readFile(statePath, "utf-8");
      const state = JSON.parse(content);
      eventCount = Object.keys(state.eventFiles || {}).length;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Could not read calendar state at ${statePath}, assuming no events stored:`, e);
      }
    }

    console.log("Available calendars:\n");
    for (const cal of available) {
      const active = isSyncing(cal.id) ? "[syncing]" : "";
      const role = cal.accessRole !== "owner" ? `(${cal.accessRole})` : "";
      console.log(`  ${active ? active + " " : ""}${cal.summary}  ${role}`);
      console.log(`         id: ${cal.id}`);
    }
    console.log(`\n${eventCount} events stored locally.`);
    console.log("\nUse \"cb calendar add <id>\" / \"cb calendar remove <id>\" to configure.");
  });

calendarCommand
  .command("add")
  .description("Add a calendar to sync")
  .argument("<id>", "Calendar ID (email or 'primary')")
  .action(async (id: string) => {
    const boxRoot = await requireBoxRoot();
    const config = await loadCalendarConfig(boxRoot);
    const calendars = config.calendars || ["primary"];

    if (calendars.includes(id)) {
      console.log(`Calendar "${id}" is already being synced.`);
      return;
    }

    calendars.push(id);
    await saveCalendarConfig(boxRoot, { ...config, calendars });
    console.log(`Added "${id}" to synced calendars.`);
    console.log("Run \"cb wakeup\" to fetch events.");
  });

calendarCommand
  .command("remove")
  .description("Remove a calendar from sync")
  .argument("<id>", "Calendar ID to stop syncing")
  .action(async (id: string) => {
    const boxRoot = await requireBoxRoot();
    const config = await loadCalendarConfig(boxRoot);
    const calendars = config.calendars || ["primary"];

    if (!calendars.includes(id)) {
      console.log(`Calendar "${id}" is not being synced.`);
      return;
    }

    const updated = calendars.filter((c) => c !== id);
    if (updated.length === 0) {
      console.error("Cannot remove the last calendar. At least one must be synced.");
      process.exit(1);
    }

    await saveCalendarConfig(boxRoot, { ...config, calendars: updated });
    console.log(`Removed "${id}" from synced calendars.`);
  });
