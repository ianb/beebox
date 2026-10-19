// # Connector activity record
//
// Every connector sync goes through `syncConnector`, which records what the sync
// did in the box-local day it ran. The record is what lets the box tell a
// connector that stopped producing apart from a quiet week.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { instanceOf, str } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "./helpers/test-helpers.js";
import {
  syncConnector,
  loadConnectorActivity,
  countNewItems,
  addDays,
  ACTIVITY_RETENTION_DAYS,
  ConnectorActivityInvalidError,
} from "../src/connector-activity/core.js";
import { transientStatePath } from "../src/transient-state.js";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import assert from "node:assert/strict";
import type { Connector, SyncResult } from "../src/connector.js";
import type { ActivityFile } from "../src/connector-activity/core.js";

/** A connector whose next sync returns (or throws) what the test queues. */
function scripted(name: string, outcomes: (SyncResult | Error)[]): Connector {
  return {
    name,
    inboxPaths: [],
    async sync() {
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, "scripted connector ran out of outcomes");
      return next;
    },
  };
}
const ok = (created: string[], updated?: string[]): SyncResult => ({ success: true, created, updated: updated ?? [] });

/** The gmail entry of an activity file, which the test expects to exist. */
function gmailOf(file: ActivityFile) {
  const gmail = file.connectors.gmail;
  assert.ok(gmail, "no gmail activity recorded");
  return gmail;
}

// ## A new item is a new top-level card
//
// Gmail's `created` lists new message files too, including replies added to
// threads the box already tracks. Those live in the thread card's `.attach/`
// scope, so only the thread card counts as a new item. Counting raw `created`
// would let replies on tracked threads hide a connector that stopped importing
// new threads.
void test("Gmail's created lists new message files too, including replies added to threa...", async (t) => {
  t.check(
    countNewItems([
      "_content/inbox/email/Hello.email-thread.card",
      "_content/inbox/email/Hello.attach/msg-001.email-message.card",
      "_content/inbox/email/Hello.attach/msg-001.attach/photo.jpg",
      "_content/inbox/email/Old.attach/msg-007.email-message.card",
    ]),
    1,
  );
});

// ## Each attempt lands in its box-local day
void test("Each attempt lands in its box-local day", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const gmail = scripted("gmail", [
    ok(["_content/inbox/email/A.email-thread.card", "_content/inbox/email/A.attach/msg-001.email-message.card"]),
    ok(["_content/inbox/email/B.attach/msg-002.email-message.card"], ["_content/inbox/email/B.email-thread.card"]),
    { success: true, created: [], updated: [], skipped: { reason: "not-configured", detail: "no grant" } },
    { success: true, created: [], updated: [], error: "Draft upload failed for 1 card: x" },
    new Error("network down"),
  ]);
  const now = new Date("2026-09-18T15:00:00Z");
  for (let i = 0; i < 4; i++) await syncConnector(gmail, { boxRoot: box.root, now });
  const thrown = await syncConnector(gmail, { boxRoot: box.root, now }).catch((e) => e.message);
  t.check(thrown, "network down");

  const file = await loadConnectorActivity(box.root);
  t.check(Object.keys(gmailOf(file).days), [
    "2026-09-18",
  ]);

  const day = gmailOf(file).days["2026-09-18"];
  assert.ok(day);
  t.check(day, {
    runs: 5,
    ok: 2,
    newItems: 1,
    created: 3,
    updated: 1,
    errored: 2,
    skipped: 1,
    lastError: "network down",
  });

  // The thrown sync is counted as a run: a day where every sync throws must read as
  // an all-error day, not as a day with no runs.
  //
  // ## Old days are pruned

  const later = new Date("2026-11-30T15:00:00Z");
  await syncConnector(scripted("gmail", [ok([])]), { boxRoot: box.root, now: later });
  const pruned = await loadConnectorActivity(box.root);
  t.check(Object.keys(gmailOf(pruned).days), [
    "2026-11-30",
  ]);

  t.check(addDays("2026-11-30", -(ACTIVITY_RETENTION_DAYS - 1)), "2026-10-02");
});

// ## A damaged record is reported, and the sync still returns
//
// A record that fails its schema is not reset: that would also drop an open
// episode's dismissal. Reading it throws; recording into it logs and leaves the
// sync's own result intact.
void test("A record that fails its schema is not reset:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const statePath = transientStatePath(box.root, "connector-activity");
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ version: 1, connectors: { gmail: { days: { "2026-09-18": { runs: -1 } } } } }));

  const readError = await loadConnectorActivity(box.root).catch((e) => e);
  t.check(readError, instanceOf(ConnectorActivityInvalidError));

  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  let result;
  try {
    result = await syncConnector(scripted("gmail", [ok(["_content/inbox/email/C.email-thread.card"])]), {
      boxRoot: box.root,
      now: new Date("2026-09-18T15:00:00Z"),
    });
  } finally {
    console.error = originalError;
  }

  t.check(result.created, ["_content/inbox/email/C.email-thread.card"]);
  t.check(logged, [
    str`[connector-activity] could not record gmail sync for ${box.root}: Connector activity record at ${statePath} is invalid: ✖ Invalid input: expected object, received undefined
  → at connectors.gmail.episode
✖ Too small: expected number to be >=0
  → at connectors.gmail.days["2026-09-18"].runs
✖ Invalid input: expected number, received undefined
  → at connectors.gmail.days["2026-09-18"].ok
✖ Invalid input: expected number, received undefined
  → at connectors.gmail.days["2026-09-18"].newItems
✖ Invalid input: expected number, received undefined
  → at connectors.gmail.days["2026-09-18"].created
✖ Invalid input: expected number, received undefined
  → at connectors.gmail.days["2026-09-18"].updated
✖ Invalid input: expected number, received undefined
  → at connectors.gmail.days["2026-09-18"].errored
✖ Invalid input: expected number, received undefined
  → at connectors.gmail.days["2026-09-18"].skipped
✖ Invalid input: expected string, received undefined
  → at connectors.gmail.days["2026-09-18"].lastError`,
  ]);
});
