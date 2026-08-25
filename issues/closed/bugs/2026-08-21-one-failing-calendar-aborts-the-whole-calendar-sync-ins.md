---
title: "One failing calendar aborts the whole calendar sync instead of being skipped"
workstream: connector-sync-isolation
design: ../../../callback-box/docs/implemented-plans/connector-sync-isolation.md
area: callback-box
labels: [user-stories-audit]
filed-by: agent
discovered-in: worktree-user-stories-refresh — user-story catalog verification
resolution: implemented
---

> **Resolved by `878a393c` in `connector-sync-isolation`.** Calendar member failures now produce sanitized typed outcomes, later calendars and post-loop work continue, partial writes are committed, ordinary failures restore their incoming token, and failed 410 retries remain retryable. Connector errors make `cb wakeup` exit nonzero after the remaining phases finish. Focused doctests and an independent source recheck passed; no live authenticated Google account was available.

**What is wrong**

In `callback-box/src/connectors/google-calendar.ts`, the per-calendar loop in `sync()` (lines ~174-189) treats any per-calendar error as fatal for the whole run:

```ts
const outcome = await this.runCalendarSync({ ... });
if (outcome.fullResync) isFullResync = true;
if (outcome.error) {
  return { success: false, created, updated, error: outcome.error };
}
```

`runCalendarSync` (lines ~252-283) returns that `error` for every non-410 failure (`Calendar sync failed for ${calendarId}: ...`). Expired sync tokens (410) do delete the token, save state, and retry without the token. That retry does not remove stale local events absent from the full response; the separate [410 stale-event issue](../../bugs/2026-08-23-calendar-410-resync-does-not-remove-stale-events.md) tracks that adjacent gap. The isolation half described here does not exist.

**User-visible consequence**

If one calendar starts failing — a share revoked, a 403/404, a transient 5xx on the wrong calendar — every calendar after it in the list stops syncing, and stays stopped on every subsequent `cb wakeup` until someone notices and removes the bad calendar from config. The early return also skips `processLocalDeletes`, `pushAndCleanOrphans`, the final `saveState`, and the explicit-path `stageAndCommitPaths`, so locally-marked deletes and locally-created events are not pushed, and event files already written for the calendars that succeeded are left uncommitted in the box's working tree for the next commit to sweep up under an unrelated message.

**Planning findings that constrain the fix.** `fetchEvents` writes a returned
`nextSyncToken` into state before event reconciliation
(`google-calendar-state.ts:219-224`). If reconciliation then fails, simply
continuing and saving state can skip the unprocessed tail on the next run; the
failed calendar's incoming token must be restored. Also, the 410 retry await is
inside the catch and can itself escape the per-calendar boundary, and raw HTTP
error messages can contain request URLs/query parameters. The implementation
must contain both attempts and report a sanitized typed failure rather than
persisting raw exception text in a Git commit.

**Files involved**

- `callback-box/src/connectors/google-calendar.ts` (the loop and `runCalendarSync`)
- `callback-box/src/connectors/google-calendar-state.ts` (state saved on the error path)
- `callback-box/src/connectors/google-calendar-sync.ts` (`syncCalendar`, the thrower)

**How this was established**

Read the loop and the error path in full. The 410 branch was confirmed to do what the story says; the non-410 branch returns out of `sync()` before the post-loop work. Not reproduced against a live Google account — the failure requires a calendar that errors, which the local test box cannot produce (its connectors report 'Google auth not configured').

## User-story catalog recheck

An independent adversarial source recheck marked [`connectors/calendar-sync-repairs-an-expired-sync-token-and`](../../../callback-box/user-stories/catalog/2026-08-21.md) accurate on 2026-08-23. The rendered catalog now shows the story as verified.

Catalogued as `connectors/calendar-sync-repairs-an-expired-sync-token-and` in the [user-story catalog](../../../callback-box/user-stories/catalog/2026-08-21.md).
