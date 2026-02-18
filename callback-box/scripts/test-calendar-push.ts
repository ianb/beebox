/**
 * Quick test script: push a local .ics change back to Google Calendar.
 *
 * Usage: npx tsx scripts/test-calendar-push.ts <boxRoot> <icsFilename>
 *
 * Reads the .ics file, finds the Google event ID from state,
 * and PATCHes the event via the Calendar API.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ICAL from "ical.js";
import { getGoogleAuth } from "../src/connectors/google-auth.js";

interface EventFileEntry {
  filename: string;
  calendarId: string;
}

interface CalendarState {
  syncTokens: Record<string, string>;
  eventFiles: Record<string, string | EventFileEntry>;
}

async function main() {
  const boxRoot = process.argv[2];
  const icsFilename = process.argv[3];

  if (!boxRoot || !icsFilename) {
    console.error("Usage: npx tsx scripts/test-calendar-push.ts <boxRoot> <icsFilename>");
    process.exit(1);
  }

  // 1. Read the .ics file
  const icsPath = path.join(boxRoot, "store/calendar", icsFilename);
  const icsContent = await fs.readFile(icsPath, "utf-8");
  console.log("Read:", icsPath);

  // 2. Parse the .ics
  const parsed = ICAL.parse(icsContent);
  const comp = new ICAL.Component(parsed);
  const vevent = comp.getFirstSubcomponent("vevent");
  if (!vevent) {
    console.error("No VEVENT found in .ics file");
    process.exit(1);
  }

  const event = new ICAL.Event(vevent);
  const summary = event.summary;
  const description = event.description || undefined;
  const location = vevent.getFirstPropertyValue("location") as string | null;

  console.log(`Event: ${summary}`);
  console.log(`Description: ${description ?? "(none)"}`);
  console.log(`Location: ${location ?? "(none)"}`);

  // 3. Load state to find the Google event ID and calendar ID
  const statePath = path.join(boxRoot, "config/connectors/google-calendar-state.json");
  const state: CalendarState = JSON.parse(await fs.readFile(statePath, "utf-8"));

  let googleEventId: string | undefined;
  let calendarId: string | undefined;

  for (const [eid, entry] of Object.entries(state.eventFiles)) {
    const fn = typeof entry === "string" ? entry : entry.filename;
    if (fn === icsFilename) {
      googleEventId = eid;
      calendarId = typeof entry === "string" ? "primary" : entry.calendarId;
      break;
    }
  }

  if (!googleEventId || !calendarId) {
    console.error(`Could not find event for filename ${icsFilename} in state`);
    process.exit(1);
  }

  console.log(`Google Event ID: ${googleEventId}`);
  console.log(`Calendar ID: ${calendarId}`);

  // 4. Get auth
  const auth = await getGoogleAuth(boxRoot);
  if (!auth) {
    console.error("Google auth not configured");
    process.exit(1);
  }

  // 5. Build the PATCH body — just the fields we want to update
  const dtstart = vevent.getFirstPropertyValue("dtstart") as ICAL.Time;
  const dtend = vevent.getFirstPropertyValue("dtend") as ICAL.Time;
  const isAllDay = dtstart ? dtstart.isDate : false;

  const body: Record<string, unknown> = {
    summary,
  };

  if (description !== undefined) {
    body.description = description;
  }
  if (location) {
    body.location = location;
  }

  if (isAllDay) {
    if (dtstart) body.start = { date: dtstart.toString() };
    if (dtend) body.end = { date: dtend.toString() };
  } else {
    if (dtstart) body.start = { dateTime: dtstart.toJSDate().toISOString() };
    if (dtend) body.end = { dateTime: dtend.toJSDate().toISOString() };
  }

  const transp = String(vevent.getFirstPropertyValue("transp") || "OPAQUE").toUpperCase();
  body.transparency = transp === "TRANSPARENT" ? "transparent" : "opaque";

  console.log("\nPATCH body:", JSON.stringify(body, null, 2));

  // 6. Send the PATCH request
  const accessToken = (await auth.getAccessToken()).token;
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`;

  console.log(`\nPATCHing: ${url}`);

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`PATCH failed: ${response.status} ${response.statusText}`);
    console.error(text);
    process.exit(1);
  }

  const result = await response.json();
  console.log("\nSuccess! Updated event:");
  console.log(`  Summary: ${result.summary}`);
  console.log(`  Description: ${result.description ?? "(none)"}`);
  console.log(`  Updated: ${result.updated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
