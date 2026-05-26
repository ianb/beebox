/**
 * Calendar configuration — shared between CLI and webapp.
 *
 * Reads/writes config/connectors/google-calendar.json and
 * fetches available calendars from the Google Calendar API.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ky from "ky";
import type { OAuth2Client } from "google-auth-library";

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

interface CalendarListResponse {
  items?: Array<{
    id: string;
    summary: string;
    description?: string;
    primary?: boolean;
    accessRole: string;
    backgroundColor?: string;
  }>;
  nextPageToken?: string;
}

function configPath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/google-calendar.json");
}

export async function loadCalendarConfig(
  boxRoot: string
): Promise<CalendarConfig> {
  try {
    const content = await fs.readFile(configPath(boxRoot), "utf-8");
    return JSON.parse(content);
  } catch {
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
 * Fetch all calendars the user has access to from the Google Calendar API.
 */
export async function fetchAvailableCalendars(
  auth: OAuth2Client
): Promise<AvailableCalendar[]> {
  const calendars: AvailableCalendar[] = [];
  let pageToken: string | undefined;

  do {
    const searchParams: Record<string, string> = {};
    if (pageToken) {
      searchParams["pageToken"] = pageToken;
    }

    const accessToken = (await auth.getAccessToken()).token;
    const data = await ky
      .get("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        searchParams,
        headers: { Authorization: `Bearer ${accessToken}` },
        retry: 2,
      })
      .json<CalendarListResponse>();

    if (data.items) {
      for (const item of data.items) {
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
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  // Sort: primary first, then by summary
  calendars.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return a.summary.localeCompare(b.summary);
  });

  return calendars;
}
