// # Calendar card schema
//
// A calendar card is written by the Google Calendar connector from
// `createCalendarTemplate`; the template's output must parse as a valid card
// with an empty body for the person's notes.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createCalendarTemplate } from "../../src/schemas/calendar.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas.js";

const schemas = await createCardSchemaMap();

void test("the connector's template parses as a calendar card", (t) => {
  const text = createCalendarTemplate({
    name: "Family", id: "family123@group.calendar.google.com", access: "owner", syncing: true,
  });
  const parsed = parseCardText(text, { source: "_content/calendar/Family.calendar.card", schemas });
  t.check(parsed.fields, {
    type: "calendar",
    title: "Family",
    "google-calendar": { id: "family123@group.calendar.google.com", access: "owner", syncing: true },
    body: "",
  });
  t.end();
});
