# Schedule alert digest and filing (bin/lib/schedules-digest.ts, schedules-filing.ts)

The boxholder deals with schedules once a day. Only `important` pops up when
it is raised; everything else waits for one daily popup that summarises all
schedules (`docs/plans/schedule-alert-signal.md`). A condition that stays open
for a week is filed as a private issue instead of repeating — nothing retries
forever.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Alert } from "../../../bin/lib/schedules.js";
import type { DesktopNotification, RunnerDeps } from "../../../bin/lib/schedules-alerts.js";
import { digestDue, digestIfDue, digestPlan } from "../../../bin/lib/schedules-digest.js";
import { fileStanding, renderStandingIssue, standingToFile } from "../../../bin/lib/schedules-filing.js";
import { readAllAlerts, writeAlert } from "../../../bin/lib/schedules-store.js";

const DAY = 24 * 3600_000;
/** Local wall-clock time on 2026-09-<day>: the digest hour is local. */
const local = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute);

let serial = 0;
function alert(over: Partial<Alert>): Alert {
  serial += 1;
  const at = local(18, 3).toISOString();
  return {
    id: `20260918-030000-${String(serial).padStart(4, "0")}`,
    workstream: "full-suite", runId: null, title: "t", message: "m", details: null,
    priority: "normal", createdAt: at, state: "open", acknowledgedAt: null, closedBy: null,
    condition: null, lastSeenAt: at, occurrences: 1, digestedAt: null, issue: null,
    filingFailedSince: null, filingError: null,
    ...over,
  };
}
```

## Due once a day, at or after 09:00 local

Before nine it waits; after nine it runs once; a laptop asleep all morning
sends it at the first tick after waking.

```ts
const yesterday = local(18, 9, 5).toISOString();
JSON.stringify([
  digestDue(local(19, 8, 59), yesterday),
  digestDue(local(19, 9, 0), yesterday),
  digestDue(local(19, 9, 15), local(19, 9, 0).toISOString()),
  digestDue(local(19, 16, 40), yesterday),
  digestDue(local(19, 10), null),
])
=> [false,true,false,true,true]
```

## What one digest lists

Every open `important` (it stays urgent until closed), `normal` alerts seen
since the last digest, and each `fyi` once. An `fyi` an earlier digest already
listed is closed now.

```ts continue
const since = local(18, 9).toISOString();
const plan = digestPlan([
  alert({ priority: "important", lastSeenAt: local(17, 3).toISOString() }),
  alert({ priority: "normal", lastSeenAt: local(18, 12).toISOString() }),
  alert({ priority: "normal", lastSeenAt: local(18, 8).toISOString() }),
  alert({ priority: "fyi" }),
  alert({ priority: "fyi", digestedAt: since }),
  alert({ priority: "normal", state: "acknowledged", closedBy: "person" }),
], { now: local(19, 9), lastDigestAt: since });
JSON.stringify({ popup: plan.popup, listed: plan.listed.map((a) => a.priority), closing: plan.closing.length })
=> {"popup":{"title":"Schedules: 1 important · 1 normal · 1 fyi","message":"Open the alerts page to review."},"listed":["important","normal","fyi"],"closing":1}
```

Nothing new means no popup; the stamp still moves.

```ts continue
digestPlan([alert({ priority: "normal", lastSeenAt: local(17, 3).toISOString() })], { now: local(19, 9), lastDigestAt: since }).popup
=> null
```

## One tick's digest writes the records and one popup

```ts continue
const storeRoot = join(await mkdtemp(join(tmpdir(), "alert-digest-")), "store");
await mkdir(join(storeRoot, "full-suite", "alerts"), { recursive: true });
await mkdir(join(storeRoot, "sdk-update", "alerts"), { recursive: true });
await writeFile(join(storeRoot, ".schedule-runs"), "");
await writeAlert(storeRoot, alert({ priority: "fyi", workstream: "sdk-update", title: "Pin at 0.3.273" }));
await writeAlert(storeRoot, alert({ priority: "normal", condition: "red-unattributed" }));
let clock = local(19, 9, 5);
const popups: DesktopNotification[] = [];
const deps: RunnerDeps = {
  storeRoot, schedulesRoot: storeRoot, repoRoot: storeRoot, mainRoot: storeRoot,
  now: () => clock, pid: process.pid, isProcessAlive: () => false, bootTimeMs: () => null,
  notify: async (notification) => { popups.push(notification); },
};
const ran = [await digestIfDue(deps), await digestIfDue(deps)];
JSON.stringify({ ran, popups: popups.map((p) => [p.title, p.destination]) })
=> {"ran":[true,false],"popups":[["Schedules: 1 normal · 1 fyi","http://localhost:3210/workstreams/alerts"]]}
```

The next day's digest closes the fyi, labelled as closed by the digest rather
than by a person.

```ts continue
clock = local(20, 9, 5);
await digestIfDue(deps);
const pin = (await readAllAlerts(storeRoot)).find((a) => a.title === "Pin at 0.3.273");
JSON.stringify([pin?.state, pin?.closedBy])
=> ["acknowledged","digest"]
```

## A week-old condition is filed; its failures stop after another week

Only open, conditioned, non-`fyi` alerts a week old are filed — `createdAt`
is the first sighting, so repeats do not reset the clock. A filing that has
failed for a week is given up on and stays open for a person.

```ts continue
const now = local(26, 10).getTime();
const due = standingToFile([
  alert({ condition: "unconverged", createdAt: new Date(now - 8 * DAY).toISOString() }),
  alert({ condition: "unconverged", createdAt: new Date(now - 6 * DAY).toISOString() }),
  alert({ condition: null, createdAt: new Date(now - 8 * DAY).toISOString() }),
  alert({ condition: "flakes", priority: "fyi", createdAt: new Date(now - 8 * DAY).toISOString() }),
  alert({ condition: "gave-up", createdAt: new Date(now - 20 * DAY).toISOString(), filingFailedSince: new Date(now - 8 * DAY).toISOString() }),
  alert({ condition: "retrying", createdAt: new Date(now - 10 * DAY).toISOString(), filingFailedSince: new Date(now - 2 * DAY).toISOString() }),
], now);
JSON.stringify(due.map((a) => a.condition))
=> ["unconverged","retrying"]
```

The issue is private and says what the record knows. The title is quoted so a
colon or quote in an alert title cannot break the frontmatter.

```ts continue
const rendered = renderStandingIssue(alert({
  workstream: "box-convergence", condition: "unconverged", title: 'Box convergence: "needs-procedure"',
  occurrences: 9, createdAt: "2026-09-16T00:54:26.922Z", message: "- box a: needs-procedure",
}), "2026-09-23");
rendered.relPath
=> bugs/2026-09-23-schedule-box-convergence-unconverged.md
```

```ts continue
rendered.text.split("\n").slice(0, 10).join("\n")
=> ---
title: "box-convergence: Box convergence: \"needs-procedure\" (standing since 2026-09-16)"
workstream: unattached
area: router
labels: [schedules]
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: main — schedule box-convergence, condition unconverged
---
```

Filing records the outcome on the alert: the issue path on success, the first
failure time and the reason otherwise. A second failure keeps the first time,
which is what the one-week bound reads. (The `red-unattributed` condition from
the digest section is eight days old by now, so it is filed too.)

```ts continue
await writeAlert(storeRoot, alert({ id: "20260918-030000-aaaa", condition: "unconverged", createdAt: new Date(now - 8 * DAY).toISOString() }));
await writeAlert(storeRoot, alert({ id: "20260918-030000-bbbb", condition: "timeout", createdAt: new Date(now - 8 * DAY).toISOString() }));
const committed: string[] = [];
const outcome = await fileStanding(storeRoot, {
  now: new Date(now),
  commitIssue: async (issue) => {
    if (issue.relPath.includes("timeout")) throw new Error("private-issues is not mounted");
    committed.push(issue.relPath);
  },
});
const second = await fileStanding(storeRoot, { now: new Date(now + DAY), commitIssue: async () => { throw new Error("still not mounted"); } });
const records = await readAllAlerts(storeRoot);
const byId = (id: string) => records.find((a) => a.id === id);
JSON.stringify({
  committed,
  filed: byId("20260918-030000-aaaa")?.issue,
  failedSince: byId("20260918-030000-bbbb")?.filingFailedSince === new Date(now).toISOString(),
  error: byId("20260918-030000-bbbb")?.filingError,
  secondRound: second.failed.map((a) => a.condition),
})
=> {"committed":["bugs/2026-09-26-schedule-full-suite-red-unattributed.md","bugs/2026-09-26-schedule-full-suite-unconverged.md"],"filed":"private-issues/bugs/2026-09-26-schedule-full-suite-unconverged.md","failedSince":true,"error":"still not mounted","secondRound":["timeout"]}
```
