// Event filenames: `{date}_{title}_{shortId}.ics`, built from the Google event
// by `eventFilename` and from its parts by `eventFileStem` (which the
// calendar-folders migration also uses, so both must agree).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventFilename, eventFileStem } from "../../../src/connectors/google-calendar/event-filename.js";

void test("a timed event is named by its local date, title, and the id's last eight characters", (t) => {
  t.check(eventFilename({
    id: "abcdefgh12345678",
    summary: "Dentist: Juni's checkup!",
    start: { dateTime: "2026-11-05T15:00:00-06:00" }, status: "confirmed",
  }), "2026-11-05_Dentist_Junis_checkup_12345678.ics");
  t.end();
});

void test("an all-day event uses its date", (t) => {
  t.check(eventFilename({ id: "x1y2z3w4", summary: "Camp Menogyn ", start: { date: "2026-05-18" }, status: "confirmed" }),
    "2026-05-18_Camp_Menogyn_x1y2z3w4.ics");
  t.end();
});

// A title with no usable characters drops its segment instead of using a
// placeholder word, so the name is the old `{date}_{shortId}` shape.
void test("a missing or unusable title drops the title segment", (t) => {
  t.check(eventFilename({ id: "00000000aaaabbbb", start: { date: "2026-01-02" }, status: "confirmed" }), "2026-01-02_aaaabbbb.ics");
  t.check(eventFileStem({ date: "2026-01-02", summary: "🎉🎉", shortId: "aaaabbbb" }), "2026-01-02_aaaabbbb");
  t.end();
});

void test("a long title is cut to forty characters without a trailing separator", (t) => {
  t.check(eventFileStem({
    date: "no-date",
    summary: "Quarterly planning session for the Marlowe household budget review",
    shortId: "k3j9q2aa",
  }), "no-date_Quarterly_planning_session_for_the_Marlo_k3j9q2aa");
  t.end();
});
