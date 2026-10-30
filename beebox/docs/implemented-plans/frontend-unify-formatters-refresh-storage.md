---
title: "Unify frontend time, byte and card-name formatting, live refresh, and browser storage"
status: implemented
workstream: dup-sweep-frontend
issues:
  - ../../../issues/closed/code-quality/2026-10-23-frontend-live-refresh-hooks-disagree.md
  - ../../../issues/closed/code-quality/2026-10-23-frontend-time-and-duration-formatters.md
  - ../../../issues/closed/code-quality/2026-10-23-byte-size-formatters-disagree.md
  - ../../../issues/closed/code-quality/2026-10-23-card-display-name-helpers-disagree.md
  - ../../../issues/closed/code-quality/2026-10-23-browser-storage-keys-and-reads-inconsistent.md
---
# Unify frontend time, byte and card-name formatting, live refresh, and browser storage

The frontend duplication sweep (2026-10-23) filed five groups whose copies
differ in visible output or behavior. The boxholder asked to unify all five.
This plan picks one rule per group and moves every caller onto it.

**Issues addressed:** the five in frontmatter. Related, not closed by this
plan: [browse-list-live-refresh-not-firing](../../../issues/bugs/2026-07-31-browse-list-live-refresh-not-firing.md)
(Track 5 changes the code it names; see Failure modes). Searched the queue
for "relative time", "formatBytes", "humanBytes", "display name", "storage
key", "file-change": no other open duplicates.

## Design

No design section: the visible choices were made by the boxholder on
2026-10-23 in this session (answers quoted in Direction). The work changes
wording and formatting of existing text, not what a person meets.

Boxholder decisions (2026-10-23, answers to four questions):
- Time: "Compact: 3m ago" — "just now" under a minute, then 3m / 2h / 4d ago,
  then a date after a week; durations "3m 20s".
- Bytes: "2 KB, 1.5 KB" — drop a trailing .0, one decimal below 10, shared rule
  plus a 0/NaN/negative guard.
- Card names: "displayName everywhere" — one rule across the frontend, and the
  backend `titleFromFilename` aligned to match.
- Storage keys: "Read old key once" — new scoped key, fall back to the old
  slug key on first read, write only the new key.

## Smallest fix and budget

Smallest fix per issue: move each caller onto the existing helper that is
closest to the chosen rule. That is what the tracks do; no track adds a new
subsystem. Estimated changed lines (additions plus deletions):

| Track | Source | Tests |
|---|---|---|
| 1 Bytes | 60 | 30 |
| 2 Time and dates | 260 | 90 |
| 3 Card names | 200 | 80 |
| 4 Storage | 220 | 90 |
| 5 Live refresh | 550 | 120 |
| Total | about 1,300 | about 410 |

Under the 2,000-line BIG CHANGE line. Docs: this plan only.

## Stated preferences this plan trades against

- Root `AGENTS.md`, "Implement and verify": reuse the platform mechanism
  before inventing one. Each track extends an existing helper
  (`humanBytes`, `relative-time.ts`, `parseCardFileName`, `storage-scope.ts`,
  `useBusSubscription` + `useDeferredResync`) rather than a new one.
- Boxholder memory "Bias toward strict": the storage track adds validation and
  try/catch to unguarded reads (fail closed to defaults).
- Boxholder memory "Stop over-engineering rare failures": the legacy-key
  fallback reads once and does not delete old keys or run a migration pass.
- The sweep brief's "no abstraction with one caller": every new helper below
  has at least three callers.

## What already exists

- `beebox/src/shared/human-bytes.ts:11` `humanBytes` — the chosen byte rule;
  no guard: *"if (bytes < 1024) return `${String(bytes)} B`;"*. Reuse; add the guard.
- `beebox/src/frontend/src/lib/format-bytes.ts:7` `formatBytes` — about ten
  importers; rebuild as a call to `humanBytes` is not needed; callers switch.
- `beebox/src/frontend/src/lib/relative-time.ts:13` `formatElapsed`, `:24`
  `formatAgo`, `:34` `compactAgo` (tested in `test/lib/relative-time.test.ts`).
  Reuse the module; change the rules.
- `beebox/src/frontend/src/components/ui/FriendlyDate.tsx:22` `formatOptions` —
  the date rule, with the date-only UTC case. Reuse for absolute dates.
- `beebox/src/shared/card-name.ts:27` `parseCardFileName` — the card filename
  grammar (nominal, positional, `.job.card`). Reuse as the base of the name rule.
- `beebox/src/frontend/src/lib/display-name.ts:9` `displayName` — the chosen
  name rule for card files; its regex mis-reads `.job.card`
  (`/^(.+)\.[^.]+\.card$/` gives "x.report" for `x.report.job.card`).
- `beebox/src/core/file-summary.ts:70` `titleFromFilename` — backend title from
  a path, five importers; cuts at the first dot.
- `beebox/src/frontend/src/lib/card-title.ts:11` `cardTitle(data)` — title,
  landmark label, name, then filename.
- `beebox/src/frontend/src/lib/storage-scope.ts:20` `storageScopeFor` and the
  key convention in `lib/dictation-draft.ts:49-51`: *"const instance =
  opts.scope === "" ? opts.boxSlug ?? "default" : opts.scope;"*.
  `pages/box-screen/state.ts:81` repeats it. Reuse; extract.
- `components/chat/workspace/WorkspaceProvider/workspace-browser-store.ts:36`
  `trustsLegacyKey` — the legacy slug-key trust rule. Reuse; move.
- `lib/session-json.ts` (this workstream) — typed sessionStorage JSON.
- `hooks/useBusSubscription.ts` with `onReconnect` (this workstream),
  `hooks/useDeferredResync.ts`, `lib/moved-card-recovery.ts:21`
  `fileChangeAffectsPath`. Reuse all three inside one hook.

## Prior art (external)

No decision depends on an external premise; no search made.

## Ontology

No new nouns. Names used below, all existing: file-change event
(`core/event-bus/schemas.ts:91`), box-relative path (`shared/box-path.ts`),
storage scope (`lib/storage-scope.ts`), card display name (`displayName`).
New function names are listed per track under Vocabulary lock-ins.

## Tracks / scope

### Track 1 — Byte sizes

- **What:** one byte formatter, `humanBytes` in `shared/`.
- **Why:** chat chips say "2 KB" (`shared/delivered-user-message.ts:278`) and the
  file view says "2.0 KB" (`renderers/binary.tsx:43` via `formatBytes`);
  PublicationReviewCard shows "1536.0 MB" for 1.5 GB.
- **Direction:** `humanBytes(bytes)` returns "0 B" for a non-finite or
  non-positive value; otherwise unchanged. Delete `lib/format-bytes.ts`;
  its importers import `humanBytes` from `@shared/human-bytes`. Delete the local
  copies in `PublicationReviewCard.tsx:280`, `browser-task/SubmissionForm.tsx:196`,
  `admin/BackupSection.tsx:22`. `ChatAttachments.tsx:93` uses `humanBytes` instead
  of whole-KB rounding.
- **Vocabulary lock-ins:** none new.
- **First chunk:** guard + test in `test/shared/human-bytes.test.ts`, then callers.

### Track 2 — Relative time, durations, absolute dates

- **What:** one "x ago" rule, one duration rule, one absolute-date rule.
- **Why:** the issue's table: six "x ago" variants (floor vs round, units,
  seconds tier, clock), four duration formats, fourteen raw
  `toLocaleString()` calls that print "Invalid Date" on bad input.
- **Direction** (in `lib/relative-time.ts`):
  - `formatAgo(atMs: number, nowMs: number): string` — under 60 s "just now";
    then floor to "3m ago", "2h ago", "4d ago"; at 7 days or more the date
    ("Sep 15", plus ", 2025" when the year differs from `nowMs`'s year).
  - `agoOnClock(ts: string | number, clock: "box" | "real"): string` — parses
    `ts`, reads `boxNow()` or `Date.now()`, calls `formatAgo`. Replaces
    `compactAgo`. An unparseable `ts` returns the raw string.
  - `formatDuration(ms: number): string` — under 1 s "850ms"; under 10 s one
    decimal "1.2s"; under 60 s "45s"; then the two largest units with no zero
    tail: "3m 20s", "3m", "1h 5m", "2d 3h".
  - Delete `formatElapsed`. `capture-bubble.tsx:130` uses `formatDuration`.
  - Callers: `session-search.tsx:28`, `SessionRow.tsx:29`, `CommitTimeline.tsx:52`
    (box clock), `RecentActivity.tsx`, `ScheduleOverview/view.tsx` (both clocks),
    `RecoveredDictation.tsx:41`, `capture-bubble.tsx:126`, `last-change-line.ts:12`.
    Durations: `BackgroundTasks.tsx:32`, `InteractiveChat-controls.tsx:33`
    (countdown: the caller rounds up to whole seconds first),
    `ScheduleOverview/view.tsx:31` and `:205`, `RecentActivity.tsx:114`.
  - Captions re-render: the list components that show an age read a shared
    60-second clock (`useNow(60_000)` from `lib/use-now.ts`, or `useBoxNow` for
    box-clock stamps) and pass it as `nowMs`: SessionListPanel, session-search,
    SessionRow, CommitTimeline, RecentActivity, ScheduleOverview.
  - Absolute dates: export `friendlyDate(value: string | number, mode?)` from
    `FriendlyDate.tsx` (the component calls it). Bare `toLocaleString()` and
    `toLocaleDateString()` sites switch to it: `renderers/image.tsx:175`,
    `renderers/gsheet.tsx:119`, `SecretsSection/machine.tsx:41`,
    `SecretsSection/box.tsx:73`, `dashboard/SystemInfo.tsx:23,35`,
    `ScheduleOverview/RunStrip.tsx:35`, `CommitDetail-commit.tsx:109`,
    `CaptureResumeDialog.tsx:40`, `InventoryContent/view.tsx:186`,
    `Markdown/Source.tsx:173` (date mode). Sites with a deliberate custom format
    keep it: `CompanionPairingSection.tsx:51` (month, day, time, no year) and
    `todo/item-logic.ts:88` `dayLabel` (year only when it differs).
- **Not changed:** `formatTimePassed` (`InteractiveChat-helpers.ts:117`, a wire
  attribute for the agent), time-only `toLocaleTimeString()` sites (see NOT in
  scope).
- **Vocabulary lock-ins:** `formatAgo(atMs, nowMs)`, `agoOnClock`,
  `formatDuration`, `friendlyDate`.
- **First chunk:** new `relative-time.ts` functions with tests, no callers yet.

### Track 3 — Card display names

- **What:** one path-to-name rule shared by frontend and backend.
- **Why:** the issue's table: seven helpers, two of which show the card type
  ("my-soup.recipe"); FileView's chat header ignores landmark labels and names.
- **Direction:**
  - `shared/card-name.ts` gains `cardDisplayName(pathOrRef: string): string | null`:
    the basename (after `?` and `#` are cut), parsed by `parseCardFileName`; a
    nominal name has `[_-]+` read as one space; a positional `type.card` gives
    the type; a non-card name returns null.
  - `shared/card-name.ts` gains `titleFromFilename(path)`, moved from
    `core/file-summary.ts:70`: `cardDisplayName(path) ?? <the current stem rule>`.
    The six live backend importers (`core/loader-registry.ts:16`, `core/nav.ts:15`,
    `core/landmark/resolve/link-build.ts:13`, `core/search/extract/core.ts:22`,
    `webapp/trpc/routers/views.ts:22`, `schemas/image/schema.tsx:20`) import it from
    shared; `file-summary.ts` keeps no copy.
  - The memo migration (`scripts/migrate/retire-memo/plan.ts:44`) writes a
    filename-derived `title:` and compares an already-written file byte for byte
    on retry (`plan.ts:323`). It keeps the old first-dot rule as a private
    function, so a retried migration still matches what it wrote.
  - The search index stores titles and skips unchanged files on refresh
    (`core/search/refresh/file.ts:60`). Bump `SEARCH_SCHEMA_VERSION`
    (`core/search/store/core.ts:47`, now 5) so an existing index rebuilds with the
    new titles.
  - Frontend: `displayName(path)` = `cardDisplayName(path) ?? basename`.
    `refLabel` keeps its ref handling (`(missing ref)`, fragment, leading `/`)
    and names the basename with `displayName`. `activity-wording.ts:81`
    `cardTitle` = `cardDisplayName`. `exports/view-widgets.tsx:34` `filenameTitle`
    = shared `titleFromFilename`. `user-message-text.tsx:19` `docBasename` and
    `ChatSelections.tsx:16` `docName` use `displayName` (keeping their
    "chat"/"Chat" fallback for an absent ref).
  - `FileView/view.tsx:56` private `cardTitle` is deleted; ChatHeader receives
    `lib/card-title.ts` `cardTitle(data)`. `lib/card-title.ts` skips a blank
    `title:` (FileView's existing rule: *"title.trim() !== """*).
- **Behavior changes (intended):** `Foo.v2.doc.card` reads "Foo.v2" everywhere
  (backend was "Foo"); `x.report.job.card` reads "x" (frontend was "x.report");
  `a__b.doc.card` reads "a b"; non-card refs in source and see-also chips keep
  their underscores ("my_file.pdf"); chat pills drop the type.
- **Vocabulary lock-ins:** `cardDisplayName`, shared `titleFromFilename`.
- **First chunk:** shared functions with tests in `test/shared/card-name.test.ts`.

### Track 4 — Browser storage

- **What:** one key rule for per-box browser state, guarded storage calls, one
  stored-flag helper.
- **Why:** `lib/location-share.ts:63` keys by slug alone, so dev worktrees share
  it; `location-share.ts:101` and `BoxScreenPage.tsx:52` call storage outside a
  try; `pages/capture/api.ts:120` writes without a try and `:110` returns
  unvalidated JSON; five flag copies.
- **Direction:**
  - `lib/storage-scope.ts` gains `boxInstanceKey({ boxSlug, scope })` (the
    `dictation-draft.ts:50` rule). `draftKey`, `boxScreenStorageKey` and
    `locationShareKey` use it.
  - `locationShareKey(boxSlug)` uses `boxInstanceKey` with the scope derived
    inside `lib/location-share.ts` from `storageScopeFor(getApiBase())`, so its
    callers (`useLocationShare.ts:37`, `use-native-bridge.ts:57,220`,
    `dispatch.ts:92`) keep their signatures and cannot read and write different
    keys. In production the scope is `""` (`storage-scope.ts` doc: *"In
    production `apiBase` is `/api`, so the scope is the empty string"*), so the
    production key is unchanged and nothing resets.
  - No legacy fallback. The boxholder chose "read old key once" so that no
    production toggle resets; the production key does not change, so that holds
    without a fallback. In dev the old value is keyed by slug alone and cannot be
    attributed to one worktree (`trustsLegacyKey` rejects `dup-sweep-frontend/test1`
    with slug `test1`), so reading it is the leak this track removes. A dev
    worktree's toggle reads off once.
  - The read is in a try; a throw reads as disabled. Today the same throw
    escapes into render (`location-share.ts:101` calls `getItem` bare).
  - `BoxScreenPage.tsx:51` `readStored` wraps `getItem` in a try (null on throw).
  - `capture/api.ts` `loadDevicePrefs` validates with a zod schema;
    `saveDevicePrefs` wraps `setItem` in a try.
  - `lib/stored-flag.ts`: `readStoredFlag(storage, key)` and
    `writeStoredFlag(storage, key, on)` — "1"/"0" values, try/catch, absent
    storage reads false. Callers: `DebugLog.tsx:162`, `InteractiveChat/hooks.ts:24`,
    `ThemeStudioHarness/controls.tsx:18`, `scroll-diagnostics/diagnostics.ts:38`.
- **Not changed:** `sidecar-tabs-storage.ts:27`: it is read only, behind the
  trust check (`workspace-browser-store.ts:123-124`), and nothing writes it.
  `BrowseSidebarBody/hook.ts:21` stores an enum, not a flag.
- **Vocabulary lock-ins:** `boxInstanceKey`, `readStoredFlag`, `writeStoredFlag`.
- **First chunk:** `storage-scope.ts` functions with tests; switch `draftKey` and
  `boxScreenStorageKey` (no key change).

### Track 5 — Live refresh

- **What:** one hook for "refetch when the box changes".
- **Why:** the issue lists three path-match rules, three reconnect behaviors,
  two debounce windows and three hand-written event lists. Two views double-fetch
  on mount; five never resync after a dropped socket.
- **Direction:** `hooks/useLiveRefresh.ts`:

  ```ts
  export function useLiveRefresh(opts: {
    /** Which bus events call for a refresh. */
    when: (event: RealtimeEvent) => boolean;
    refresh: () => void;
    /** Collapse a burst: refresh once, this long after the first event. Default 0. */
    burstMs?: number;
  }): { connected: boolean };
  ```

  A matching event, and every reconnect after the first, request a refresh
  through `useDeferredResync` (same-tick coalescing, parked while the tab is
  hidden). With `burstMs`, an event starts one timer and later events in the
  window are ignored. Matchers in `lib/live-refresh.ts`:
  `fileChangeAt(path)` (wraps `fileChangeAffectsPath`), `anyFileChange`,
  `oneOf(...eventNames)`. DirectoryTodos keeps its own predicate (one caller),
  normalized with `boxRelativePath`.

  | Caller | when | burstMs | Change for the person |
  |---|---|---|---|
  | `useRefetchOnFileChange` (CardLastChange, CardAttachments, CardProperties, PlaceView) — hook deleted | `anyFileChange` | 500 | no first-connect refetch |
  | `BoxPresentationProvider.tsx:37` | config, schema or landmark change | 150 | no first-connect refetch |
  | `file-view-data.ts` | `fileChangeAt(path)` | 0 | events also coalesce |
  | `useCardIdentities.ts` | any of the keyed paths, `fileChangeAt` | 0 | rename now matches |
  | `AgentViewRenderer.tsx` cards | `.card` or dependency prefix | 0 | events coalesce; module reload stays separate |
  | `BrowsePage.tsx:46` | `.card`-or-file change whose box-relative parent is `dirPath` | 0 | path normalized |
  | `PlacePill.tsx` | landmark change | 0 | none |
  | `FigureView/view.tsx:95` | `fileChangeAt(entryPath)` | 0 | path normalized; reconnect resync added |
  | `BrowserTaskView.tsx:76` | card or attach dir | 0 | reconnect resync added |
  | `CardTodos.tsx:49` | `fileChangeAt(path)` | 0 | reconnect resync added |
  | `DirectoryTodos.tsx:44` | its own `.card`-under-`dir` predicate | 0 | path normalized; reconnect resync added |
  | `TodoViewCard.tsx:188` | any `.card` change | 0 | reconnect resync added |
  | `AppNav/nav.tsx:115`, `QuestionsList.tsx:85`, `DashboardPage.tsx:41` | `oneOf(...)` with their current lists | 0 | reconnect resync and hidden-tab deferral for the latter two |

- **Not converted:** `lib/view-bindings.ts:113`: its module-level cache
  (`view-bindings.ts:55`) is read by any newly mounted card, so invalidation must
  not wait for the tab to become visible; it already uses `onReconnect`.
  `turn-edits.ts:63` (tracks which open files a turn edited;
  not a refresh), the chat machine subscribers (`ws.ts`, `shell.tsx`,
  `use-conversation-machine.ts`, `use-conversation-selection.ts`,
  `NotificationBanner.tsx`). `AmbientReplies/view.tsx:51` keeps its
  refresh-on-show; its effect gets a deps array and reads `refreshAll` through a
  ref, so the listener is added once.
- **Vocabulary lock-ins:** `useLiveRefresh`, `fileChangeAt`, `anyFileChange`, `oneOf`.
- **First chunk:** hook and matchers with tests; convert `useRefetchOnFileChange`
  callers.

## Could this be simpler?

The simplest version per track: Track 1 deletes `formatBytes` only; Track 2
merges only the two session pickers; Track 3 fixes only `docName`/`docBasename`;
Track 4 adds try/catch only; Track 5 normalizes only FigureView and BrowsePage.
That fixes the visible defects named in the issues but leaves the next view to
copy one of several rules again, which is the failure the sweep exists to stop
(`issues/code-quality/2026-10-22-functional-duplication-sweep.md`: *"Each copy
drifts, and a fix lands in one copy only."*). The boxholder asked to unify, so
the fuller version is the requested scope. What the plan does not build: no
generic storage abstraction (one flag helper and one JSON helper), no
live-refresh event registry (each caller keeps its own `when`).

## Subplans

none

## Failure modes

> **Critical gap:** none found. The closest is Track 5's deferral: a view whose
> data must stay current while hidden would go stale. View bindings are such a
> cache and are not converted (Track 5, Not converted). The converted callers
> render on-screen data.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `humanBytes(NaN)` printed "NaN KB" | add in human-bytes test | guard | clear after fix |
| `formatAgo` with a future timestamp (box clock behind) shows "-3m ago" | add: negative elapsed reads "just now" | clamp at 0 | silent today |
| `agoOnClock` with an unparseable string | add | returns raw string | clear |
| A backend title changes for a multi-dot card name (search titles, nav labels) | add in card-name test | intended | visible; noted in commit |
| `refLabel` on a non-card ref keeps underscores now | add in ref-label test | intended | visible |
| A dev worktree's location toggle reads off once after the key change | n/a | intended, dev only | visible |
| `localStorage.getItem` throws in private mode on BoxScreen | add | try → null | clear |
| Two quick file changes 600 ms apart under `burstMs: 500` | add hook test | second event starts a new window | clear |
| Live refresh fires after unmount | covered by `useDeferredResync` dispose | yes | clear |
| BrowsePage still misses a new file (the open bug) | browser probe before and after | none | visible; see below |

The browse live-refresh bug reproduced on this worktree's test1 on
2026-10-23: a card written into the open directory did not appear in the
Browse sidebar within 12 s. The event path shape (`core/box/file-watcher.ts:419-423`,
root prefix plus local path) matches `dirPath` by reading, so normalization may
not be the cause. The plan re-runs the probe after Track 5 and reports the
result on the bug; it does not claim a fix.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-facing vocabulary. ADDRESSED.
- Stale ref: a renamed directory under an open card. ADDRESSED by
  `fileChangeAt` (rename rule in `moved-card-recovery.ts:28`).
- Two agents touching the same card: bursts of file-change events. ADDRESSED by
  coalescing and `burstMs`.
- Hand-edit drift: a hand-named card `My.Notes.doc.card`. ADDRESSED: reads
  "My.Notes" everywhere (Track 3).
- Fabricated free-form value: not applicable.
- Validation error UX: capture device prefs that fail validation read as
  defaults. ADDRESSED (Track 4).
- Partial migration / transition state: none; the production location-share
  key is unchanged and dev starts fresh. ADDRESSED.

## NOT in scope

- Time-only displays (`toLocaleTimeString`: `InviteSection.tsx:98`,
  `AllowedEmailsSection.tsx:103`, `ScheduleTicks.tsx:54`, `SessionLog.tsx:85`,
  `deploy-page/poll.ts:40`): logs and expiry times where seconds may matter;
  not part of the "x ago" choice.
- `formatTimePassed`: a wire attribute the agent reads, not display text.
- `shared/attach-path.ts` `cardBasename`: names attach directories; it must keep
  the exact filename stem.
- Humanized card types and field labels (`renderer-display-label.ts`,
  `readable-fields.ts`): a different input (a type or key, not a path).
- Chat-machine bus subscribers: they drive a state machine, not a refetch.
- Deleting old slug-keyed location-share entries: they cost a few bytes in dev.

## Open design questions

None. The four visible choices were settled by the boxholder.

## Knowledge audits

Skip: no agent-facing concept changes. Box agents do not read these helpers.

## What will hold this after it ships

Unit tests with `t.check` at the existing tiers: `test/shared/human-bytes.test.ts`
(new), `test/shared/card-name.test.ts`, `src/frontend/test/lib/relative-time.test.ts`,
`ref-label.test.ts`, `card-title.test.ts`, `storage-scope.test.ts` (new), `location-share.test.ts`,
tests, `stored-flag.test.ts` (new), and a DOM test for `useLiveRefresh` using the
`t.mockImport` pattern of `test/hooks/useBusSubscription.test.ts`. No new tier.

## Implementation order

1. Track 1 (bytes). One commit.
2. Track 3 shared functions, then frontend and backend callers. Two commits.
3. Track 2 functions, then "x ago" callers, durations, absolute dates. Three commits.
4. Track 4 key helpers, location-share, guards, flags. Three commits.
5. Track 5 hook and matchers, then callers in groups (Properties and place,
   file views, todos, nav and lists), then AmbientReplies. Four or five commits.
6. Browser probe for the browse bug; record the result on its issue.
7. Cross-model diff review.

Each chunk runs `pnpm typecheck`, eslint on changed files, and `pnpm test:changed`.

## Rollout shape

Tests first per track (named above). Done when those tests and
`pnpm test:changed` pass, the browse probe is recorded, and the cross-model
review is adjudicated. No data migration: the only stored-key change is dev-only.
The search index rebuilds once from the schema-version bump. No knowledge audits.

## Plan review (2026-10-23, codex gpt-6-sol)

Adjudicated findings:
- Search index keeps old titles: accepted; Track 3 bumps `SEARCH_SCHEMA_VERSION`.
- Memo migration retry compares filename titles: accepted; it keeps the old rule.
- Legacy-key fallback cannot run in dev and is moot in production: accepted;
  the fallback is dropped (Track 4 explains why the boxholder's intent holds).
- `locationShareKey` caller contract: accepted; scope is derived in the module.
- View bindings must invalidate while hidden: accepted; not converted.
- Captions stay stale: accepted; list components read a 60 s clock.
- Date sweep incomplete: accepted; two sites added, two custom formats kept.
- `cardChangeUnder` has one caller: accepted; removed.
- Storage throw reads location sharing as off: rejected. Today the same throw
  escapes into render; reading off is the existing behavior when nothing was
  persisted, and the toggle can be turned on again.
