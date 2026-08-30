# Scheduled workstreams in the browser

A schedule is sticky and gets its own inventory section — worktree or not, live
session or not. The section carries the scheduler's own heartbeat, because a
list of schedules whose scheduler died is the failure the design exists to make
visible. Alerts are read and acknowledged through `bin/schedules`; the app never
writes the schedule store.

Design: `beebox/docs/plans/scheduled-workstreams.md` (Track D).

```ts setup
import * as React from "react";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterContextProvider, createMemoryHistory } from "@tanstack/react-router";

Object.assign(globalThis, { React });

import { ScheduleAlertList } from "../src/frontend/components/ScheduleAlerts.js";
import { ScheduledSection, scheduleHeartbeatStatus } from "../src/frontend/components/ScheduledWorkstreams.js";
import { workstreamActionVerbs } from "../src/frontend/components/WorkstreamActions.js";
import { workstreamStateFor } from "../src/frontend/pages/WorkstreamsPage.js";
import { createSchedulesCommandService } from "../src/server/schedules-command.js";
import type { CommandRequest } from "../src/server/workstreams-command.js";
import type { ScheduleAlert } from "../src/shared/schedules.js";
import { router } from "../src/frontend/router.js";
import { WorkstreamsApiProvider } from "../src/frontend/trpc.js";
import type { Workstream } from "../src/frontend/types.js";

// A row links to its detail page, and TanStack's <Link> needs a router in
// context to build an href; the routes themselves are not exercised here. The
// lifecycle buttons read the tRPC client from context, so the section renders
// under the real provider — no request is issued by a static render.
router.update({ history: createMemoryHistory({ initialEntries: ["/"] }) });
const render = (element: ReactElement): string =>
  renderToStaticMarkup(createElement(WorkstreamsApiProvider, null,
    createElement(RouterContextProvider, { router }, element)));

const now = new Date("2026-08-24T12:00:00.000Z");

function scheduleRow(overrides: Partial<NonNullable<Workstream["schedule"]>>): NonNullable<Workstream["schedule"]> {
  return {
    cadence: "7d",
    enabled: true,
    lastRunAt: "2026-08-17T12:00:00.000Z",
    lastOutcome: "clean",
    overdue: false,
    nextDueAt: "2026-08-24T12:00:00.000Z",
    openAlerts: 0,
    heartbeat: { lastTickAt: "2026-08-24T11:50:00.000Z" },
    ...overrides,
  };
}

function row(name: string, schedule: Workstream["schedule"], routingState: Workstream["routing"]["state"]): Workstream {
  return {
    name,
    branch: `worktree-${name}`,
    url: null,
    git: null,
    runtime: { state: "absent" },
    agent: { state: routingState === "live" ? "live" : "none", reason: "" },
    session: {
      agent: "claude",
      hasSession: false,
      tty: null,
      emoji: null,
      baseSha: null,
      removed: null,
      archived: null,
      description: "Weekly knip sweep",
      launch: { state: "none", startedAt: null, expiresAt: null, failedAt: null, reason: null },
    },
    routing: { state: routingState, action: "resume-with-briefing", lastActivityAt: null },
    boxState: { testSetup: false, keepUnmerged: false, pristine: null },
    schedule,
  };
}

function alert(overrides: Partial<ScheduleAlert>): ScheduleAlert {
  return {
    id: "20260824-115000-ab12",
    workstream: "knip-sweep",
    runId: "20260824-115000",
    title: "12 new unused exports",
    message: "The weekly sweep found new findings.",
    details: "## Findings\n\n- `src/a.ts` export `foo`\n",
    priority: "normal",
    createdAt: "2026-08-24T11:50:00.000Z",
    state: "open",
    acknowledgedAt: null,
    ...overrides,
  };
}
```

## Every schedule lands in the Scheduled section

A scheduled record resting between runs and a schedule whose run currently has
a live session both belong here — the boxholder asked for one place to look, not
a row that migrates into "In progress" whenever a run is under way.

```ts
JSON.stringify({
  resting: workstreamStateFor(row("knip-sweep", scheduleRow({}), "scheduled")).section,
  live: workstreamStateFor(row("manual-tests", scheduleRow({}), "live")).section,
  overdueNote: workstreamStateFor(row("sdk-update", scheduleRow({ overdue: true }), "scheduled")).note,
  ordinary: workstreamStateFor(row("some-feature", null, "live")).section,
})
=> {"resting":"Scheduled","live":"Scheduled","overdueNote":"overdue","ordinary":"In progress"}
```

## The section shows cadence, outcome, overdue, and open alerts

```ts
const markup = render(createElement(ScheduledSection, {
  rows: [
    row("knip-sweep", scheduleRow({ overdue: true, openAlerts: 2 }), "scheduled"),
    row("sdk-update", scheduleRow({ enabled: false }), "scheduled"),
  ],
  issues: [],
  now,
}));
JSON.stringify({
  named: markup.includes("knip-sweep") && markup.includes("Weekly knip sweep"),
  cadence: markup.includes("every 7d"),
  lastRun: markup.includes("last run") && markup.includes("1 week ago") && markup.includes("clean"),
  overdueBadge: markup.includes(">overdue<"),
  alertCount: markup.includes("open alert"),
  disabled: markup.includes(">disabled<"),
  heartbeat: markup.includes("scheduler: last tick 10 minutes ago"),
  heartbeatCalm: !markup.includes("schedule-heartbeat-stale"),
})
=> {"named":true,"cadence":true,"lastRun":true,"overdueBadge":true,"alertCount":true,"disabled":true,"heartbeat":true,"heartbeatCalm":true}
```

## A resting schedule offers Resume, a running one Focus

The boxholder's way into a schedule is to go into the workstream and chat, so a
scheduled record between runs gets the same Resume the dormant and culled rows
get — `bin/workstreams resume` recreates the worktree and launches, with the
optional briefing the record's `resume-with-briefing` routing already names. A
schedule whose run is under way gets Focus like any live row, and the Alerts
toggle stays either way.

```ts
const resting = render(createElement(ScheduledSection, {
  rows: [row("knip-sweep", scheduleRow({}), "scheduled")],
  issues: [],
  now,
}));
const running = render(createElement(ScheduledSection, {
  rows: [row("manual-tests", scheduleRow({}), "live")],
  issues: [],
  now,
}));
JSON.stringify({
  restingVerbs: workstreamActionVerbs(row("knip-sweep", scheduleRow({}), "scheduled")),
  runningVerbs: workstreamActionVerbs(row("manual-tests", scheduleRow({}), "live")),
  restingResume: resting.includes(">Resume</button>"),
  restingNotFocus: !resting.includes(">Focus</button>"),
  runningFocus: running.includes(">Focus</button>"),
  runningNotResume: !running.includes(">Resume</button>"),
  alertsBoth: resting.includes(">Alerts</button>") && running.includes(">Alerts</button>"),
})
=> {"restingVerbs":["resume"],"runningVerbs":["focus"],"restingResume":true,"restingNotFocus":true,"runningFocus":true,"runningNotResume":true,"alertsBoth":true}
```

## A dead scheduler is red, and a scheduler that never ticked says so

An hour without a tick is a dead scheduler, not a quiet one; no heartbeat at
all on any row means nothing has ever run the tick.

```ts
const stale = scheduleHeartbeatStatus([row("knip-sweep", scheduleRow({ heartbeat: { lastTickAt: "2026-08-24T09:00:00.000Z" } }), "scheduled")], now);
const never = scheduleHeartbeatStatus([row("knip-sweep", scheduleRow({ heartbeat: null }), "scheduled")], now);
const staleMarkup = render(createElement(ScheduledSection, {
  rows: [row("knip-sweep", scheduleRow({ heartbeat: null }), "scheduled")],
  issues: [],
  now,
}));
JSON.stringify({
  staleText: stale.text,
  staleFlag: stale.stale,
  neverText: never.text,
  neverFlag: never.stale,
  neverIsRed: staleMarkup.includes("schedule-heartbeat-stale") && staleMarkup.includes("scheduler never ticked"),
})
=> {"staleText":"scheduler: last tick 3 hours ago","staleFlag":true,"neverText":"scheduler never ticked","neverFlag":true,"neverIsRed":true}
```

## Alerts render their details as Markdown, acknowledged ones fold away

```ts
const alerts = renderToStaticMarkup(createElement(ScheduleAlertList, {
  alerts: [
    alert({}),
    alert({ id: "20260810-090000-cd34", title: "Docling 2.4 settled", state: "acknowledged", acknowledgedAt: "2026-08-11T09:00:00.000Z" }),
  ],
  acknowledging: null,
  error: null,
  onAcknowledge: () => undefined,
}));
JSON.stringify({
  title: alerts.includes("12 new unused exports"),
  priority: alerts.includes(">normal<"),
  markdownDetails: alerts.includes("<h2>Findings</h2>") && alerts.includes("<code>src/a.ts</code>"),
  acknowledgeButton: alerts.includes("Acknowledge</button>"),
  foldedAcknowledged: alerts.includes("<details") && alerts.includes("Docling 2.4 settled"),
  openCount: alerts.includes("1 open"),
})
=> {"title":true,"priority":true,"markdownDetails":true,"acknowledgeButton":true,"foldedAcknowledged":true,"openCount":true}
```

## Reading and acknowledging go through `bin/schedules`

The store has one writer. Acknowledging is `bin/schedules ack <id>`, and the
next read reflects it — the app holds no alert state of its own.

```ts
const store = new Map<string, ScheduleAlert>([[alert({}).id, alert({})]]);
const calls: string[][] = [];
const service = createSchedulesCommandService({
  repoRoot: "/repo",
  commandRunner: async (request: CommandRequest) => {
    calls.push(request.args);
    if (request.args[0] === "ack") {
      const target = store.get(request.args[1] ?? "");
      if (target) store.set(target.id, { ...target, state: "acknowledged", acknowledgedAt: "2026-08-24T12:00:00.000Z" });
      return { stdout: "", stderr: "" };
    }
    return { stdout: JSON.stringify({ alerts: [...store.values()] }), stderr: "" };
  },
});
const before = await service.alerts("knip-sweep");
await service.acknowledge(alert({}).id);
const after = await service.alerts("knip-sweep");
JSON.stringify({
  calls,
  beforeState: before.map((entry) => entry.state),
  afterState: after.map((entry) => entry.state),
})
=> {"calls":[["alerts","--json","--workstream","knip-sweep"],["ack","20260824-115000-ab12"],["alerts","--json","--workstream","knip-sweep"]],"beforeState":["open"],"afterState":["acknowledged"]}
```

A record the CLI would never have written is a refusal, not a half-rendered
panel: the browser shows the error state instead of guessing.

```ts
const broken = createSchedulesCommandService({
  repoRoot: "/repo",
  commandRunner: async () => ({ stdout: JSON.stringify({ alerts: [{ ...alert({}), priority: "urgent" }] }), stderr: "" }),
});
const failed = createSchedulesCommandService({
  repoRoot: "/repo",
  commandRunner: () => Promise.reject(new Error("bin/schedules: no such schedule")),
});
const message = async (service: { alerts(name: string | null): Promise<unknown> }) =>
  service.alerts(null).then(() => "no error", (error: Error) => error.message);
JSON.stringify([await message(broken), await message(failed)])
=> ["Invalid alert record: priority","bin/schedules failed: alerts: bin/schedules: no such schedule"]
```
