// # Schedule alert conditions (bin/lib/schedules-alerts.ts, schedules-alert-lifecycle.ts)
//
// A schedule that finds the same thing every hour used to add a record every
// hour, and nothing ever closed them: the store held sixty open alerts, most of
// them stale, and a new one did not stand out
// (`docs/plans/schedule-alert-signal.md`). A **condition** is the schedule's name
// for a standing problem. Raising it again updates the open record; the schedule
// `resolve`s it when it clears.
//
// The priority decides delivery: only `important` pops up. `normal` and `fyi`
// wait for the daily digest.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { any, capture, not, str } from "@ianbicking/tap-check/check";
import { execa } from "execa";
import { raiseAlert, type DesktopNotification, type RunnerDeps } from "../../lib/schedules-alerts.js";
import { migrateAlerts, resolveConditions } from "../../lib/schedules-alert-lifecycle.js";
import { readAlerts } from "../../lib/schedules-store.js";
import { binTsArgs } from "../../lib/bin-ts.js";

const storeRoot = join(await mkdtemp(join(tmpdir(), "alert-conditions-")), "store");
await mkdir(storeRoot, { recursive: true });
await writeFile(join(storeRoot, ".schedule-runs"), "");

let clock = Date.parse("2026-09-18T02:05:00Z");
const popups: DesktopNotification[] = [];
const deps: RunnerDeps = {
  storeRoot,
  schedulesRoot: storeRoot,
  repoRoot: storeRoot,
  mainRoot: storeRoot,
  now: () => new Date(clock),
  pid: process.pid,
  isProcessAlive: () => false,
  bootTimeMs: () => null,
  notify: async (notification) => { popups.push(notification); },
};

function raise(over: { condition: string | null; priority: "important" | "normal" | "fyi"; message?: string }) {
  clock += 3600_000;
  return raiseAlert(deps, {
    workstream: "full-suite",
    runId: null,
    title: "full suite: red, no attributable landing",
    message: over.message ?? "1 file failing",
    details: null,
    priority: over.priority,
    condition: over.condition,
  });
}

// ## Only important pops up
void test("Only important pops up", async (t) => {
  await raise({ condition: null, priority: "fyi" });
  await raise({ condition: null, priority: "normal" });
  t.check(popups, []);

  const popupId = capture(any(String));
  await raise({ condition: null, priority: "important" });
  t.check(popups, [{
    title: "important · full-suite: full suite: red, no attributable landing",
    message: "1 file failing",
    group: str`schedule-${popupId}`,
    destination: str`http://localhost:3210/workstreams/alerts?alert=${popupId}`,
  }]);

  // ## A repeated condition updates one record
  //
  // The same condition three hours running is one record with a count, carrying the
  // latest words. The file set changed between runs; that goes in the message, not
  // the key, so the condition stays one condition.

  const first = await raise({ condition: "red-unattributed", priority: "normal", message: "a.test.ts failing" });
  await raise({ condition: "red-unattributed", priority: "normal", message: "a.test.ts, b.test.ts failing" });
  const third = await raise({ condition: "red-unattributed", priority: "normal", message: "b.test.ts failing" });
  const standing = (await readAlerts(storeRoot, "full-suite")).filter((alert) => alert.condition === "red-unattributed");
  t.check(standing, [third]);
  t.check(third, {
    id: first.id,
    workstream: "full-suite",
    runId: null,
    title: "full suite: red, no attributable landing",
    message: "b.test.ts failing",
    details: null,
    priority: "normal",
    createdAt: first.createdAt,
    state: "open",
    acknowledgedAt: null,
    closedBy: null,
    condition: "red-unattributed",
    lastSeenAt: new Date(clock).toISOString(),
    occurrences: 3,
    digestedAt: null,
    issue: null,
    filingFailedSince: null,
    filingError: null,
  });

  // `createdAt` stays the first sighting — it is what the 7-day filing clock reads —
  // while `lastSeenAt` moves.

  t.check(first.lastSeenAt, first.createdAt);

  // ## Rising to important pops up once
  //
  // A condition that becomes `important` is announced; staying `important` is not
  // announced again.

  popups.length = 0;
  await raise({ condition: "red-unattributed", priority: "important" });
  await raise({ condition: "red-unattributed", priority: "important" });
  t.check(popups, [{
    title: "important · full-suite: full suite: red, no attributable landing",
    message: "1 file failing",
    group: str`schedule-${any(String)}`,
    destination: str`http://localhost:3210/workstreams/alerts?alert=${any(String)}`,
  }]);

  // ## Resolve closes conditions, never one-offs
  //
  // `--except` is the end-of-run form: everything this run did not report has
  // cleared. A one-off alert (no condition) is left for a person.

  await raise({ condition: "timeout", priority: "normal" });
  const closed = await resolveConditions(storeRoot, {
    workstream: "full-suite", conditions: [], except: ["timeout"], at: new Date(clock).toISOString(),
  });
  const after = await readAlerts(storeRoot, "full-suite");
  const summary = {
    closed: closed.map((alert) => alert.condition),
    stillOpen: after.filter((alert) => alert.state === "open").map((alert) => alert.condition),
    closedBy: after.find((alert) => alert.condition === "red-unattributed")?.closedBy,
  };
  t.check(summary, {
    closed: [
      "red-unattributed",
    ],
    stillOpen: [
      null,
      null,
      null,
      "timeout",
    ],
    closedBy: "schedule",
  });

  // A condition raised again after it was resolved is a new record: the old one is
  // history.

  const again = await raise({ condition: "red-unattributed", priority: "normal" });
  t.check(again.id, not(third.id));

  // ## The CLI keeps every repeated --except
  //
  // `flags()` keeps the last value of a repeated flag, so `resolve` reads them
  // separately. Dropping one would close a condition that is still current.

  const env = { ...process.env, BBX_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "full-suite", SCHEDULE_NOTIFY: "0" };
  await raise({ condition: "flakes", priority: "fyi" });
  await execa(process.execPath, binTsArgs("bin/schedules.ts", ["resolve", "--except", "timeout", "--except", "flakes"]), { env });
  const openConditions = (await readAlerts(storeRoot, "full-suite")).filter((alert) => alert.state === "open" && alert.condition !== null);
  t.check(openConditions.map((alert) => alert.condition).toSorted(), [
    "flakes",
    "timeout",
  ]);

  // `--priority backlog` is refused by name: the scale lost that level.

  const refused = await execa(process.execPath, binTsArgs("bin/schedules.ts", ["alert", "--title", "t", "--message", "m", "--run", "20260918-000000", "--priority", "backlog"]), { env, reject: false });
  t.check(refused.stderr, "schedules: --priority must be important|normal|fyi, got 'backlog'");

  // ## Migration rewrites legacy records and closes the open ones
  //
  // Records written before conditions have no `condition`, `closedBy`, and so on;
  // the strict reader throws on them. The migration reads raw JSON, rewrites each
  // one, and closes every open record — the boxholder chose to start clean.
  // `backlog` becomes `fyi`. A second run changes nothing.

  const legacyDir = join(storeRoot, "box-convergence", "alerts");
  await mkdir(legacyDir, { recursive: true });
  const legacy = ({ id, state, priority }: { id: string; state: "open" | "acknowledged"; priority: string }) => ({
    id, workstream: "box-convergence", runId: null, title: "Box convergence needs attention", message: "m",
    details: null, priority, createdAt: "2026-09-16T00:00:00.000Z", state,
    acknowledgedAt: state === "open" ? null : "2026-09-17T00:00:00.000Z",
  });
  await writeFile(join(legacyDir, "20260916-000000-aaaa.json"), JSON.stringify(legacy({ id: "20260916-000000-aaaa", state: "open", priority: "important" })));
  await writeFile(join(legacyDir, "20260916-000000-bbbb.json"), JSON.stringify(legacy({ id: "20260916-000000-bbbb", state: "acknowledged", priority: "backlog" })));
  await assert.rejects(readAlerts(storeRoot, "box-convergence"));
  const counts = [await migrateAlerts(storeRoot, "2026-09-19T09:00:00.000Z"), await migrateAlerts(storeRoot, "2026-09-19T10:00:00.000Z")];
  const migrated = await readAlerts(storeRoot, "box-convergence");
  t.check({ counts, rows: migrated.map((alert) => [alert.state, alert.priority, alert.acknowledgedAt, alert.closedBy]) }, {
    counts: [
      2,
      0,
    ],
    rows: [
      [
        "acknowledged",
        "important",
        "2026-09-19T09:00:00.000Z",
        "person",
      ],
      [
        "acknowledged",
        "fyi",
        "2026-09-17T00:00:00.000Z",
        "person",
      ],
    ],
  });
});
