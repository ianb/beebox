---
title: "Connector sync isolation and Drive untracking"
status: draft
workstream: connector-sync-isolation
issues:
  - ../../../issues/closed/bugs/2026-08-21-one-failing-calendar-aborts-the-whole-calendar-sync-ins.md
  - ../../../issues/closed/bugs/2026-08-21-trashing-or-deleting-a-google-drive-card-does-not-stop.md
---
# Connector sync isolation and Drive untracking

Make Google Calendar sync continue useful work after one configured calendar
fails, while still reporting the completed wakeup as failed. Make `cb rm` /
trashing a Google Drive card the supported durable untracking action, including
for cards that originated from a folder mount. Preserve the existing rule that
an explicit folder mount discovers remote children that have no live or trashed
card.

The defects do not share an implementation cause. They share only a product
rule: one failing or removed member must not silently change the behavior of the
rest of a connector's working set. The implementation stays in two independent
tracks.

## Stated preferences this plan trades against

- `docs/engineering-principles.md`: principle 1 (types are structure),
  principle 3 (validate at boundaries), principle 4 (resilient and never
  silent), principle 5 (failure paths visible in signatures), principle 8 (one
  way to do each thing), and principle 10 (testability is architectural).
- `CLAUDE.md:11`: *"Tests are doctests (`.doctest.md`) in `test/`."* Tests land
  before implementation and use the existing Google service fakes.
- `CLAUDE.md:107`: *"Read before writing. Don't guess file formats, XML
  structures, or API shapes."* The plan keeps current connector and card shapes
  unless a durable new state shape is required.
- `code-style.md:27-33`: *"ONLY catch the minimal, specific error you can
  handle"*, *"Never silently ignore errors"*, and *"When to Result vs throw."*
  Recoverable per-calendar failures become typed outcomes; unexpected
  connector-wide failures still throw.
- `code-style.md:48`: *"`Promise.allSettled` is the default over `Promise.all`
  when the tasks are independent."* Calendar IDs stay sequential because they
  mutate shared state and Git paths, but they get inspect-every-outcome
  semantics.
- Precedents: Gmail's live-card ignore policy, the wakeup connector error
  counter, scheduled-task health/alerting, and Calendar's committed
  connector-owned event index.

Every design choice and review finding below traces to these preferences.

## What already exists

- **Calendar iteration and the early return.**
  `src/connectors/google-calendar.ts:175-189` loops over configured calendars,
  then says *"if (outcome.error) { return { success: false, created, updated,
  error: outcome.error }; }"*. Reuse the loop. Replace only its early-return
  policy.
- **Per-calendar catch and 410 retry.**
  `src/connectors/google-calendar.ts:270-285` catches one calendar's error. A
  non-410 error saves state and returns a contextual error. A 410 deletes that
  calendar's token and retries with `syncToken: undefined`, but that second
  await is inside the catch and can escape the member boundary. The current
  fallback also treats any error message containing `410` as token expiry.
  Reuse the boundary, but protect both attempts, inspect only HTTP status, and
  return a discriminated outcome.
- **A partial-write accounting gap.**
  `src/connectors/google-calendar-sync.ts:262-286` creates its accumulator
  locally and returns it only after every fetched event is reconciled. The
  caller at `google-calendar.ts:270-272` collects only after the awaited call
  resolves. If reconciliation writes one event and then throws on another, the
  written path is absent from the connector's commit list. Change accumulator
  ownership so every completed write is retained after a later failure.
- **A failed attempt can advance its token.**
  `src/connectors/google-calendar-state.ts:219-224` stores a returned
  `nextSyncToken` before event reconciliation starts. If a later event throws,
  saving that mutated state would skip the unprocessed tail next run. Snapshot
  the calendar's incoming token and restore it on an ordinary failed outcome.
- **Post-calendar local work.**
  `src/connectors/google-calendar.ts:192-206` runs local delete processing,
  pushes locally created events, and saves state only after every calendar.
  Reuse these passes after the loop, including after partial pull failure.
  Their HTTP failure paths already preserve local files and log warnings:
  `src/connectors/google-calendar-push.ts:61-113` and `:131-183`.
- **Path-scoped calendar commits.**
  `src/connectors/google-calendar.ts:208-231` constructs an explicit list of
  changed event files plus connector state/config, then calls
  `stageAndCommitPaths`. Reuse this path and extend the narrative message with
  failed calendar IDs.
- **Connector-level isolation and counting.**
  `src/cli/commands/wakeup-connectors.ts:68-88` catches one connector failure
  and continues. It increments `totalErrors`, but `:90-99` prints the count and
  returns only `{ activeConnector }`. Extend the return value with the error
  count. Do not rebuild connector orchestration.
- **A conditional health surface that already understands process failure.**
  The seeded calendar task runs `cb wakeup --connector google-calendar`
  (`src/core/box/defaults.ts:249-257`), but it is seeded disabled. When enabled,
  `src/lib/exec-with-timeout.ts:130-140` turns a nonzero child exit into a
  command failure, `src/cli/commands/tick-helpers.ts:270-299` records the
  classified result, and `src/core/schedule/state.ts:200-219` increments
  `consecutiveFailures`. Health is failing after one failure
  (`src/core/schedule/health.ts:125-134`); proactive notification starts after
  two consecutive failures and only with a configured channel
  (`src/core/schedule/health-box.ts:185-198`,
  `src/core/schedule/health-alert.ts:57-100`). Reuse this conditional surface
  rather than add connector-specific health state.
- **Drive's current live-card scan.**
  `src/connectors/google-drive.ts:137-165` globs every registered Drive card
  type under the box root, then syncs each independently. Reuse the handler
  registry and per-card error isolation. Move discovery and ID parsing into one
  shared module.
- **Trash is inside the scan root.**
  `src/core/commands/trash.ts:139-152` moves a card to `getBoxDir(...,
  "trash")`; `src/lib/box-layout-spec.ts:158-162` defines that directory as
  `store/trash`. The current Drive glob has no semantic exclusion, so the
  issue's trash mechanism is confirmed.
- **`cb rm` already commits the tombstone.**
  `src/core/commands/trash.ts:211-221` commits the card move and its related
  paths with a `Trashed-By: cb rm` trailer. The card in `store/trash` is already
  durable, cross-machine intent; Drive does not need a second history file.
- **Gmail's ignore-list precedent.**
  `src/connectors/gmail-tracking.ts:10-18` excludes `node_modules/**`, `.git/**`,
  `tmp/**`, `.callback-box/**`, `procedure/runs/**`, and `store/trash/**` from
  its live registry. Reuse the infrastructure ignores. Drive treats trash
  specially as a tombstone source instead of discarding its IDs.
- **Folder discovery recreates absent cards.**
  `src/connectors/google-drive.ts:282-323` lists a mounted remote folder, skips
  only IDs in `existingDriveIds`, and creates a card for every other supported
  file. A hard-deleted folder child therefore reappears. This is separate from
  the live-card glob bug.
- **Drive's machine-local state is deliberately transient.**
  `src/connectors/google-drive-state.ts:1-14` calls
  `google-drive.state.json` gitignored and delta-merges concurrent writers.
  Do not put durable untracking intent there; losing that file on a new machine
  is an expected reset.
- **Drive config and status callers already exist.**
  `src/connectors/drive-config.ts:14-21` defines folder mounts, and
  `src/cli/commands/drive.ts:219-260` independently globs Drive cards for
  status. Its legacy-only `drive-id="..."` regular expression at
  `src/cli/commands/drive.ts:244` also misses YAML-backed Drive cards. Keep
  folder config user-authored. Make status consume the same parsed live working
  set as sync.
- **Existing test seams.**
  `test/connectors/connector-google-calendar.doctest.md:282-357` wraps a fake
  calendar to force 410 recovery. `test/connectors/connector-drive.doctest.md:16-207`
  uses a fake Drive service and temporary Git box. Extend these files rather
  than create a new test tier.

## Prior art (external)

- Google's Calendar synchronization guide says a `410` invalid sync token
  requires clearing the local collection and performing a new full sync:
  [Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync).
  The current connector retries without the token but does not reconcile local
  entries absent from the new full response. That adjacent defect is filed
  separately and is not silently folded into this plan.
- Google's Calendar error guide distinguishes invalid-sync-token `410` from
  other API errors and prescribes full resync only for that case:
  [Handle API errors](https://developers.google.com/workspace/calendar/api/guides/errors).
- Google Drive folder membership is a `files.list` query filtered by parent,
  and the API returns current remote members rather than local subscription
  intent: [Search for files and folders](https://developers.google.com/workspace/drive/api/guides/search-files).
  Callback-box's explicit folder mount remains the authoritative subscription;
  a committed trash card is the per-child exclusion.
- No external prior art controls callback-box's card-as-subscription semantics.
  Gmail and the existing Drive card model are the relevant precedents.

## Tracks / scope

### Track 1 — Calendar member isolation with visible run failure

**What:** continue configured calendars after one calendar returns an ordinary
sync error. Preserve and commit all completed writes. Report every failed
calendar in the connector result and in any resulting Calendar commit. Finish
the wakeup cycle, then exit nonzero; an enabled scheduled task records that
process failure.

**Why this needs to change:** the early return prevents later calendars, local
delete/push passes, the final state save, and the explicit commit. Replacing
`return` with `continue` alone would lose paths written before a mid-calendar
exception and would still let scheduled wakeup report success.

**Direction:**

1. Give `runCalendarSync` a closed `CalendarSyncOutcome` union with `synced`
   (including `fullResync`) and `failed` variants. `CalendarSyncFailure`
   contains calendar ID, a controlled operation enum, optional HTTP
   status/status text, and error class. This is a sanitized diagnostic shape,
   not an exception serialization. Use `assertNever` at dispatch sites.
2. Move the `SyncAccumulator` for one calendar to `runCalendarSync` and pass it
   into `syncCalendar`. Merge that accumulator into connector-wide arrays on
   both success and failure, so a failed calendar can leave partial but fully
   attributed progress.
3. Snapshot the calendar's incoming sync token before each attempt. On an
   ordinary failed outcome, restore that exact token (or delete it if it was
   absent) before saving state. Replaying successfully reconciled events is
   idempotent and prevents an advanced token from skipping the failed tail.
4. Detect an expired token only from `HTTPError.response.status === 410`; do not
   infer it from error-message text. Delete the stale token and run the full
   retry inside the same protected attempt. If the retry fails, return a typed
   failure and keep the stale token absent so the next run attempts a full sync
   again rather than restoring a known-invalid token.
5. Collect failed outcomes and continue the sequential calendar loop.
   Sequential mutation avoids new state and Git races.
6. Run `processLocalDeletes`, `pushAndCleanOrphans`, the final `saveState`, and
   `stageAndCommitPaths` after the loop even when one or more pulls failed.
   Unexpected errors in these connector-wide passes still throw.
7. Extend `buildNarrativeCommitMessage` with the typed failure shape. Prefix
   partial commits with `Sync calendar: partial` and add a `Failed calendars:`
   body. Format only calendar ID, operation, HTTP status/status text, and error
   class. Never include a raw exception message, request URL, query string,
   sync token, or event content.
8. Return `success: false` plus one aggregate, sanitized `error` string when
   failures are nonempty. Keep completed `created`, `updated`, and `pushed`
   results. Do not widen the public `SyncResult` with a calendar-only array.
9. Return `errorCount` from `runConnectors`. `cb wakeup` keeps running stale-job
   cleanup, intake, index/backfill, reactor, and Git push. At the end of the
   action, set a nonzero process exit status when `errorCount > 0`. This is an
   intentional wakeup-wide contract change: connector result errors and
   connector procedure-trigger failures all make wakeup nonzero, not only
   Calendar failures. Test representative result-error, thrown-error, and
   procedure-trigger paths.

**Vocabulary lock-ins:** `partial` means useful work was committed but at least
one configured calendar failed. It never means success. A `fullResync` remains
the existing token-recovery outcome; this plan does not claim that stale-event
cleanup is complete.

**First implementation chunk:** write the failing calendar doctests, then add
the typed outcome, caller-owned accumulator, token rollback, protected 410
retry, aggregate result, and partial commit message. No wakeup exit change
lands without the connector test showing later calendars and post-loop work
still complete.

### Track 2 — Drive live working set and trash tombstones

**What:** stop syncing cards in trash and use their Drive IDs as the per-child
exclusion set during folder discovery. Do not introduce a second durable
registry beside the committed trash card.

**Why this needs to change:** ignoring `store/trash/**` in the active glob fixes
individual cards but not folder children: folder discovery would immediately
re-create them unless it can still see the trashed card's ID. The current issue
also combines that real trash bug with a different contract: a raw hard delete
removes every record of the child while the explicit folder mount still says to
discover all remote children.

**Direction:**

1. Add `src/connectors/google-drive-tracking.ts`. It owns Drive card discovery
   and `drive-id` parsing for both YAML and legacy card formats. Return live
   cards outside infrastructure/trash plus Drive IDs found under
   `store/trash/**`. Ignore `node_modules/**`, `.git/**`, `tmp/**`,
   `.callback-box/**`, and `procedure/runs/**`. Keep archive behavior unchanged.
2. Sync only live cards. Pass the union of live and trashed Drive IDs to every
   folder-discovery pass. A trashed child is therefore neither synced nor
   re-created, while a genuinely new remote child still appears.
3. Make `cb drive status` use the same helper and show live mounts only. This
   also replaces its legacy-only regular-expression parsing with the connector's
   actual YAML/legacy parser.
4. Restoring a trash card to a live path resumes its normal sync. `cb drive add`
   remains the explicit way to create a per-file card.
5. Lock in hard-delete semantics instead of fabricating hidden state:
   - hard-deleting an individually added card untracks it because no folder
     mount claims it;
   - hard-deleting a folder-mounted child allows the authoritative folder mount
     to discover it again;
   - use `cb rm` to exclude one child durably, or remove the folder mount to stop
     tracking the whole folder.

**Vocabulary lock-ins:** a live Drive card is a subscription. A trashed card is
a durable untracking tombstone. A folder mount is an explicit subscription to
its supported remote children. Raw filesystem absence is not a tombstone for a
folder-mounted child.

**First implementation chunk:** write trash and folder-discovery doctests,
then add the shared live/trash scan. The chunk ends with explicit outcomes for
an individual trash, a folder-child trash, restoration, individual hard delete,
folder-child hard delete, and status output.

### Track 3 — Contract documentation and catalog recheck

**What:** update Drive reference/agent guidance, add one knowledge audit, and
re-run only the two affected user stories after implementation.

**Why this needs to change:** untracking is an agent and boxholder action, not
only an internal scan rule. The catalog remains flagged until its own
adversarial recheck confirms the implementation.

**Direction:**

1. Update `docs/google-drive.md` and the Drive skill text in
   `src/core/box/skills-content.ts`: `cb rm <card>` stops sync without deleting
   the remote file; restoring/recreating it resumes sync; a raw hard delete of
   a folder child does not override the still-configured folder mount.
2. Add one `knows_directly` audit asking how to stop and resume one Drive file
   without deleting the remote file. Run it against the isolated test box and
   record its status comment.
3. Revise/re-key the overbroad Drive catalog story so it describes the supported
   `cb rm`/trash gesture and authoritative folder-mount behavior. A recheck
   cannot make the current "deleting its card" claim true by itself.
4. Recheck only these catalog IDs, then apply/render the 2026-08-21 catalog:
   - `connectors/calendar-sync-repairs-an-expired-sync-token-and`
   - `connectors/stop-syncing-something-by-deleting-its-card`
5. Update both issues with the implementation result and precise automated/live
   verification boundary.

**Vocabulary lock-ins:** use `track`, `untrack`, `live card`, `trash`, and
`restore`. Do not add an `unsubscribe` command.

**First implementation chunk:** docs and audit text land only after Tracks 1
and 2 make the statements true.

## Could this be simpler?

The smallest calendar patch replaces the early `return` with `continue`. It
fails when one event is written before a later event throws: the path lives on
disk but not in the returned accumulator, so the explicit commit misses it. It
can also save an advanced sync token and permanently skip the unprocessed
tail, and the raw exception text can expose a request URL containing the token.
Caller-owned accumulation, token rollback, typed diagnostics, and end-of-cycle
nonzero status buy complete attribution and visible degradation, required by
principles 4 and 10.

The smallest Drive patch adds `ignore: ["store/trash/**"]`. It fails for a
folder child because the folder pass sees no live ID and creates the card again.
Scanning trash IDs as tombstones closes that gap with the state callback-box
already commits. A separate discovery-history file would duplicate intent and
create migration, locking, and corruption behavior merely to make raw hard
delete override an explicit folder mount. This plan does not add it.

No shared connector framework is added. The tracks do not share a cause, and a
generic protocol with only two dissimilar callers would not simplify them.

## Subplans

None. The adjacent 410 stale-event problem has its own issue because it needs a
separate decision about remote absence versus locally edited ICS files.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| First calendar fails; second succeeds | new calendar doctest | collect failure, continue, commit second, return error | clear in result, commit, manual exit, and enabled-schedule health |
| Calendar writes one event and throws later | new mid-reconcile doctest | caller-owned accumulator retains completed paths | clear |
| Failed reconciliation advanced its sync token | new token-rollback doctest | restore the pre-attempt token before save | clear and retryable |
| Full retry after a 410 also fails | extend 410 doctest | catch inside the member boundary; keep stale token absent | clear and retryable |
| Every configured calendar fails | new calendar doctest | post-loop work runs; no false success | clear |
| Post-loop pass throws unexpected non-HTTP error | existing connector boundary; add assertion if touched | connector aborts; wakeup counts it | clear |
| Wakeup gets any connector/procedure result error | new wakeup status tests | finish all phases, then exit nonzero | clear manually; health only for enabled schedule |
| Calendar exception contains request URL/sync token | new string assertion | formatter accepts typed calendar/operation/status/error-class fields only | clear and secret-safe |
| Individual Drive card is trashed | new Drive doctest | excluded from live sync; trash ID is tombstone | clear |
| Folder child is trashed | new Drive doctest | trash ID suppresses recreation | clear |
| Trashed card is restored | new Drive doctest | live scan resumes sync | clear |
| Individually mounted card is hard-deleted | new Drive doctest | no card or folder claim remains; no sync | clear |
| Folder child is hard-deleted | new Drive doctest/docs | authoritative folder mount recreates it | clear, intentional |
| Status sees YAML card or trash card | new status doctest | shared parser reports only live YAML/legacy cards | clear |

No critical gaps remain. Live Google behavior remains an explicit verification
boundary rather than an inferred success claim.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** No card field or tag is added. Agents
  use `cb rm`/restore.
- **Stale ref — ADDRESSED.** Restoring a trashed card to a new live path works
  because identity comes from `drive-id`, not the prior path.
- **Two agents touching the same card — ADDRESSED.** A concurrent restore is
  found by the fresh live-card scan; there is no second state write to merge.
- **Hand-edit drift — ADDRESSED.** Shared parsing uses the existing card parser
  for YAML and legacy cards. User-authored folder config remains separate.
- **Fabricated free-form value — ADDRESSED.** No new field or registry accepts
  free-form values.
- **Validation error UX — UNCHANGED.** Existing card/config validation remains
  the boundary; this work adds no new persisted schema.
- **Partial migration / transition state — NOT APPLICABLE.** Trash cards already
  exist in the committed box tree; there is no new persisted state to seed.
- **Agent deletes the remote file too — ADDRESSED.** Local untracking never
  calls a remote delete API.
- **Agent wants to re-track one excluded file — ADDRESSED.** Restore the card or
  use `cb drive add`; a live card is synced normally.

## NOT in scope

- **Stale-event cleanup after Calendar 410.** Google prescribes a local reset,
  while local ICS files can carry pending edits. Safe absence reconciliation is
  tracked in
  `issues/bugs/2026-08-23-calendar-410-resync-does-not-remove-stale-events.md`.
- **Calendar metadata-list failure isolation.** `fetchAvailableCalendars`
  happens before the member loop and is connector-wide.
- **Parallel calendar requests.** The goal is failure isolation, not throughput.
- **A general multi-error `SyncResult` redesign.** Calendar-specific structured
  failures stay internal until a second caller needs them.
- **A new connector-health store or panel.** Scheduled-task health already
  provides persistent status and alerts once wakeup exits honestly, but only
  when the task is enabled and notification thresholds/channels are satisfied.
- **Changing `cb finalize` exit behavior for all connector errors.** Scheduled
  Calendar pulls use wakeup; broader CLI consistency is separate.
- **Drive folder-mount configuration UI/CLI.** The caller-less tRPC mutation is
  a separate issue. This plan changes only working-set discovery.
- **A durable hard-delete exclusion for folder children.** A configured folder
  remains authoritative; use `cb rm` for one child or remove the mount for the
  folder.
- **Drive's existing swallowed per-card/folder error reporting.** It deserves a
  connector-wide result/health design, but the untracking tests can prove that
  excluded cards cause no fake-service calls or recreation without folding that
  broader change into this work.
- **Archive semantics, remote Drive deletion, or duplicate live `drive-id`
  policy.** None is required to fix the supported trash gesture.

## Open design questions

None blocking. For the 410 follow-up, the lean is to reconcile a full response
against the prior per-calendar index after fetching rather than blindly delete
local files first. This plan does not decide that work.

## Knowledge audits

Add one `knows_directly` entry for the Drive lifecycle. It must establish that
the box agent knows:

1. `cb rm <drive-card>` stops local sync without deleting the remote Drive
   file; raw hard deletion has different semantics when a folder mount still
   claims the child.
2. Restoring the card or running `cb drive add` resumes sync.
3. For a folder-mounted child, `cb rm` is the supported per-child exclusion;
   raw hard deletion does not override the configured folder mount.

Run it with `pnpm knowledge-audit run --box
~/src/box-worktrees/connector-sync-isolation/test1 --filter <new-id>` and record
the result comment. No Calendar audit is needed; error handling is runtime
behavior, not an agent-facing convention.

## Implementation order

1. **Chunk 1 — Calendar tests and member outcome.** Add fake-service doctests
   for bad-first/good-second, mid-calendar partial writes, token rollback,
   failed 410 retry, post-loop work, sanitized aggregate error, and partial
   commit. Implement the typed outcome and caller-owned accumulator.
2. **Chunk 2 — Wakeup failure propagation.** Return connector error count,
   defer nonzero status until every phase completes, and add focused assertions
   for result errors, thrown connector errors, procedure-trigger errors, and the
   enabled-schedule health path.
3. **Chunk 3 — Drive tests and tracking scan.** Add tests for individual trash,
   folder-child trash, restoration, both hard-delete cases, YAML/legacy parsing,
   and status. Extract and integrate the shared live/trash scan.
4. **Chunk 4 — Contract and verification.** Correct the catalog story wording,
   update docs/skill, run the knowledge audit, run targeted/full checks, and
   recheck the two catalog stories.

Chunks 1-2 and 3 are implementation-independent. Chunk 4 depends on both.
The complete plan ships as one unit.

## Rollout shape

- **Tests first:** extend the existing Calendar and Drive connector doctests.
  Use service fakes only; tests never call Google.
- **Targeted verification:** run the affected doctests with
  `pnpm --dir callback-box exec tap -j1 <paths>`, then run
  `pnpm --dir callback-box typecheck`, `pnpm --dir callback-box lint`,
  `pnpm --dir callback-box doc-check`, and `pnpm --dir callback-box test`.
- **Knowledge verification:** run the new audit against the isolated test box
  and record its observed status. A written but unrun audit is not coverage.
- **Catalog verification:** run the issue-provided targeted recheck for exactly
  the two story IDs, apply results, and render the catalog.
- **Migration:** none. The implementation reads existing live and trash cards;
  it adds no card field, user config, or connector-owned persisted state.
- **Live Google boundary:** the local test box is not authenticated to Google.
  Completion must state that no live Calendar/Drive account was exercised. An
  optional credentialed smoke can confirm real API behavior and a trash/restore
  cycle, but the plan does not pretend that check happened or block
  deterministic fake-service verification on it.
- **Issue lifecycle:** close only when doctests, command status, docs/audit, and
  targeted catalog recheck agree. Record any residual live check precisely
  instead of claiming it.
