# Archive and Unarchive are reachable from the app

`bin/workstreams archive` / `unarchive` have always existed, the shared verb
list has always carried them, and the server passes any verb through to the
CLI — but the frontend never rendered a button, so they were CLI-only verbs in
a UI the boxholder actually lives in
(`issues/features/2026-09-03-workstreams-app-has-no-archive-button.md`).

These pin WHICH rows are offered the verb, because that is where the CLI's
refusals have to be mirrored: archiving a scheduled record is the wrong way to
stop it (`enabled: false` in its `schedule.yaml` is), and archiving a row
removed with unmerged work would hide recovery state.

```ts setup
import { workstreamActionVerbs } from "../src/frontend/components/WorkstreamActions.js";
import type { Workstream } from "../src/frontend/types.js";

function row(over: {
  state: Workstream["routing"]["state"];
  archived?: boolean;
  removed?: { merged: boolean } | null;
  live?: boolean;
  scheduled?: boolean;
}): Workstream {
  return {
    name: "w", branch: "worktree-w", url: null,
    git: { ahead: 0, dirty: 0, merged: true, tip: null },
    runtime: { state: "absent" },
    agent: { state: over.live === true ? "live" : "none", reason: "" },
    session: {
      agent: "claude", hasSession: false, tty: null, emoji: null, baseSha: null,
      removed: over.removed ? { at: "2026-09-01T00:00:00.000Z", merged: over.removed.merged, finalSha: null } : null,
      archived: over.archived === true ? { at: "2026-09-01T00:00:00.000Z" } : null,
      description: null,
      launch: { state: "none", startedAt: null, expiresAt: null, failedAt: null, reason: null },
    },
    routing: { state: over.state, action: "resume-with-briefing", lastActivityAt: null },
    boxState: { testSetup: false, keepUnmerged: false, pristine: null },
    schedule: over.scheduled === true
      ? { name: "w", cadence: "7d", enabled: true, overdue: false, lastRunAt: null, nextDueAt: null, description: null }
      : null,
  };
}
```

A settled row can be put away; a live one has nothing settled to hide yet.

```ts
JSON.stringify({
  dormant: workstreamActionVerbs(row({ state: "dormant" })),
  stale: workstreamActionVerbs(row({ state: "stale" })),
  live: workstreamActionVerbs(row({ state: "live", live: true })),
})
=> {"dormant":["resume","archive"],"stale":["resume","archive"],"live":["focus","close"]}
```

A culled row that merged is archivable. One removed with UNMERGED work is not —
the CLI refuses it so the recovery state stays visible, and the button must not
offer what the CLI will reject.

```ts continue
JSON.stringify({
  culledMerged: workstreamActionVerbs(row({ state: "removed", removed: { merged: true } })),
  unmerged: workstreamActionVerbs(row({ state: "removed", removed: { merged: false } })),
})
=> {"culledMerged":["resume","archive"],"unmerged":["resume"]}
```

An archived row offers exactly one move — come back. The other verbs act on a
row the boxholder deliberately put away.

```ts continue
JSON.stringify({
  archived: workstreamActionVerbs(row({ state: "dormant", archived: true })),
  scheduled: workstreamActionVerbs(row({ state: "scheduled", scheduled: true })),
})
=> {"archived":["unarchive"],"scheduled":["resume"]}
```
