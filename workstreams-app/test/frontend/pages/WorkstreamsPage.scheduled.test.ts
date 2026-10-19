// # Scheduled workstreams in the browser
//
// A schedule is sticky and gets its own inventory section — worktree or not, live
// session or not. The section carries the scheduler's own heartbeat, because a
// list of schedules whose scheduler died is the failure the design exists to make
// visible. Alerts are read and acknowledged through `bin/schedules`; the app never
// writes the schedule store.
//
// Design: `beebox/docs/plans/scheduled-workstreams.md` (Track D).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterContextProvider, createMemoryHistory } from "@tanstack/react-router";
import { ScheduleAlertList } from "../../../src/frontend/components/ScheduleAlerts.js";
import { ScheduledSection, scheduleHeartbeatStatus } from "../../../src/frontend/components/ScheduledWorkstreams.js";
import { workstreamActionVerbs } from "../../../src/frontend/components/WorkstreamActions.js";
import { workstreamStateFor } from "../../../src/frontend/pages/WorkstreamsPage.js";
import { createSchedulesCommandService } from "../../../src/server/main/schedules-command.js";
import type { CommandRequest } from "../../../src/server/main/workstreams-command.js";
import type { ScheduleAlert } from "../../../src/shared/schedules.js";
import { router } from "../../../src/frontend/main/router.js";
import { WorkstreamsApiProvider } from "../../../src/frontend/trpc.js";
import type { Workstream, WorkstreamListItem } from "../../../src/frontend/types.js";

Object.assign(globalThis, { React });

// A row links to its detail page, and TanStack's <Link> needs a router in
// context to build an href; the routes themselves are not exercised here. The
// lifecycle buttons read the tRPC client from context, so the section renders
// under the real provider — no request is issued by a static render.
router.update({ history: createMemoryHistory({ initialEntries: ["/"] }) });
const render = (element: ReactElement): string =>
  renderToStaticMarkup(createElement(WorkstreamsApiProvider, null,
    createElement(RouterContextProvider, { router, children: element })));

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

interface RowOptions {
  name: string;
  schedule: Workstream["schedule"];
  routingState: Workstream["routing"]["state"];
}

function row({ name, schedule, routingState }: RowOptions): WorkstreamListItem {
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
      baseSha: null,
      removed: null,
      archived: null,
      description: "Weekly knip sweep",
      launch: { state: "none", startedAt: null, expiresAt: null, failedAt: null, reason: null },
    },
    routing: { state: routingState, action: "resume-with-briefing", lastActivityAt: null },
    boxState: { testSetup: false, keepUnmerged: false, pristine: null },
    schedule,
    exhibits: [],
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
    closedBy: null,
    condition: null,
    lastSeenAt: "2026-08-24T11:50:00.000Z",
    occurrences: 1,
    digestedAt: null,
    issue: null,
    filingFailedSince: null,
    filingError: null,
    ...overrides,
  };
}

// ## Every schedule lands in the Scheduled section
//
// A scheduled record resting between runs and a schedule whose run currently has
// a live session both belong here — the boxholder asked for one place to look, not
// a row that migrates into "In progress" whenever a run is under way.
void test("A scheduled record resting between runs and a schedule whose run currently ha...", async (t) => {
  t.check(
    {
      resting: workstreamStateFor(row({ name: "knip-sweep", schedule: scheduleRow({}), routingState: "scheduled" })).section,
      live: workstreamStateFor(row({ name: "manual-tests", schedule: scheduleRow({}), routingState: "live" })).section,
      overdueNote: workstreamStateFor(row({ name: "sdk-update", schedule: scheduleRow({ overdue: true }), routingState: "scheduled" })).note,
      ordinary: workstreamStateFor(row({ name: "some-feature", schedule: null, routingState: "live" })).section,
    },
    {
    resting: "Scheduled",
    live: "Scheduled",
    overdueNote: "overdue",
    ordinary: "In progress",
  },
  );
});

// ## The section shows cadence, outcome, overdue, and open alerts
void test("The section shows cadence, outcome, overdue, and open alerts", async (t) => {
  const markup = render(createElement(ScheduledSection, {
    rows: [
      row({ name: "knip-sweep", schedule: scheduleRow({ overdue: true, openAlerts: 2 }), routingState: "scheduled" }),
      row({ name: "sdk-update", schedule: scheduleRow({ enabled: false }), routingState: "scheduled" }),
    ],
    issues: [],
    exhibitsOrigin: "http://127.0.0.1:3230",
    now,
  }));
  t.check(
    {
      named: markup.includes("knip-sweep") && markup.includes("Weekly knip sweep"),
      cadence: markup.includes("every 7d"),
      lastRun: markup.includes("last run") && markup.includes("1 week ago") && markup.includes("clean"),
      overdueBadge: markup.includes(">overdue<"),
      alertCount: markup.includes("open alert"),
      disabled: markup.includes(">disabled<"),
      heartbeat: markup.includes("scheduler: last tick 10 minutes ago"),
      heartbeatCalm: !markup.includes("schedule-heartbeat-stale"),
    },
    {
    named: true,
    cadence: true,
    lastRun: true,
    overdueBadge: true,
    alertCount: true,
    disabled: true,
    heartbeat: true,
    heartbeatCalm: true,
  },
  );
});

// ## A scheduled row with an exhibit links to it
void test("A scheduled row with an exhibit links to it", async (t) => {
  const withExhibit = render(createElement(ScheduledSection, {
    rows: [{
      ...row({ name: "knip-sweep", schedule: scheduleRow({}), routingState: "scheduled" }),
      exhibits: [{ workstream: "knip-sweep", slug: "report", path: "/knip-sweep/report/", title: "Sweep report", created: "2026-08-23T00:00:00Z", problem: null }],
    }],
    issues: [],
    exhibitsOrigin: "http://127.0.0.1:3230",
    now,
  }));
  t.check(
    {
      link: withExhibit.includes('href="http://127.0.0.1:3230/knip-sweep/report/"') && withExhibit.includes("Sweep report"),
      all: withExhibit.includes('href="http://127.0.0.1:3230/knip-sweep/"'),
    },
    {
    link: true,
    all: true,
  },
  );
});

// ## A resting schedule offers Resume, a running one Focus
//
// The boxholder's way into a schedule is to go into the workstream and chat, so a
// scheduled record between runs gets the same Resume the dormant and culled rows
// get — `bin/workstreams resume` recreates the worktree and launches, with the
// optional briefing the record's `resume-with-briefing` routing already names. A
// schedule whose run is under way gets Focus like any live row, and the Alerts
// toggle stays either way.
void test("The boxholder's way into a schedule is to go into the workstream and chat, so...", async (t) => {
  const resting = render(createElement(ScheduledSection, {
    rows: [row({ name: "knip-sweep", schedule: scheduleRow({}), routingState: "scheduled" })],
    issues: [],
    exhibitsOrigin: "http://127.0.0.1:3230",
    now,
  }));
  const running = render(createElement(ScheduledSection, {
    rows: [row({ name: "manual-tests", schedule: scheduleRow({}), routingState: "live" })],
    issues: [],
    exhibitsOrigin: "http://127.0.0.1:3230",
    now,
  }));
  t.check(
    {
      restingVerbs: workstreamActionVerbs(row({ name: "knip-sweep", schedule: scheduleRow({}), routingState: "scheduled" })),
      runningVerbs: workstreamActionVerbs(row({ name: "manual-tests", schedule: scheduleRow({}), routingState: "live" })),
      restingResume: resting.includes(">Resume</button>"),
      restingNotFocus: !resting.includes(">Focus</button>"),
      runningFocus: running.includes(">Focus</button>"),
      runningNotResume: !running.includes(">Resume</button>"),
      alertsBoth: resting.includes(">Alerts</button>") && running.includes(">Alerts</button>"),
    },
    {
    restingVerbs: [
      "resume",
    ],
    runningVerbs: [
      "focus",
    ],
    restingResume: true,
    restingNotFocus: true,
    runningFocus: true,
    runningNotResume: true,
    alertsBoth: true,
  },
  );
});

// ## A dead scheduler is red, and a scheduler that never ticked says so
//
// An hour without a tick is a dead scheduler, not a quiet one; no heartbeat at
// all on any row means nothing has ever run the tick.
void test("An hour without a tick is a dead scheduler, not a quiet one; no heartbeat at...", async (t) => {
  const stale = scheduleHeartbeatStatus([row({ name: "knip-sweep", schedule: scheduleRow({ heartbeat: { lastTickAt: "2026-08-24T09:00:00.000Z" } }), routingState: "scheduled" })], now);
  const never = scheduleHeartbeatStatus([row({ name: "knip-sweep", schedule: scheduleRow({ heartbeat: null }), routingState: "scheduled" })], now);
  const staleMarkup = render(createElement(ScheduledSection, {
    rows: [row({ name: "knip-sweep", schedule: scheduleRow({ heartbeat: null }), routingState: "scheduled" })],
    issues: [],
    exhibitsOrigin: "http://127.0.0.1:3230",
    now,
  }));
  t.check(
    {
      staleText: stale.text,
      staleFlag: stale.stale,
      neverText: never.text,
      neverFlag: never.stale,
      neverIsRed: staleMarkup.includes("schedule-heartbeat-stale") && staleMarkup.includes("scheduler never ticked"),
    },
    {
    staleText: "scheduler: last tick 3 hours ago",
    staleFlag: true,
    neverText: "scheduler never ticked",
    neverFlag: true,
    neverIsRed: true,
  },
  );
});

// ## Alerts render their details as Markdown, acknowledged ones fold away
void test("Alerts render their details as Markdown, acknowledged ones fold away", async (t) => {
  const alerts = renderToStaticMarkup(createElement(ScheduleAlertList, {
    alerts: [
      alert({}),
      alert({ id: "20260810-090000-cd34", title: "Docling 2.4 settled", state: "acknowledged", acknowledgedAt: "2026-08-11T09:00:00.000Z", closedBy: "digest" }),
    ],
    acknowledging: null,
    error: null,
    selectedAlert: "20260824-115000-ab12",
    onAcknowledge: () => {},
  }));
  t.check(
    {
      title: alerts.includes("12 new unused exports"),
      priority: alerts.includes(">normal<"),
      markdownDetails: alerts.includes("<h2>Findings</h2>") && alerts.includes("<code>src/a.ts</code>"),
      acknowledgeButton: alerts.includes("Acknowledge</button>"),
      foldedAcknowledged: alerts.includes("<details") && alerts.includes("Docling 2.4 settled"),
      selectedAddressable: alerts.includes('id="schedule-alert-20260824-115000-ab12"') && alerts.includes("schedule-alert-selected"),
      openCount: alerts.includes("1 open"),
      closedByDigest: alerts.includes("closed by the digest"),
    },
    {
    title: true,
    priority: true,
    markdownDetails: true,
    acknowledgeButton: true,
    foldedAcknowledged: true,
    selectedAddressable: true,
    openCount: true,
    closedByDigest: true,
  },
  );
});

// ## Open alerts group by priority, the same words the popup uses
//
// Important comes first, then normal, then fyi — the order of urgency, and the
// words the daily digest popup counts. The all-schedules view names each
// alert's schedule. A standing condition says how long it has stood, and a
// filed one names its issue.
void test("Important comes first, then normal, then fyi — the order of urgency, and the...", async (t) => {
  const grouped = render(createElement(ScheduleAlertList, {
    alerts: [
      alert({ id: "20260918-020500-0001", priority: "fyi", workstream: "sdk-update", title: "Pin at 0.3.273" }),
      alert({ id: "20260918-020500-0002", priority: "important", workstream: "full-suite", title: "red after a landing" }),
      alert({
        id: "20260918-020500-0003", priority: "normal", workstream: "box-convergence", title: "Box convergence needs attention",
        condition: "unconverged", occurrences: 9, issue: "private-issues/bugs/2026-09-25-schedule-box-convergence-unconverged.md",
      }),
    ],
    acknowledging: null,
    error: null,
    showSchedule: true,
    onAcknowledge: () => {},
  }));
  const order = ["Important", "Normal", "FYI"].map((word) => grouped.indexOf(`<h3>${word}`));
  t.check(
    {
      ordered: order.every((at, i) => at >= 0 && (i === 0 || at > (order[i - 1] ?? 0))),
      scheduleNamed: grouped.includes('class="schedule-alert-schedule">sdk-update<'),
      standing: grouped.includes("seen 9 times, last"),
      filed: grouped.includes('href="/workstreams/issues?issue=bugs%2F2026-09-25-schedule-box-convergence-unconverged.md&amp;issueVisibility=private"'),
      importantTone: grouped.includes('class="pill pill-danger">important<'),
    },
    {
    ordered: true,
    scheduleNamed: true,
    standing: true,
    filed: true,
    importantTone: true,
  },
  );
});

// An old notification can still reveal an alert after it has been acknowledged.
void test("An old notification can still reveal an alert after it has been acknowledged.", async (t) => {
  const acknowledgedSelection = renderToStaticMarkup(createElement(ScheduleAlertList, {
    alerts: [alert({ id: "20260810-090000-cd34", state: "acknowledged", acknowledgedAt: "2026-08-11T09:00:00.000Z" })],
    acknowledging: null,
    error: null,
    selectedAlert: "20260810-090000-cd34",
    onAcknowledge: () => {},
  }));
  t.check(
    {
      disclosureOpen: acknowledgedSelection.includes('<details class="schedule-alerts-acknowledged" open=""'),
      selectedAddressable: acknowledgedSelection.includes('id="schedule-alert-20260810-090000-cd34"') && acknowledgedSelection.includes("schedule-alert-selected"),
    },
    {
    disclosureOpen: true,
    selectedAddressable: true,
  },
  );
});

// ## Notification deep links resolve to the alert route
//
// The producer and browser share the `/alerts?alert=<id>` contract
// (`bin/lib/schedules-alerts.ts` `ALERTS_PAGE_URL`); the per-schedule
// `/alerts/<schedule>` view stays addressable.
void test("The producer and browser share the /alerts?alert=<id> contract (bin/lib/sched...", async (t) => {
  t.check(router.buildLocation({ to: "/alerts", search: { alert: "20260824-115000-ab12" } }).href, "/workstreams/alerts?alert=20260824-115000-ab12");
});

void test("Notification deep links resolve to the alert route", async (t) => {
  t.check(
    router.buildLocation({
      to: "/alerts/$name",
      params: { name: "full-suite" },
      search: { alert: "20260824-115000-ab12" },
    }).href,
    "/workstreams/alerts/full-suite?alert=20260824-115000-ab12",
  );
});

// ## Reading and acknowledging go through `bin/schedules`
//
// The store has one writer. Acknowledging is `bin/schedules ack <id>`, and the
// next read reflects it — the app holds no alert state of its own.
void test("The store has one writer.", async (t) => {
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
  t.check(
    {
      calls,
      beforeState: before.map((entry) => entry.state),
      afterState: after.map((entry) => entry.state),
    },
    {
    calls: [
      [
        "alerts",
        "--json",
        "--workstream",
        "knip-sweep",
      ],
      [
        "ack",
        "20260824-115000-ab12",
      ],
      [
        "alerts",
        "--json",
        "--workstream",
        "knip-sweep",
      ],
    ],
    beforeState: [
      "open",
    ],
    afterState: [
      "acknowledged",
    ],
  },
  );
});

// A record the CLI would never have written is a refusal, not a half-rendered
// panel: the browser shows the error state instead of guessing.
void test("A record the CLI would never have written is a refusal, not a half-rendered p...", async (t) => {
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
  t.check([await message(broken), await message(failed)], [
    "Invalid alert record: priority",
    "bin/schedules failed: alerts: bin/schedules: no such schedule",
  ]);
});
