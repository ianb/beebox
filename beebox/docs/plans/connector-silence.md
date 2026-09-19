---
title: "Connector silence: notice a connector that stopped producing or keeps failing"
status: draft
workstream: connector-silence
issues:
  - ../../../issues/features/2026-08-10-detect-a-connector-that-stopped-producing.md
  - ../../../issues/bugs/2026-09-16-gmail-draft-upload-errors-are-silent.md
  - ../../../issues/bugs/2026-09-16-wakeup-retriages-inbox-item-blocked-on-connector.md
  - ../../../issues/bugs/2026-08-10-box-growth-warning-cannot-clear.md
---
# Connector silence: notice a connector that stopped producing or keeps failing

When something upstream changes and my box quietly stops collecting, I want the
box to tell me once, within a few days, so I do not find out weeks later by
comparing dates by hand. Concrete situations:

- Gmail imported new threads every day for five weeks, then imported none for
  five days while it kept refreshing tracked threads. I want one message on
  day 3.
- A Gmail draft cannot upload. I want the sync to report the error, and I want
  one message if every Gmail run keeps failing for a day.
- A calendar connector adds an event every few weeks. I never want a
  "too quiet" message about it.
- A dashboard warning I have seen and judged to be expected. I want to dismiss
  it, and I want it to stay dismissed until the condition clears and returns.

The same plan removes two sources of noise that train the boxholder to ignore
the dashboard: the box-growth level warning that cannot clear, and the intake
job that wakeup opens for an outbound draft every cycle.

**Issues addressed:**
[connector-that-stopped-producing](../../../issues/features/2026-08-10-detect-a-connector-that-stopped-producing.md) (anchor),
[gmail-draft-upload-errors-are-silent](../../../issues/bugs/2026-09-16-gmail-draft-upload-errors-are-silent.md),
[wakeup-retriages-inbox-item-blocked-on-connector](../../../issues/bugs/2026-09-16-wakeup-retriages-inbox-item-blocked-on-connector.md),
[box-growth-warning-cannot-clear](../../../issues/bugs/2026-08-10-box-growth-warning-cannot-clear.md) (parts 1, 2 and 4; part 3 deferred, see *NOT in scope*).
A queue search for `connector`, `growth`, `draft`, `silent`, `quiet` and
`stale` found no duplicates. Related but separate:
`issues/features/2026-08-12-stale-web-bundle-detection.md` (a different
staleness signal).

## Decisions already made (boxholder, 2026-09-18)

- **Quiet rule.** Only steady producers are watched: at least 21 days of
  history, and new items on at least 60% of the 28 days before the quiet
  stretch. A watched connector is too quiet when successful syncs have produced
  no new items for longer than max(2 days, 2 × its own longest quiet stretch
  in the baseline). Days with only errored or skipped runs do not count as
  quiet.
- **Sibling condition.** A connector whose every run has errored for more than
  a day is failing.
- **Surface.** One `notifyBoxholder` message per episode, plus a dashboard
  health warning with an "expected" dismiss. Same latch pattern as the Google
  re-authorization alert.
- **Growth.** Remove the fixed file and directory level warnings. Replace the
  directory threshold with a check tied to the file watcher's real limit.
  Measuring bytes and `.beebox` is a follow-up.

## Smallest fix and budget

**Smallest fix.** Read `drafts.errors` into `SyncResult.error`, skip
`*.email-outbound.card` in the unjobbed scan, and raise the two growth
thresholds. About 40 source and 60 test lines. This fixes the three bugs'
symptoms. It does nothing for the anchor issue: a connector that succeeds
while producing nothing stays invisible.

**Chosen design.** Four tracks.

| Track | Source | Tests |
|---|---|---|
| A — draft errors, outbound scan skip | ~60 | ~80 |
| B — connector activity record, one recording sync wrapper | ~150 | ~120 |
| C — quiet/failing verdict, alert, health check, dismiss | ~320 | ~260 |
| D — growth: drop level findings, watch-limit check | ~140 (about half deletions) | ~120 |
| **Total** | **~670** | **~580** |

Authored docs about 60 lines (`docs/connectors.md`, `docs/health-checks.md`).
No generated output. About 1,300 changed lines, under the 2,000-line BIG
CHANGE bar.

The fuller design buys detection of the anchor incident (B, C), which is the
only part of the cluster with no workaround today.

## Stated preferences this plan trades against

- **CLI is not a user surface** (memory `feedback_cli_not_a_user_surface`).
  The alert goes to push and Telegram and the dashboard. `bbx health` gets the
  line for free because it calls `runHealthChecks`
  (`src/cli/commands/health.ts:30`), but it is not the surface.
- **Nothing retries forever** (memory `feedback_nothing_retries_forever`).
  Each episode notifies once. The dashboard warning ends when the condition
  clears or the boxholder dismisses it. A dismissed episode stays dismissed.
- **Minimize invented concepts** (memory
  `feedback_minimal_concepts_prefer_primitives`). This plan reuses
  `notifyBoxholder`, `HealthCheck.actions`, transient connector state, and the
  episode latch. It adds one new concept, the **connector activity record**.
  It does not add the dev repo's schedule-alert vocabulary
  (`docs/implemented-plans/schedule-alert-signal.md`). That covers
  `bin/schedules`, a different system, and the box already has its own alert
  path.
- **Bias toward strict** (memory `feedback_bias_toward_strict`). The activity
  record is parsed with a strict schema and fails closed like other transient
  state. Balanced against the boxholder's rule that a false alarm is worse
  than silence: the verdict prefers silence when history is thin.
- **Real-box work: nothing public unvetted** (memory
  `feedback_box_work_nothing_public_unvetted`). Fixtures and doctests use
  invented connector histories. Nothing from production boxes enters them.
- **Precedent:** `src/core/schedule/google-auth-alert.ts:1-19`, *"Alert once
  per breakage. The latch stores the `needsReauthSince` stamp it alerted for,
  so a repaired-then-broken-again grant alerts again while a grant that stays
  broken stays quiet."* This plan copies that shape.

## What already exists

- **Sync result.** `src/connectors/index.ts:57` `SyncResult { success,
  created, updated, skipped?, pushed?, jobs?, procedures?, error? }`. Reuse.
  `created` alone is **not** the "new item" count. For Gmail it holds new
  thread cards (`src/connectors/gmail-threads.ts:243`, *"if (location.isNew)
  opts.result.created.push(cardRelPath)"*) **and** every new message file,
  including messages added to already-tracked threads (`:233`,
  *"opts.result.created.push(...written.paths)"*). Those message files live in
  the thread's `.attach/` scope (`:126`). Counting raw `created` would let
  replies on tracked threads hide the anchor incident. The plan therefore
  counts **new items** = `created` paths with no `.attach/` segment, that is,
  new top-level cards. This uses the card format's attachment-scope rule
  (`docs/cards-as-markdown.md`), not per-connector knowledge. For Telegram
  `created` holds new chats only (`src/connectors/telegram.ts:215`, *"if
  (result.newThread) created.push(...)"*), so Telegram will rarely qualify as
  a steady producer. That means no false alarms for Telegram, not a wrong
  alarm.
- **Four sync call sites.** `src/cli/commands/wakeup-connectors.ts:121`,
  `src/cli/commands/finalize.ts:86`, `src/core/commands/connector-sync.ts:65`,
  `src/cli/commands/drive.ts:86`. Each calls `connector.sync()` directly.
  Rebuild: route all four through one `syncConnector()` that records activity.
- **Nothing records per-run results.** `wakeup-outcome.ts` emits a
  `[wakeup-outcome]` line only when `BBX_WAKEUP_OUTCOME=1`
  (`src/cli/commands/wakeup-outcome.ts:32`); nothing persists it. Commits do
  not separate new items from refreshes (`src/connectors/gmail-commit.ts:23`,
  *"Pull ${notes.length} Gmail thread…"*). Searched for `lastSync`,
  `lastProduced`, `connectorRuns`: only Drive's per-card `last-sync` stamp
  (`src/connectors/drive-card-stamp.ts:58`), which is card metadata, not run
  history.
- **Transient connector state.** `src/connectors/transient-state.ts:24`
  `transientStatePath` → `_bookkeeping/connectors/<name>.state.json`,
  gitignored, fails closed on corruption (`:37-49`). Reuse for the activity
  record and the latch.
- **Episode-latched alerts.** `src/core/schedule/google-auth-alert.ts:59-120`
  and `health-alert.ts:62-106`, called after each scheduler tick
  (`src/core/schedule/scheduler.ts:274`, `:297`), each in its own try/catch.
  Reuse the pattern; add a third call beside them.
- **Notification.** `src/core/notify-boxholder.ts:38` `notifyChannels`,
  `:69` `notifyBoxholder` (durable per-channel output cards, `deliver: true`).
  Reuse.
- **Dashboard actions.** `src/webapp/trpc/routers/health.ts:47-53`
  `HealthCheck.actions?: Array<"acknowledge-box-growth" |
  "expect-box-growth-rates">`, rendered as buttons in
  `src/frontend/src/components/dashboard/HealthWarnings.tsx:47-60`, backed by
  owner-only mutations in `health-box-growth.ts:8,13`. Extend with one action.
- **Box timezone.** `src/core/box/config.ts:155` `loadBoxTimezone`. Reuse for
  the day boundary. Test time comes from `getBoxTime` (`src/lib/time.ts`),
  which honours stubs.
- **Draft errors dropped.** `src/connectors/gmail.ts:249-251`: *"const drafts
  = await uploadPendingDrafts(…); if (drafts.updated.length === 0) return;"*.
  `drafts.errors` is filled at `gmail-drafts.ts:64-69` and never read.
- **Outbound drafts re-triaged.** `gmail-drafts.ts:11-13` states the intent:
  *"Outbound cards live in `*.email-outbound.card` files … so the wakeup
  intake step doesn't try to triage them as incoming mail."* The scan does not
  implement it: `wakeup-steps.ts:324`, *"entry.endsWith(".card") &&
  !existingRefs.has(relPath)"*. A finished job's card is deleted
  (`src/core/finish-job.ts:56-64`), so its ref disappears and the draft, which
  stays in `inbox/email/` until it is sent, is unjobbed again next cycle.
  Thread cards escape only because intake files them out of the inbox.
- **Growth levels.** `src/core/box-growth/policy.ts:11-13`
  (`absoluteDirectories: 250`, `absoluteFiles: 1_000`); `:29-37`
  `absoluteThreshold` uses the global when `acknowledgedAt` is null; first
  measurement writes null when above the global
  (`src/core/box-growth/health.ts:202`). `acknowledgedAt` has no other reader
  in the policy.
- **Watch limit.** `src/core/box/file-watcher.ts:49` `MAX_WATCHED_DIRS =
  1024`; `:190-197` `reportWatchLimit` logs once per watcher lifetime and
  keeps no queryable state. The watcher skips dot directories and high-churn
  trees (`:170-176`), so the growth scan's directory count does not predict
  the watcher's count. Rebuild: keep the fact the watcher already knows.

## Prior art (external)

No design decision depends on an external premise. The baseline rule is
chosen by the boxholder and is tested against invented histories. Searched
for nothing external.

## Tracks / scope

### Track A — draft errors reach the sync result; outbound drafts leave the triage scan

- **What.** `uploadDrafts` copies each `drafts.errors` entry into the sync
  result. `findUnjobbedInboxItems` skips `*.email-outbound.card`.
- **Why.** A failing draft produces no output anywhere. A draft waiting for
  upload costs one intake job per wakeup cycle.
- **Direction.** In `gmail.ts` `uploadDrafts`, when `drafts.errors.length >
  0`, set `result.error` to `Draft upload failed for N card(s): <path>:
  <error>; …` (append to an existing `result.error` with `; `). Wakeup already
  prints `result.error` and counts it (`wakeup-connectors.ts` `reportSyncResult`),
  and finalize prints and counts it (`finalize.ts:95-97`) but does not set an
  exit code from the count. That stays unchanged on purpose: a non-zero
  finalize would make the reactor treat the calling job as failed and retry
  it, which is the retry-forever shape. The `failing` verdict (Track C) is the
  surface for a draft that keeps failing. In `wakeup-steps.ts`, add
  `const NEVER_TRIAGED_SUFFIXES = [".email-outbound.card"]` beside
  `EXCLUDED_SUBDIRS`, with a comment pointing at the `gmail-drafts.ts` header.
- **Vocabulary lock-ins.** None.
- **First chunk.** Both changes plus their tests. No open questions.

### Track B — connector activity record

- **What.** One file, `_bookkeeping/connectors/connector-activity.state.json`,
  holds per-connector daily totals for the last 60 days. One function,
  `syncConnector(boxRoot, connector, now)`, calls `connector.sync()`, records
  the result, and returns it. All four call sites use it.
- **Why.** No history exists, so absence cannot be told apart from a quiet
  week (anchor issue, *"The signal is absence"*).
- **Direction.**

  ```ts
  // src/connectors/activity.ts
  interface ConnectorDay {
    runs: number;       // sync() attempts, including ones that threw
    ok: number;         // success && !error && !skipped
    newItems: number;   // created paths with no ".attach/" segment
    created: number;    // raw created count, kept for diagnosis
    updated: number;
    errored: number;    // error set, or sync() threw
    skipped: number;
    lastError: string | null;
  }
  interface ConnectorActivity {
    version: 1;
    connectors: Record<string, { days: Record<string /* YYYY-MM-DD box-local */, ConnectorDay> }>;
  }
  export async function syncConnector(boxRoot: string, connector: Connector, opts: { now: Date }): Promise<SyncResult>;
  export async function loadConnectorActivity(boxRoot: string): Promise<ConnectorActivity>;
  ```

  Recording uses `updateTransientState` (locked read-modify-write) and prunes
  days older than 60. A thrown sync is recorded as `errored` and rethrown, so
  the callers' existing handling (including `ConnectorFatalError`,
  `wakeup-connectors.ts:141`) is unchanged. A failure to write the record is
  logged with `console.error` and does not fail the sync: losing one day's
  count costs at most a missed or delayed alert, and the verdict treats thin
  history as "not watched".
- **Vocabulary lock-ins.** `connector-activity.state.json`, `ConnectorDay`,
  `syncConnector`.
- **First chunk.** `activity.ts` with its doctest, then the four call sites.

### Track C — verdict, alert, health warning, dismiss

- **What.** A pure function decides each connector's state. The scheduler
  alerts once per episode. The dashboard shows a warning with a dismiss button.
- **Why.** The anchor issue.
- **Direction.**

  ```ts
  // src/connectors/activity-verdict.ts  (pure)
  type ConnectorVerdict =
    | { kind: "healthy" | "unwatched" }
    | { kind: "quiet"; since: string /* first quiet day */; quietDays: number; allowedDays: number }
    | { kind: "failing"; since: string /* first all-error day */; lastError: string };
  export function connectorVerdict(input: {
    days: Record<string, ConnectorDay>;
    today: string;
    openEpisode: { kind: "quiet" | "failing"; since: string } | null; // from the latch
  }): ConnectorVerdict;
  ```

  Every count below is over **run days** (days with `runs > 0`). Days with no
  runs are skipped entirely: they neither extend nor break a stretch and are
  never counted. A week with the scheduler stopped therefore adds nothing.

  - **failing**: the most recent run days, back to `since`, all have `runs >
    0 && errored === runs`, and there are at least 2 of them. Checked first.
  - **quiet stretch**: the most recent consecutive run days with `ok > 0 &&
    newItems === 0`. A run day with no `ok` run (all errored or skipped) is
    skipped like a no-run day. `quietDays` is the number of quiet run days,
    not a calendar span.
  - **baseline**: the 28 **calendar** days before the first quiet day. Watched
    only when the connector has run days spanning ≥ 21 calendar days in the
    record, and `newItems > 0` on ≥ 60% of those 28 calendar days (≥ 17 days).
    The calendar denominator is deliberate: a connector that runs three times
    a week can reach at most 12 of 28 and is never watched. A scheduler outage
    inside the baseline lowers the ratio, which errs toward silence.
  - **longest gap**: the longest run of consecutive baseline run days with
    `newItems === 0`.
  - **quiet** when `quietDays > max(2, 2 × longest gap)`. The anchor incident
    (new threads every day, then none) alerts on the third quiet run day.
  - **open episodes do not age out.** When `openEpisode` is `quiet`, the
    verdict stays `quiet` until a run day with `newItems > 0`, even after the
    baseline days are pruned from the 60-day record. An open `failing`
    episode ends at the first run day with an `ok` run. Without this, a
    connector that stays quiet for two months would become `unwatched` and
    delete its own warning.

  Latch, in the same activity file under `alerts: Record<connector, {
  episode: string /* verdict.kind + ":" + since */; notifiedAt: string |
  null; dismissedAt: string | null }>`. A new episode key replaces the entry.
  A healthy or unwatched verdict deletes it.

  - `checkConnectorActivityAndAlert(boxRoot, { now, tg, push })` in
    `src/core/schedule/connector-activity-alert.ts`, called from
    `scheduler.ts` after the Google auth alert in its own try/catch and
    `writeBoxLog` event `connector-activity-alert`. It sends one
    `notifyBoxholder` per new episode, `name: "connector-activity-alert"`,
    `severity: "alert"`, body naming each connector and its verdict, with the
    dashboard URL.
  - `connectorActivityHealthChecks(boxRoot, { now })` in
    `src/webapp/trpc/routers/health-connectors.ts`: one `warning` per
    connector with an open, undismissed episode, `actions:
    ["expect-connector-quiet"]`. No lines otherwise: an "ok" line per
    connector would be noise on every dashboard.
  - Owner-only mutation `expectConnectorQuiet({ connector })` sets
    `dismissedAt` for the current episode. `HealthWarnings.tsx` renders the
    button as "This is expected".
  - Message text, quiet: *"gmail has imported nothing new for 4 days (it
    usually imports something every day). Syncs are still succeeding."*
    Failing: *"gmail has failed every run for 2 days: <lastError>"*.
- **Vocabulary lock-ins.** `ConnectorVerdict` kinds `quiet` and `failing`;
  action `expect-connector-quiet`; notification name
  `connector-activity-alert`.
- **First chunk.** `connectorVerdict` with its doctest. Every rule above is
  settled.

### Track D — growth: no fixed levels; a check that names the real limit

- **What.** Delete the file and directory level findings entirely, fixed and
  baseline-relative. Rate findings stay. Add a watch-limit health check.
- **Why.** Issue parts 1, 2 and 4. The level warning fires on any Gmail box
  and cannot clear.
- **Direction.**
  - `policy.ts`: remove `absoluteDirectories`, `absoluteFiles`,
    `acceptedGrowthMultiplier` and `absoluteThreshold`, and the
    `absolute-directories`/`absolute-files` finding kinds (`model.ts:99-100`)
    and their prose (`health.ts:269-274`). Findings are computed on read and
    never persisted, so removing kinds needs no migration
    (`rateExpectations` stores rate kinds only, `actions.ts:52-56`).
  - `health.ts:119-124` `isAboveGlobalThreshold` and its use at `:202` go.
    With no level findings, `acknowledgedAt` and `accepted` have no policy
    reader. Implementation checks for other readers; if none, both fields
    leave the schema, and an old state file that still carries them is read
    with the keys dropped and rewritten at the next measurement. Issue part 2
    (a baseline that can never clear) disappears with the level check.
  - The acknowledge action keeps its other job: it rebases `previous` and
    clears `lastNotice` (`actions.ts:31-41`).
  - `file-watcher.ts`: `reportWatchLimit` also records `{ at, belowPath }` in
    a module map; export `watchLimitStatus(boxRoot)`. New health check
    `box-watch-limit`: when set, a `warning` *"Live updates are off below
    <path>: the box has more than 1,024 watched directories."* In a process
    with no watcher (`bbx health`), no check is emitted. The watcher starts
    on the first `events.subscribe` (`src/webapp/trpc/routers/events.ts:64`),
    which the dashboard opens, so a health query that races ahead of it shows
    the warning on the next refetch. Accepted: the limit is hit during the
    initial walk, seconds after the dashboard opens. The dashboard does not
    refetch `health.check` on bus events today
    (`src/frontend/src/pages/DashboardPage.tsx:25-34`), and the server serves
    a snapshot for up to 60 s (`health-snapshot.ts:141`). So
    `reportWatchLimit` also emits a `box-watch-limit` bus event, and
    `DashboardPage` invalidates the health query on it. The snapshot delay of
    up to 60 s is accepted.
- **Vocabulary lock-ins.** Check name `box-watch-limit`. Two finding kinds
  removed.
- **First chunk.** The policy and baseline change with updated doctests.

## Could this be simpler?

The simplest version that could work: after each wakeup, if a connector's
`created` has been zero for 7 days, print a line and add a health warning.
It fails in three ways. It warns forever about a calendar connector that is
quiet by nature, which is the box-growth failure again (anchor issue, *"It
must not become another permanent warning"*). It has no home for the history
across processes, because `created` is per run. And on the incident box it
fires on day 7, not day 3. The per-connector baseline costs one pure function
(~80 lines) and removes the need for per-connector thresholds.

A second simpler option: count `Pulled-By` commits instead of recording
activity. The anchor issue already rules this out: *"commits exist that are
not new items, so commit counting alone would have reported healthy
throughout."*

Track D could raise the two numbers instead. The boxholder chose removal:
any fixed number is wrong for some box, and it would still start boxes in a
state that cannot clear.

## Subplans

None. Every sub-question was settled by the boxholder's decisions above.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Activity file corrupt (truncated write) | New: doctest | `loadTransientState` throws `TransientStateCorruptError` | Clear: the alert step logs `connector-activity-alert` error; health check reports the error as a warning |
| Activity write fails during a sync | New: doctest with failing writer | `console.error`, sync result returned unchanged | Clear in logs; the cost is a thinner history, which the verdict treats as unwatched |
| Two processes sync at once (wakeup and finalize) | Covered by `updateTransientState` lock tests | Lock in `transient-state.ts` | n/a |
| Box timezone changes, so day keys shift | New: verdict doctest with a skipped day | Missing days neither extend nor break a stretch | Silent, harmless: at most one day's delay |
| Clock stubbed in tests leaks to "today" | Doctests pass `today` explicitly | Pure function takes `today` | n/a |
| Connector renamed or removed | New: doctest | Verdict only runs for connectors with days in the last 60; the latch entry is deleted when the verdict is unwatched | Silent, correct |
| Box on holiday, mail genuinely stops | Verdict doctest | One message, then the dismiss | Clear, once |
| Notification delivery fails | Existing `notifyBoxholder` tests | Leaves a `failed` output card (`google-auth-alert.ts:103-104`) | Clear on the card; latch still set, as in the precedent |
| No notify channel configured | New doctest | Latch not set, dashboard warning still shows | Clear on dashboard |
| Draft error text contains a long MIME dump | New doctest | Truncate each error to 200 chars in `result.error` | Clear |
| A connector that errors on every run also has zero `ok` runs, so it is never "quiet" | Verdict doctest | `failing` covers it | Clear |
| Growth state file from before the change still carries `accepted`/`acknowledgedAt` | New doctest | Keys dropped on read, rewritten at next measurement | Silent, harmless |
| Replies on tracked Gmail threads counted as production during a real silence | New verdict doctest (incident shape with nonzero raw `created`) | `newItems` excludes `.attach/` paths | n/a |
| Scheduler stopped for a week, then resumes with zero new items | New verdict doctest | No-run days are skipped, so only real quiet run days count | n/a |
| Every sync on a day throws | New `syncConnector` doctest | Thrown attempts count in `runs` and `errored`, so the day is an all-error run day | Clear: `failing` |
| Quiet episode lasts longer than the 60-day record | New verdict doctest | Open episode persists until new items arrive | Clear: warning stays until the connector produces or is dismissed |
| Watch limit hit, then the box shrinks | n/a | Status lives for the watcher lifetime, like the existing log line | Warning persists until restart; accepted: the watcher does not re-add dropped watches either |

No critical gaps.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** ADDRESSED: no agent-authored field is added.
  The box agent writes no part of the activity record.
- **Stale ref.** ADDRESSED: the unjobbed scan change removes a card type from
  consideration; it reads no refs.
- **Two agents touching the same card.** ADDRESSED: the activity file is
  written only under the transient-state lock.
- **Hand-edit drift.** ADDRESSED: a hand-edited activity file that fails the
  schema is reported, not silently reset (Failure modes, row 1).
- **Fabricated free-form value.** Not applicable: no free-form input.
- **Validation error UX.** ADDRESSED: messages name the connector, the days,
  and whether syncs still succeed (Track C message text).
- **Partial migration / transition state.** ADDRESSED: a box that upgrades
  starts with no history, so every connector is unwatched for 21 days. No
  false alarm is possible in that window. Growth state re-baselines once
  (Track D).
- **An outbound draft that really needs triage.** GAP, accepted: an
  `email-outbound` card is agent-authored by definition
  (`gmail-drafts.ts:1-4`); there is no inbound triage to do.

## NOT in scope

- **Measuring bytes and `.beebox`** (growth issue part 3). Boxholder decision:
  follow-up issue. It needs a new measurement dimension and a disk-pressure
  policy.
- **Stranding a draft that fails for days.** A draft whose upload keeps
  failing is retried every sync. Considered stamping `gmail-draft-error` and
  stopping after 7 days; not now, because the common cause is an expired grant
  where retrying is right after reconnecting, and the `failing` verdict
  already notifies once. Filed as a follow-up.
- **Per-connector declared expectations** (config saying "expect N/day").
  The learned baseline covers the incident with no configuration.
- **A briefing line or box-agent chat mention.** Boxholder chose push plus
  dashboard.
- **Backfilling history from git.** Commits cannot separate new items from
  refreshes; see *Could this be simpler?*
- **Telegram per-message counting.** Telegram's `created` counts chats, so it
  is rarely watched. Changing what Telegram reports is a separate change.

## Open design questions

None open. Thresholds are the boxholder's; tuning them later is a one-line
change in `activity-verdict.ts`.

## Knowledge audits

Skip: purely infrastructural. No box-agent-facing concept, card shape or
convention changes. The draft-error text reaches the box agent through
existing sync output.

## What will hold this after it ships

- `connectorVerdict` is pure and carries the risky decision. A doctest
  (`src/connectors/activity-verdict.doctest.md`) walks invented histories:
  the incident shape (daily producer, then zero created with nonzero
  updated), a sparse calendar, a holiday gap in the baseline, thin history,
  all-error days, mixed error and quiet days.
- `syncConnector` recording: doctest with a fake connector and a temp box.
- Alert latch: doctest in the shape of the existing
  `google-auth-alert` tests, with fake `tg`/`push`.
- Gmail draft errors: extend the existing Gmail fake tests (find the fake
  used by `gmail.ts` tests; do not build another).
- Unjobbed scan: extend the existing `createIntakeJobsForUnjobbed` tests.
- Growth: update `policy` and `health` doctests; watch-limit check with a
  small `maxWatchedDirs`, which `file-watcher.ts:76` already allows.
- Dashboard button: one component test beside the box-growth action tests.

No new test tier.

## Implementation order

1. Track A (independent; commit).
2. Track D (independent; commit).
3. Track B: `activity.ts` and doctest, then the four call sites.
4. Track C: verdict doctest and function, then alert and scheduler hook, then
   health check, mutation and button.
5. Docs: `docs/connectors.md` (activity record and verdict),
   `docs/health-checks.md` (two new checks, growth change). File the two
   follow-up issues.

## Rollout shape

Done when the doctests named in *What will hold this* pass, plus
`pnpm typecheck` and eslint on the changed files. Data: the activity record
is new and starts empty. Growth state is re-baselined in place on the next
measurement; no scripted migration. No knowledge audits.
