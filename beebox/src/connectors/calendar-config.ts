/**
 * Calendar configuration — shared between CLI and webapp.
 *
 * Reads/writes _config/connectors/google-calendar.json and
 * fetches available calendars from the Google Calendar API.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { getBoxDir } from "../lib/paths.js";
import type { GoogleCalendarService } from "../services/google-calendar.js";

export interface CalendarConfig {
  calendars?: string[];
  syncDaysBack?: number;
  syncDaysForward?: number;
  /** Cached calendar ID → display name mapping, updated during pull */
  calendarNames?: Record<string, string>;
  /** Cached calendar ID → accessRole mapping, updated during pull */
  calendarRoles?: Record<string, string>;
}

export interface AvailableCalendar {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: string;
  backgroundColor?: string;
}

function configPath(boxRoot: string): string {
  return path.join(getBoxDir(boxRoot, "connectors"), "google-calendar.json");
}

export async function loadCalendarConfig(
  boxRoot: string
): Promise<CalendarConfig> {
  try {
    const content = await fs.readFile(configPath(boxRoot), "utf-8");
    return JSON.parse(content);
  } catch (e) {
    // No config file yet (or it's unreadable/malformed): fall back to an empty
    // config. A missing file is expected before first setup; log so a corrupt
    // file isn't silently treated as "no calendars configured".
    if (errnoCode(e) !== "ENOENT") {
      console.warn("Could not load calendar config, using defaults:", e);
    }
    return {};
  }
}

export async function saveCalendarConfig(
  boxRoot: string,
  config: CalendarConfig
): Promise<void> {
  const dir = path.dirname(configPath(boxRoot));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath(boxRoot), JSON.stringify(config, null, 2));
}

/**
 * Fetch all calendars the user has access to via the calendar service.
 * Normalizes the list (only-true `primary` flag) and sorts primary-first,
 * then alphabetically by summary.
 */
export async function fetchAvailableCalendars(
  calendar: GoogleCalendarService,
): Promise<AvailableCalendar[]> {
  const items = await calendar.listCalendars();
  const calendars: AvailableCalendar[] = [];
  for (const item of items) {
    const cal: AvailableCalendar = {
      id: item.id,
      summary: item.summary,
      accessRole: item.accessRole,
    };
    if (item.description) cal.description = item.description;
    if (item.primary) cal.primary = true;
    if (item.backgroundColor) cal.backgroundColor = item.backgroundColor;
    calendars.push(cal);
  }

  calendars.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return a.summary.localeCompare(b.summary);
  });

  return calendars;
}

/** An available calendar, plus whether this box syncs it. */
export interface AvailableCalendarState extends AvailableCalendar {
  syncing: boolean;
  /** For the primary calendar, the real id the `primary` alias resolves to. */
  resolvedId?: string;
}

/**
 * What `bbx calendar calendars` and the settings page both show: every calendar
 * the grant can see, marked with whether it is in this box's sync list.
 *
 * One function because the CLI reaches it two ways — in-process under the
 * tooling profile, through `calendar.available` from an agent's shell — and a
 * caller must not be able to tell which one answered
 * (`docs/plans/agent-capability-delegation.md`).
 */
export async function availableCalendarsWithSyncing(options: {
  boxRoot: string;
  service: GoogleCalendarService;
}): Promise<AvailableCalendarState[]> {
  const available = await fetchAvailableCalendars(options.service);
  const config = await loadCalendarConfig(options.boxRoot);
  // An unconfigured box syncs the primary calendar; `primary` is an alias, so a
  // calendar listed under its real id still counts as synced.
  const syncing = new Set(config.calendars || ["primary"]);
  const primaryId = available.find((cal) => cal.primary)?.id;
  return available.map((cal) => ({
    ...cal,
    syncing: syncing.has(cal.id) || (cal.primary === true && syncing.has("primary")),
    ...(cal.primary && primaryId ? { resolvedId: primaryId } : {}),
  }));
}
