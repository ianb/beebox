/**
 * Quick test: create a new event on a specified Google Calendar.
 *
 * Usage: npx tsx scripts/test-calendar-create.ts <boxRoot> <calendarId> <summary> [date]
 *
 * Creates a transparent (free/not-busy) all-day event.
 * Default date is tomorrow.
 */

import { getGoogleAuth } from "../src/connectors/google-auth.js";

async function main() {
  const boxRoot = process.argv[2];
  const calendarId = process.argv[3];
  const summary = process.argv[4];
  const dateStr = process.argv[5]; // optional YYYY-MM-DD

  if (!boxRoot || !calendarId || !summary) {
    console.error(
      "Usage: npx tsx scripts/test-calendar-create.ts <boxRoot> <calendarId> <summary> [YYYY-MM-DD]"
    );
    process.exit(1);
  }

  // Default to tomorrow
  let startDate: string;
  let endDate: string;
  if (dateStr) {
    startDate = dateStr;
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + 1);
    endDate = d.toISOString().slice(0, 10);
  } else {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    startDate = tomorrow.toISOString().slice(0, 10);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);
    endDate = dayAfter.toISOString().slice(0, 10);
  }

  const auth = await getGoogleAuth(boxRoot);
  if (!auth) {
    console.error("Google auth not configured");
    process.exit(1);
  }

  const body = {
    summary,
    start: { date: startDate },
    end: { date: endDate },
    transparency: "transparent",
    status: "tentative",
  };

  console.log("Creating event:");
  console.log(JSON.stringify(body, null, 2));
  console.log(`Calendar: ${calendarId}`);

  const accessToken = (await auth.getAccessToken()).token;
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`POST failed: ${response.status} ${response.statusText}`);
    console.error(text);
    process.exit(1);
  }

  const result = await response.json() as Record<string, unknown>;
  console.log("\nSuccess! Created event:");
  console.log(`  ID: ${result.id}`);
  console.log(`  Summary: ${result.summary}`);
  console.log(`  Status: ${result.status}`);
  console.log(`  Transparency: ${result.transparency}`);
  console.log(`  Link: ${result.htmlLink}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
