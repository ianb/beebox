// # Google Calendar sync decision policy
//
// `decideCalendarSync` (`src/connectors/google-calendar/decide.ts`) is the single
// pure function holding the connector's who-wins precedence. The IO passes gather
// booleans from disk/state and dispatch on its `SyncDecision`. It has no fs or
// API dependency, so the whole policy is exercised here.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { decideCalendarSync } from "../../../src/connectors/google-calendar/decide.js";

const kind = (s: Parameters<typeof decideCalendarSync>[0]) => decideCalendarSync(s).kind;

// ## Pull pass — a remote event we already track
//
// A new (untracked) remote event is written down: remote-wins.
void test("A new (untracked) remote event is written down:", async (t) => {
  t.check(kind({ source: "remote-event", tracked: false, localEdited: false, remoteChanged: false }), "remote-wins");
});

// An unedited local file is refreshed from Google: remote-wins.
void test("An unedited local file is refreshed from Google:", async (t) => {
  t.check(kind({ source: "remote-event", tracked: true, localEdited: false, remoteChanged: false }), "remote-wins");
});

// A local edit with no remote change is pushed: local-wins.
void test("A local edit with no remote change is pushed:", async (t) => {
  t.check(kind({ source: "remote-event", tracked: true, localEdited: true, remoteChanged: false }), "local-wins");
});

// The one asymmetric rule — a local edit that collides with a remote change is
// discarded; remote is authoritative.
void test("The one asymmetric rule — a local edit that collides with a remote change is...", async (t) => {
  t.check(kind({ source: "remote-event", tracked: true, localEdited: true, remoteChanged: true }), "remote-wins");
});

// ## Pull pass — a cancelled remote event
void test("Pull pass — a cancelled remote event", async (t) => {
  t.check(kind({ source: "remote-cancelled", tracked: true }), "delete");

  t.check(kind({ source: "remote-cancelled", tracked: false }), "noop");
});

// ## Push pass — a local X-BBX-DELETE marker
//
// Deletes only when under the per-sync cap and the state knows the calendar id;
// otherwise it's skipped with a reason.
void test("Deletes only when under the per-sync cap and the state knows the calendar id;...", async (t) => {
  t.check(decideCalendarSync({ source: "local-delete-marker", hasCalendarId: true, underDeleteCap: true }), {
    kind: "delete",
  });

  t.check(decideCalendarSync({ source: "local-delete-marker", hasCalendarId: true, underDeleteCap: false }), {
    kind: "noop",
    reason: "reached per-sync delete cap",
  });

  t.check(decideCalendarSync({ source: "local-delete-marker", hasCalendarId: false, underDeleteCap: true }), {
    kind: "noop",
    reason: "no calendar ID in state",
  });
});

// The cap is checked before the calendar id, matching the original inline order.
void test("The cap is checked before the calendar id, matching the original inline order.", async (t) => {
  t.check(decideCalendarSync({ source: "local-delete-marker", hasCalendarId: false, underDeleteCap: false }), {
    kind: "noop",
    reason: "reached per-sync delete cap",
  });
});
