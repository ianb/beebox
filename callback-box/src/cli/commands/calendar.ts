/**
 * cb calendar — View calendar events from local .ics files.
 *
 * Subcommands:
 *   cb calendar upcoming [--count N]  — next N events (default 10)
 *   cb calendar today                 — today's events
 *   cb calendar week                  — this week's events
 */

import * as path from "node:path";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import {
  loadAllEvents,
  filterByDateRange,
  formatEvent,
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
  .description("View calendar events");

calendarCommand
  .command("upcoming")
  .description("Show upcoming events")
  .option("-n, --count <n>", "Number of events to show", "10")
  .action(async (options: { count: string }) => {
    const boxRoot = await requireBoxRoot();
    const calDir = path.join(boxRoot, "store/calendar");
    const events = await loadAllEvents(calDir);

    const now = new Date();
    const upcoming = events
      .filter((e) => e.end > now)
      .slice(0, parseInt(options.count, 10));

    if (upcoming.length === 0) {
      console.log("No upcoming events.");
      return;
    }

    for (const event of upcoming) {
      console.log(formatEvent(event));
    }
  });

calendarCommand
  .command("today")
  .description("Show today's events")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const calDir = path.join(boxRoot, "store/calendar");
    const events = await loadAllEvents(calDir);

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const todayEvents = filterByDateRange(events, { from: todayStart, to: todayEnd });

    if (todayEvents.length === 0) {
      console.log("No events today.");
      return;
    }

    for (const event of todayEvents) {
      console.log(formatEvent(event));
    }
  });

calendarCommand
  .command("week")
  .description("Show this week's events")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const calDir = path.join(boxRoot, "store/calendar");
    const events = await loadAllEvents(calDir);

    const now = new Date();
    const weekStart = startOfDay(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekEvents = filterByDateRange(events, { from: weekStart, to: weekEnd });

    if (weekEvents.length === 0) {
      console.log("No events this week.");
      return;
    }

    for (const event of weekEvents) {
      console.log(formatEvent(event));
    }
  });
