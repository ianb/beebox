# Launching workstream presentation

An active launch has its own inventory section and offers no lifecycle controls
until a real agent process takes over. Failed or expired registry-only launches
also offer no destructive controls.

```ts setup
import { workstreamActionVerbs, workstreamStateFor } from "../src/frontend/pages/WorkstreamsPage.js";
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
