# Schedule alert conditions (bin/lib/schedules-alerts.ts, schedules-alert-lifecycle.ts)

A schedule that finds the same thing every hour used to add a record every
hour, and nothing ever closed them: the store held sixty open alerts, most of
them stale, and a new one did not stand out
(`docs/plans/schedule-alert-signal.md`). A **condition** is the schedule's name
for a standing problem. Raising it again updates the open record; the schedule
`resolve`s it when it clears.

The priority decides delivery: only `important` pops up. `normal` and `fyi`
wait for the daily digest.

```ts setup
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import { raiseAlert, type DesktopNotification, type RunnerDeps } from "../../../bin/lib/schedules-alerts.js";
import { migrateAlerts, resolveConditions } from "../../../bin/lib/schedules-alert-lifecycle.js";
import { readAlerts } from "../../../bin/lib/schedules-store.js";

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
```

## Only important pops up

```ts
await raise({ condition: null, priority: "fyi" });
await raise({ condition: null, priority: "normal" });
popups.length
=> 0
```

```ts continue
await raise({ condition: null, priority: "important" });
JSON.stringify(popups.map((popup) => popup.title))
=> ["important · full-suite: full suite: red, no attributable landing"]
```

## A repeated condition updates one record

The same condition three hours running is one record with a count, carrying the
latest words. The file set changed between runs; that goes in the message, not
the key, so the condition stays one condition.

```ts continue
const first = await raise({ condition: "red-unattributed", priority: "normal", message: "a.doctest.md failing" });
await raise({ condition: "red-unattributed", priority: "normal", message: "a.doctest.md, b.doctest.md failing" });
const third = await raise({ condition: "red-unattributed", priority: "normal", message: "b.doctest.md failing" });
const standing = (await readAlerts(storeRoot, "full-suite")).filter((alert) => alert.condition === "red-unattributed");
JSON.stringify({ records: standing.length, sameId: third.id === first.id, occurrences: third.occurrences, message: third.message })
=> {"records":1,"sameId":true,"occurrences":3,"message":"b.doctest.md failing"}
```

`createdAt` stays the first sighting — it is what the 7-day filing clock reads —
while `lastSeenAt` moves.

```ts continue
third.createdAt === first.createdAt && third.lastSeenAt > first.lastSeenAt
=> true
```

## Rising to important pops up once

A condition that becomes `important` is announced; staying `important` is not
announced again.

```ts continue
popups.length = 0;
await raise({ condition: "red-unattributed", priority: "important" });
await raise({ condition: "red-unattributed", priority: "important" });
popups.length
=> 1
```

## Resolve closes conditions, never one-offs

`--except` is the end-of-run form: everything this run did not report has
cleared. A one-off alert (no condition) is left for a person.

```ts continue
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
JSON.stringify(summary)
=> {"closed":["red-unattributed"],"stillOpen":[null,null,null,"timeout"],"closedBy":"schedule"}
```

A condition raised again after it was resolved is a new record: the old one is
history.

```ts continue
const again = await raise({ condition: "red-unattributed", priority: "normal" });
again.id === third.id
=> false
```

## The CLI keeps every repeated --except

`flags()` keeps the last value of a repeated flag, so `resolve` reads them
separately. Dropping one would close a condition that is still current.

```ts continue
const env = { ...process.env, BBX_SCHEDULES_ROOT: storeRoot, SCHEDULE_NAME: "full-suite", SCHEDULE_NOTIFY: "0" };
await raise({ condition: "flakes", priority: "fyi" });
await execa("node", ["--import", "tsx", "../bin/schedules.ts", "resolve", "--except", "timeout", "--except", "flakes"], { env });
const openConditions = (await readAlerts(storeRoot, "full-suite")).filter((alert) => alert.state === "open" && alert.condition !== null);
JSON.stringify(openConditions.map((alert) => alert.condition).toSorted())
=> ["flakes","timeout"]
```

`--priority backlog` is refused by name: the scale lost that level.

```ts continue
const refused = await execa("node", ["--import", "tsx", "../bin/schedules.ts", "alert", "--title", "t", "--message", "m", "--run", "20260918-000000", "--priority", "backlog"], { env, reject: false });
refused.stderr.includes("--priority must be important|normal|fyi")
=> true
```

## Migration rewrites legacy records and closes the open ones

Records written before conditions have no `condition`, `closedBy`, and so on;
the strict reader throws on them. The migration reads raw JSON, rewrites each
one, and closes every open record — the boxholder chose to start clean.
`backlog` becomes `fyi`. A second run changes nothing.

```ts continue
const legacyDir = join(storeRoot, "box-convergence", "alerts");
await mkdir(legacyDir, { recursive: true });
const legacy = (id: string, state: "open" | "acknowledged", priority: string) => ({
  id, workstream: "box-convergence", runId: null, title: "Box convergence needs attention", message: "m",
  details: null, priority, createdAt: "2026-09-16T00:00:00.000Z", state,
  acknowledgedAt: state === "open" ? null : "2026-09-17T00:00:00.000Z",
});
await writeFile(join(legacyDir, "20260916-000000-aaaa.json"), JSON.stringify(legacy("20260916-000000-aaaa", "open", "important")));
await writeFile(join(legacyDir, "20260916-000000-bbbb.json"), JSON.stringify(legacy("20260916-000000-bbbb", "acknowledged", "backlog")));
await assert.rejects(readAlerts(storeRoot, "box-convergence"));
const counts = [await migrateAlerts(storeRoot, "2026-09-19T09:00:00.000Z"), await migrateAlerts(storeRoot, "2026-09-19T10:00:00.000Z")];
const migrated = await readAlerts(storeRoot, "box-convergence");
JSON.stringify({ counts, rows: migrated.map((alert) => [alert.state, alert.priority, alert.acknowledgedAt, alert.closedBy]) })
=> {"counts":[2,0],"rows":[["acknowledged","important","2026-09-19T09:00:00.000Z","person"],["acknowledged","fyi","2026-09-17T00:00:00.000Z","person"]]}
```
