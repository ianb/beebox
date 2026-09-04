# Launching workstream presentation

An active launch has its own inventory section and offers no lifecycle controls
until a real agent process takes over. Failed or expired registry-only launches
also offer no destructive controls.

```ts setup
import { workstreamActionVerbs } from "../src/frontend/components/WorkstreamActions.js";
import { workstreamStateFor } from "../src/frontend/pages/WorkstreamsPage.js";
import type { Workstream } from "../src/frontend/types.js";

function row(state: "active" | "expired", routingState: "launching" | "uncertain", routingAction: "wait-for-launch" | "investigate"): Workstream {
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
      emoji: null,
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
```

```ts
const launching = row("active", "launching", "wait-for-launch");
const expired = row("expired", "uncertain", "investigate");
const resumed = row("active", "launching", "wait-for-launch");
resumed.session.removed = { at: "2026-08-23T00:00:00Z", merged: true };
JSON.stringify({
  section: workstreamStateFor(launching).section,
  note: workstreamStateFor(launching).note,
  launchingActions: workstreamActionVerbs(launching),
  resumedSection: workstreamStateFor(resumed).section,
  expiredActions: workstreamActionVerbs(expired),
})
=> {"section":"Launching","note":"setting up worktree and agent","launchingActions":[],"resumedSection":"Launching","expiredActions":["resume"]}
```

A row whose worktree exists but whose agent is not live cannot be focused or
closed (`bin/workstreams focus`/`close` refuse with "use resume"), so it gets
Resume alone; a live row gets Focus and Close; a removed row can only be
resumed. This is the row a machine restart leaves behind: session gone,
commits still on the branch.

```ts
const dormant = row("active", "launching", "wait-for-launch");
dormant.session.launch = { state: "none", startedAt: null, expiresAt: null, failedAt: null, reason: null };
dormant.agent = { state: "none", reason: "" };
dormant.routing = { state: "dormant", action: "resume-with-briefing", lastActivityAt: "2026-08-31T22:55:47Z" };
dormant.git = { ahead: 1, dirty: 0, merged: false, tip: "2395f4abf1ba786737d6589867f8833225a22732" };
const live = structuredClone(dormant);
live.agent = { state: "live", reason: "signal=cwd" };
live.routing = { state: "live", action: "manual-forward", lastActivityAt: null };
const removed = structuredClone(dormant);
removed.session.removed = { at: "2026-08-23T00:00:00Z", merged: false, finalSha: dormant.git.tip };
JSON.stringify({
  dormant: workstreamActionVerbs(dormant),
  dormantSection: workstreamStateFor(dormant).section,
  live: workstreamActionVerbs(live),
  removed: workstreamActionVerbs(removed),
})
=> {"dormant":["resume"],"dormantSection":"Dormant","live":["focus","close"],"removed":["resume"]}
```
