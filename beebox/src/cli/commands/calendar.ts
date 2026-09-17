/**
 * bbx calendar — View calendar events from local .ics files.
 *
 * Usage:
 *   bbx calendar              — next 7 days (default)
 *   bbx calendar 3d           — next 3 days
 *   bbx calendar 2w           — next 2 weeks
 *   bbx calendar today        — today only
 *   bbx calendar vtimezone    — print the box's VTIMEZONE block (for .ics events)
 *   bbx calendar calendars    — list available calendars (from Google API)
 *
 * `calendars` needs the Google credential, so it follows the credentialed-verb
 * rule (`cli/lib/credentialed-verb.ts`): in-process only under the tooling
 * profile, otherwise this box's own server answers. `add` and `remove` write
 * the box's own config file and stay in-process in every profile.
 *   bbx calendar add <id>     — add a calendar to sync
 *   bbx calendar remove <id>  — remove a calendar from sync
 */

import { Command } from "commander";
import { requireBoxRoot, getBoxDir } from "../../lib/paths.js";
import {
  availableCalendarsWithSyncing,
  loadCalendarConfig,
  saveCalendarConfig,
  type AvailableCalendarState,
} from "../../connectors/calendar-config.js";
import { resolveCalendarService } from "../../connectors/google-access.js";
import {
  loadCalendarState,
  CalendarStateCorruptError,
} from "../../connectors/google-calendar-state.js";
import type { GoogleCalendarService } from "../../services/google-calendar.js";
import {
  CredentialGapError,
  dispatchCredentialed,
  jsonFlag,
  runCredentialedVerb,
} from "../lib/credentialed-verb.js";
import {
  loadAllEvents,
  filterByDateRange,
  formatEvent,
  parseTimespan,
} from "../../connectors/calendar-utils.js";
import { vtimezoneBlock } from "../../connectors/google-calendar-ics.js";
import { loadBoxTimezone } from "../../core/box/config.js";

/** The Calendar client for an in-process run; the two gates throw as one refusal. */
export async function localCalendarService(boxRoot: string): Promise<GoogleCalendarService> {
  const resolved = await resolveCalendarService(boxRoot);
  if (!resolved.ok) throw new CredentialGapError(resolved.error);
  return resolved.value;
}

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
    const calDir = getBoxDir(boxRoot, "calendar");
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
  .command("vtimezone")
  .description("Print this box's VTIMEZONE block (paste into an .ics event)")
  .action(async (): Promise<void> => {
    const boxRoot = await requireBoxRoot();
    const timezone =
      (await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log(vtimezoneBlock(timezone).trim());
  });

/**
 * The local event count, or undefined when the state index is unreadable.
 *
 * Read through the connector's own loader so this display can't disagree with
 * what a sync would see. A corrupt index is read-only here, so it degrades —
 * but visibly, never as a silent "0".
 */
async function storedEventCount(boxRoot: string): Promise<number | undefined> {
  try {
    const state = await loadCalendarState(boxRoot);
    return Object.keys(state.eventFiles).length;
  } catch (e) {
    if (!(e instanceof CalendarStateCorruptError)) throw e;
    console.warn(e.message);
    return undefined;
  }
}

const calendarsCommand = calendarCommand
  .command("calendars")
  .description("List available Google calendars")
  .option("--json", "Print the result as one JSON object")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const eventCount = await storedEventCount(boxRoot);
    await runCredentialedVerb({
      json: jsonFlag(calendarsCommand),
      run: () =>
        dispatchCredentialed<AvailableCalendarState[]>({
          local: async () =>
            availableCalendarsWithSyncing({
              boxRoot,
              service: await localCalendarService(boxRoot),
            }),
          remote: (client) => client.calendar.available.query(),
        }),
      print: (available) => {
        console.log("Available calendars:\n");
        for (const cal of available) {
          const active = cal.syncing ? "[syncing] " : "";
          const role = cal.accessRole !== "owner" ? `(${cal.accessRole})` : "";
          console.log(`  ${active}${cal.summary}  ${role}`);
          console.log(`         id: ${cal.id}`);
        }
        console.log(eventCount === undefined
          ? "\nEvent count unavailable — the calendar state file is unreadable (see above)."
          : `\n${String(eventCount)} events stored locally.`);
        console.log("\nUse \"bbx calendar add <id>\" / \"bbx calendar remove <id>\" to configure.");
      },
    });
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
    console.log("Run \"bbx wakeup\" to fetch events.");
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
