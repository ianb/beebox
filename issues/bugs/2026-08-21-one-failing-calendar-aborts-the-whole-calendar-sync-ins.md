---
title: "One failing calendar aborts the whole calendar sync instead of being skipped"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-user-stories-refresh — user-story catalog verification
stories: [connectors/calendar-sync-repairs-an-expired-sync-token-and]
---

**What is wrong**

In `callback-box/src/connectors/google-calendar.ts`, the per-calendar loop in `sync()` (lines ~174-189) treats any per-calendar error as fatal for the whole run:

```ts
const outcome = await this.runCalendarSync({ ... });
if (outcome.fullResync) isFullResync = true;
if (outcome.error) {
  return { success: false, created, updated, error: outcome.error };
}
```

`runCalendarSync` (lines ~252-283) returns that `error` for every non-410 failure (`Calendar sync failed for ${calendarId}: ...`). Expired sync tokens (410) are handled well — token deleted, state saved, full re-pull, `fullResync: true` — so the outage-recovery half works. The isolation half does not exist.

**User-visible consequence**

If one calendar starts failing — a share revoked, a 403/404, a transient 5xx on the wrong calendar — every calendar after it in the list stops syncing, and stays stopped on every subsequent `cb wakeup` until someone notices and removes the bad calendar from config. The early return also skips `processLocalDeletes`, `pushAndCleanOrphans`, the final `saveState`, and the explicit-path `stageAndCommitPaths`, so locally-marked deletes and locally-created events are not pushed, and event files already written for the calendars that succeeded are left uncommitted in the box's working tree for the next commit to sweep up under an unrelated message.

**Files involved**

- `callback-box/src/connectors/google-calendar.ts` (the loop and `runCalendarSync`)
- `callback-box/src/connectors/google-calendar-state.ts` (state saved on the error path)
- `callback-box/src/connectors/google-calendar-sync.ts` (`syncCalendar`, the thrower)

**How this was established**

Read the loop and the error path in full. The 410 branch was confirmed to do what the story says; the non-410 branch returns out of `sync()` before the post-loop work. Not reproduced against a live Google account — the failure requires a calendar that errors, which the local test box cannot produce (its connectors report 'Google auth not configured').

## Updating the user-story catalog

This issue is why [`connectors/calendar-sync-repairs-an-expired-sync-token-and`](../../callback-box/user-stories/catalog/2026-08-21.md#flagged-worth-a-human-glance) is currently
flagged ❌ in [the user-story catalog](../../callback-box/user-stories/catalog/2026-08-21.md) — a catalogue of what callback-box can
actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a
short agent run over just the affected stories, not the full regeneration:

```
Workflow({scriptPath: "callback-box/user-stories/pipeline/recheck.workflow.mjs",
          args: {root: "<repo root>", date: "2026-08-21",
                 ids: ["connectors/calendar-sync-repairs-an-expired-sync-token-and"]}})

pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts 2026-08-21
pnpm exec tsx callback-box/user-stories/pipeline/render.ts \
  > callback-box/user-stories/catalog/2026-08-21.md
```

The recheck is adversarial by design: it will not mark the story accurate just because
this issue was closed — it re-reads the code. If it still refutes, that is worth knowing
before you call the fix done. Details in
[the pipeline README](../../callback-box/user-stories/README.md).
