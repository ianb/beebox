// # Launching workstream presentation
//
// An active launch has its own inventory section and offers no lifecycle controls
// until a real agent process takes over. Failed or expired registry-only launches
// also offer no destructive controls.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { workstreamActionVerbs } from "../../../src/frontend/components/WorkstreamActions.js";
import { workstreamStateFor } from "../../../src/frontend/pages/WorkstreamsPage.js";
import type { Workstream } from "../../../src/frontend/types.js";

interface RowOptions {
  state: "active" | "expired";
  routingState: "launching" | "uncertain";
  routingAction: "wait-for-launch" | "investigate";
}

function row({ state, routingState, routingAction }: RowOptions): Workstream {
  return {
    name: `${state}-launch`,
    branch: `worktree-${state}-launch`,
    url: null,
    git: null,
    runtime: { state: "absent" },
    agent: { state: state === "active" ? "launching" : "none", reason: state === "active" ? "signal=launch-lease" : "launch=expired" },
    session: {
      agent: "claude",
      hasSession: false,
      tty: null,
      baseSha: null,
      removed: null,
      archived: null,
      description: null,
      launch: { state, startedAt: "2026-08-24T00:00:00Z", expiresAt: "2026-08-24T01:00:00Z", failedAt: null, reason: state === "expired" ? "launch-lease-expired" : null },
    },
    routing: { state: routingState, action: routingAction, lastActivityAt: null },
    boxState: { testSetup: false, keepUnmerged: false, pristine: null },
    schedule: null,
  };
}

void test("line 37", async (t) => {
  const launching = row({ state: "active", routingState: "launching", routingAction: "wait-for-launch" });
  const expired = row({ state: "expired", routingState: "uncertain", routingAction: "investigate" });
  const resumed = row({ state: "active", routingState: "launching", routingAction: "wait-for-launch" });
  resumed.session.removed = { at: "2026-08-23T00:00:00Z", merged: true };
  t.check(
    {
      section: workstreamStateFor(launching).section,
      note: workstreamStateFor(launching).note,
      launchingActions: workstreamActionVerbs(launching),
      resumedSection: workstreamStateFor(resumed).section,
      expiredActions: workstreamActionVerbs(expired),
    },
    {
    section: "Launching",
    note: "setting up worktree and agent",
    launchingActions: [],
    resumedSection: "Launching",
    expiredActions: [
      "resume",
    ],
  },
  );
});

// A row whose worktree exists but whose agent is not live cannot be focused or
// closed (`bin/workstreams focus`/`close` refuse with "use resume"), so it gets
// Resume alone; a live row gets Focus and Close; a removed row can only be
// resumed. This is the row a machine restart leaves behind: session gone,
// commits still on the branch.
void test("A row whose worktree exists but whose agent is not live cannot be focused or...", async (t) => {
  const dormant = row({ state: "active", routingState: "launching", routingAction: "wait-for-launch" });
  dormant.session.launch = { state: "none", startedAt: null, expiresAt: null, failedAt: null, reason: null };
  dormant.agent = { state: "none", reason: "" };
  dormant.routing = { state: "dormant", action: "resume-with-briefing", lastActivityAt: "2026-08-31T22:55:47Z" };
  dormant.git = { ahead: 1, dirty: 0, merged: false, tip: "2395f4abf1ba786737d6589867f8833225a22732" };
  const live = structuredClone(dormant);
  live.agent = { state: "live", reason: "signal=cwd" };
  live.routing = { state: "live", action: "manual-forward", lastActivityAt: null };
  const removed = structuredClone(dormant);
  removed.session.removed = { at: "2026-08-23T00:00:00Z", merged: false, finalSha: dormant.git.tip ?? undefined };
  t.check(
    {
      dormant: workstreamActionVerbs(dormant),
      dormantSection: workstreamStateFor(dormant).section,
      live: workstreamActionVerbs(live),
      removed: workstreamActionVerbs(removed),
    },
    {
    dormant: [
      "resume",
      "archive",
    ],
    dormantSection: "Dormant",
    live: [
      "focus",
      "close",
    ],
    removed: [
      "resume",
    ],
  },
  );
});

// A dormant row gained `archive` on 2026-09-12 — the verb existed in the CLI and
// the shared list but had no button. `removed` here carries `merged: false`, work
// that never landed, and the CLI refuses to archive that so no button is offered
// for it either (see `WorkstreamActions.archive.test.ts`).
