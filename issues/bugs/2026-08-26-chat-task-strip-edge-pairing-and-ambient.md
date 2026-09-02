---
title: "Chat's live task strip pairs edges and filters only `skip_transcript` — a missed bookend wedges it, and watcher tasks show as user work"
workstream: unattached
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Agent SDK 0.3.247
labels: [sdk-update]
---

Two related defects in how chat surfaces background tasks, both named by the
Agent SDK's own guidance as of 0.3.247.

**1. The live strip pairs edges, so a missed bookend leaves a task running
forever.** `applyTaskEvent`
(`beebox/src/frontend/src/components/chat/background-tasks.ts`) folds the
`started` / `progress` / `updated` / `settled` edge stream into the in-flight
list: `started` registers a task, a terminal status removes it. Nothing else
removes it. If the `settled` bookend never arrives — a dropped stream, a parked
and resumed session, a CLI process restart — the task stays in the strip as
"running" indefinitely, and no later event can clear it because the reducer is
keyed on `taskId`.

The SDK ships a level signal for exactly this. `background_tasks_changed`
carries the full set of live background tasks on every membership change, and
its 0.3.247 documentation is explicit: consumers that only need "is background
work running" should *replace* their set with each payload rather than pairing
edges, "so a missed bookend cannot wedge a stale running indicator". beebox
does not consume `background_tasks_changed` anywhere. Adopting it means honoring
its stated contract: the level is per-process and nothing is emitted at startup,
so the set must reset to empty whenever the session's CLI process (re)starts;
ordering against the edge stream is unspecified, so the two must not be
correlated.

**2. `skip_transcript` no longer covers every housekeeping task.** 0.3.247 adds
an `ambient` flag to `task_started`, `task_notification` and the
`background_tasks_changed` entries, documented as "true for housekeeping tasks
the CLI does not surface as user work (**every `skip_transcript` task, plus
auto-started live-update watchers**)". `adaptTaskMessage`
(`beebox/src/core/chat/session/messages.ts:126,148`) filters on
`skip_transcript` alone, so the watcher class — ambient but not
`skip_transcript` — reaches the transcript and the strip as if the boxholder's
agent had started it. `ambient` is a superset, not a rename: `skip_transcript`
is still present in the 0.3.247 types, so the fix is to widen the predicate,
not to swap it.

Both land in the same small area, which is why they are one item. The pin
reached 0.3.243 on 2026-08-26; `ambient` needs 0.3.247, `background_tasks_changed`
is already available. See the 0.3.247 entry in `../../docs/agent-sdk-notes.md`.

Related: [chat stop and background subagents](../decisions/2026-08-25-chat-stop-and-background-subagents.md).


## Upstream movement (2026-09-01, SDK 0.3.257)

Two fixes in `0.3.257` bear directly on this item, and they cut in opposite
directions.

The first **confirms the failure path in part 1 and removes one cause of it**:
*"Fixed a background Bash task that is still running when a stream-json session
ends right after an interrupt (stdin closed) never receiving its final
`task_notification`."* That is this repo's chat stop path exactly — beebox calls
`interrupt()` and the run then ends — so a background Bash task started in that
turn was losing its `settled` bookend upstream, and the strip has no way to
clear it. The reducer defect stands on its own, but this was a live producer of
the missed bookends it wedges on.

The second is **a caveat for the fix proposed in part 1**: *"Fixed `-p` giving up
on a long-running background subagent without actually stopping it, so
`background_tasks_changed` kept listing it and events for it arrived after its
`stopped` notification."* The level signal this item recommends adopting was
itself reporting phantom running tasks before `0.3.257`. Adopting it against an
older bundled CLI would trade a wedged strip for a strip that shows work which
is already gone. Whoever picks this up should require the pin to be at
**`0.3.257` or newer** before switching the strip over — which is a stronger
version requirement than the `ambient` flag in part 2 (`0.3.247`, already in the
pin).
