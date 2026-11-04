---
title: "Runtime lint: the frontend reports problem React behavior to the box log"
status: implemented
workstream: contents-menu-stable
issues: []
---
# Runtime lint: the frontend reports problem React behavior to the box log

The frontend checks a few invariants while it runs. Content stays in place
while its view is open. One request is not repeated in a storm. When an open
card cannot refresh, the log says so. A broken invariant becomes one short
line in the box's `client-debug.log`. The server keeps these lines on a
development box and on a hosted deployment that turns them on. A browser
agent sees them after each `bin/browse` command, so UI verification catches
what a static lint cannot.

**Issues addressed:** none filed. This follows the boxholder's direction after
`issues/closed/bugs/2026-11-03-card-contents-menu-collapses-and-reappears.md`.
There, a hosted remount could not be confirmed after the fact because nothing
was logged. Related open issues the checks would have informed:
`issues/bugs/2026-11-03-card-reread-of-a-half-written-file-reshapes-the-open-card.md`,
`issues/bugs/2026-09-04-chat-scroll-still-bad-after-rewrite.md`.
Searched open issues for "runtime lint", "diagnostic", "client-debug",
"remount detector": no existing item.

## Design

No design section: developer diagnostics. Nothing a person using the box sees
changes; lines go to a log file and to the browsing agent.

## Smallest fix and budget

**Smallest fix:** a `console.warn` in `CardBody` on a second mount. It
answers one question and reports ordinary navigation as a fault (see *Could
this be simpler?*).

**Chosen:** shared reporting, three checks, the server-side switch, and the
`bin/browse` drain.

| Track | Estimated changed lines |
|---|---|
| 1. Reporting, budget, server-side switch, page buffer | ~110 source, ~110 test |
| 2. Three checks | ~140 source, ~160 test |
| 3. `bin/browse` drain | ~60 source, ~60 test |
| Docs (`docs/client-debug-log.md`, browse command reference) | ~50 |

About 640 changed lines plus docs. Not a BIG CHANGE.

## Stated preferences this plan trades against

- The boxholder: *"we should be logging problematic things happening in
  React. Maybe with a switch, but a switch we turn on for localhost and
  [the hosted deployment]. Like... a runtime lint of sorts."* And: think about
  React issues in general, not only the contents menu. The general catalog is
  below, and the first implementation takes three checks from it.
- The boxholder on remounts: *"I really dislike remounts! Especially in
  content! We need firmer boundaries!"*
  (`issues/closed/bugs/2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget.md`).
- Minimize invented concepts, prefer platform primitives: the checks use
  public APIs (`useEffect`, React context, a tRPC link) and the existing
  console-to-log route and its `source` tag. The switch is a server
  environment setting.
- Bias toward strict, but do not over-engineer rare failures: each check
  names the invariant it proves was broken. An observable event alone (a
  scroll, a mutation, a refetch) is not reported.
- The privacy rule of the existing diagnostics
  (`src/frontend/src/lib/chat-send-diagnostics.ts:6-7`): *"Never add message
  text, attachment names/paths, URLs, or raw error strings here."*

## What already exists

- **The log route.** `src/frontend/src/components/DebugLog.tsx:67-76`
  forwards every `console.warn`/`console.error` to `debugLog.submit`, batched
  every 500 ms. `debugLog.submit` takes an optional `source` tag
  (`src/webapp/trpc/routers/debug-log.ts:79-82`, used by the iOS app as
  `ios`) and appends to `<box>/.beebox/client-debug.log` (`:62-64`). The file
  is truncated to its last half past 100 KB (`src/lib/rolling-log.ts:11`).
  Per batch: 100 entries, 4000 characters each (`debug-log.ts:7-8`). No rate
  limit. Reuse; add a client-side budget and a server-side keep-or-drop on
  the `runtime-lint` source.
- **Precedent diagnostics.** `lib/chat-send-diagnostics.ts` (metadata-only
  timelines through `console.warn`) and `lib/scroll-diagnostics/` (the
  `/scrolldebug` trace). Reuse the metadata-only rule.
- **The switch's server side.** Every worktree's dev box server starts with
  `BBX_DEV_SURFACES: "1"` (`workstreams-app/src/router/core/worktree-start.ts:84`),
  read as `devSurfaces` (`src/webapp/server-main.ts:44`). That flag also opens
  mock routes (`src/webapp/routes/chat/audio-routes.ts:76`), so a hosted box
  must not turn it on for this. New: `BBX_RUNTIME_LINT` in `serverEnvSchema`
  (`src/lib/env.ts`).
- **Requests.** `lib/trpc/client.ts:164-181` builds the link chain:
  `splitLink` → `retryLink` → `httpBatchStreamLink`; `query-client.ts:8`
  turns TanStack retries off (*"queries: { staleTime: 5000, retry: false }"*).
  A link placed above `retryLink` sees each logical operation once. The raw
  text query (`components/file-view-data.ts:104-110`) calls `fetchFromBox`
  directly, outside tRPC.
- **Failed refresh.** `lib/file-load-state.ts:72`: *"const stale =
  query.isRefetchError ? describeQueryFailure(query.error) : null;"*, used by
  `components/file-view-data.ts`.
- **Stable view owners.** `FileView` (`components/FileView/view.tsx`) is the
  owner of one file's view: in a workspace pane (`WorkspaceCard`, keyed by
  path, `components/chat/workspace/WorkspaceCanvas/view.tsx:109`; visited
  tabs stay mounted and hidden), on the card page, and inside each embed
  (`components/FigureEmbed.tsx:56`). The 11-03 remount happened below it,
  in `withBodyNotices`.
- **Static lint already covers part.** `personal-vibe-check/preset/react-rules.ts`
  turns on `react-hooks/static-components`, `react-hooks/set-state-in-effect`,
  and `react-hooks/exhaustive-deps`. Components made by a factory inside
  `useMemo` (the 10-26 cause, `stable-card-body.md`) slip past it.
- **Browser driver.** `browse/src/cli.ts` `main` (line 140) wraps the upstream
  CLI and returns from several branches (`:230-291`, `:330-339`); each
  invocation is a new process. It has no drain for page records.

## Prior art (external)

- React 18 production builds call no `<Profiler>` `onRender`; only the
  profiling build does. Evaluated-only:
  https://react.dev/reference/react/Profiler . Hence plain hooks.
- React 18 Suspense can hide committed content behind a fallback without
  unmounting it. Evaluated-only:
  https://github.com/reactjs/rfcs/blob/main/text/0213-suspense-in-react-18.md .
  The replacement check counts passive-effect mount and unmount, which a hide
  does not run, so a hide is not a replacement. A visible fallback is a
  separate, deferred check.
- TanStack Query 5.100: invalidating an active query cancels its in-flight
  fetch and starts another while `fetchStatus` stays `"fetching"`, so
  counting `fetchStatus` transitions misses refetch storms. Evaluated-only:
  `query-core@5.100.14` `queryClient.ts:272-305`, `query.ts:377-394`. Hence
  counting at the tRPC link.
- tRPC 11 query keys start with the path as an array (`["card","get"]`),
  `getQueryKey.ts:10-13`. The link's `op.path` is the dotted string. Adopted:
  the link is the counting point.
- Long Animation Frames, Event Timing, `layout-shift`: Chrome-first, partial
  in Safari and WKWebView. Evaluated-only; deferred (see the catalog).

## Ontology

- **Check**: a named invariant. A closed union: `content-replaced`,
  `fetch-storm`, `refresh-failed`. Not a log level, not a component name.
- **View scope**: the life of one file's view, from `FileView` mount to
  unmount. Provided by `FileView` as a React context. Closing a tab or
  navigating away ends it; nothing inside it is then counted as replaced.
- **Watched content**: a component that registers with the nearest view
  scope under a **surface** (a closed union: `card-body`, `card-embed`) and a
  **content key** (a card path, an embed source). The key stays in the page.
- **Opaque id**: the page-local number (`c1`, `c2`, …) that stands for a
  content key or a request input in a log line. Assigned on first sight;
  meaningless outside the page.
- **Record**: one reported break: check, per-check typed fields. Goes to
  `debugLog.submit` with `source: "runtime-lint"`, to the page buffer, and
  (development build only) to `console.warn` as `[runtime-lint] <check> k=v …`.
- **Page buffer**: the page's unread records, at most 200, read and cleared
  by `bin/browse`.

## Tracks / scope

### The catalog, after review

A candidate catalog of 18 checks was reviewed by codex gpt-6-astra before
this plan. Its main change was that a check reports a broken invariant, not
an event. The plan review (same model) narrowed the first set further.
Evidence coverage: **C** covered by the first set, **P** partly, **M**
motivation only.

| Candidate | Decision | Evidence and coverage |
|---|---|---|
| Content replaced while its view is open | **First set** (`content-replaced`) | 11-03 stale-notice wrapper (C, `card-body`); 10-26 embed factory (P: embeds C, citations and links below `CardBody` not watched); 10-16 live-turn key and 08-08 new-session (M: chat rows, not watched). |
| Request storm | **First set** (`fetch-storm`) | Commit `add0c339` ("client-side refetch storm") (C); `2026-10-23-frontend-live-refresh-hooks-disagree` (M). |
| Failed refresh with data on screen | **First set** (`refresh-failed`) | 11-03: the hosted case could not be confirmed (C). Reported as an episode, not a bug claim. |
| Render while unchanged / render storm | Deferred | `2026-10-08-client-max-update-depth…`, `…-rerenders-per-token`. A body hash does not prove a component's inputs were unchanged (`CardBody` also holds compose state); a global DOM-mutation rate is not a render signal. Needs per-watch-point inputs. |
| Reconnect storm | Deferred | 1–2 incidents; count at the singleton socket when it recurs. |
| Focus or selection lost by removal | Deferred | No incidents. `focusout` on removal is unreliable on WebKit; needs `focusin` tracking plus MutationObserver. |
| Scroll without input | Cut as a warning | Scroll anchoring that keeps the reader's place is correct browser behavior; the 11-03 bug was the app's reaction to it. `/scrolldebug` stays the tool. |
| Layout shift, long frames, interaction latency | Deferred | Chrome-first APIs; no coverage of a permanent hang (`2026-09-18-admin-page-load-hangs-the-tab` keeps its next-load probe). |
| Visible fallback replacing ready content, stuck loading | Deferred | No incident; needs per-surface wait budgets (a human decision). |
| Resource load failures (images) | Deferred | Cheap capture listener; no incident yet. |
| Content flap (list item gone, then back) | Deferred | The cited issue awaits manual confirmation; list membership changes legitimately. |
| Listener/timer leaks, DOM growth, work while hidden | Cut | A count does not prove a leak; cleanup tests and the 600-message cap test are the right tier. |
| Out-of-order responses, caret jumps | Cut | Not detectable in general. |
| Error boundaries log | No work | All three boundaries already log. |

### Track 1 — Reporting, budget, switch, page buffer

- **What:** `src/frontend/src/lib/runtime-lint/report.ts` and
  `page-buffer.ts`; the server's keep-or-drop in `debug-log.ts`.
- **Why:** every check needs the same budget, privacy shape, and switch. The
  log has no rate limit and truncates by halves, so one noisy check would
  erase other evidence.
- **Direction:**
  - One typed payload per check:
    `report({ check: "content-replaced", surface, content: OpaqueId, gapMs })`,
    `report({ check: "fetch-storm", procedure: ProcedureName, input: OpaqueId, starts, windowMs })`,
    `report({ check: "refresh-failed", phase: "failed" | "recovered", surface, content: OpaqueId, kind?, durationMs? })`.
    Content keys and request inputs become an `OpaqueId` through
    `opaqueId(raw: string)` before they reach `report`; `OpaqueId` is a
    branded type, so a raw string does not compile. `ProcedureName` is the
    tRPC `op.path` checked against `/^[a-zA-Z][\w.]{0,60}$/`; anything else
    becomes `other`. Type tests assert that a raw path in a field fails to
    compile.
  - Budget, in the page: per budget key at most one record per 60 s, and at
    most 20 records per 60 s in total. The budget key is (check, surface,
    content) plus `phase` for `refresh-failed`, so a recovery is never eaten
    by its own failure. `refresh-failed` records are outside the global cap
    (each is bounded by its per-key budget). A card that fails and recovers
    several times within a minute reports the first episode; the next
    records for it carry the suppressed count. The key map is bounded (200 entries, oldest dropped).
    Dropped records are counted; the next record that passes carries
    `suppressed=n`, and a 60 s timer sends one `suppressed` record if any
    remain. Each serialized line is under 300 characters.
  - Delivery: `source` is per batch in `debugLog.submit`
    (`debug-log.ts:79-89`), so records get their own queue in `DebugLog.tsx`,
    flushed as their own batches with `source: "runtime-lint"`. In the
    development build they are also printed with the unpatched
    `console.warn` (the reference `DebugLog.tsx` keeps before patching), so
    the console copy is not captured and forwarded a second time. A
    production build does not print them, so a person's browser console stays
    quiet.
  - The switch is on the server. `debugLog.submit` writes `runtime-lint`
    entries only when the box server runs with `devSurfaces` (every dev box)
    or `BBX_RUNTIME_LINT=1`; otherwise it drops them and writes nothing. The
    client needs no setting and no startup read. When off, the client still
    sends at most 20 short entries a minute; accepted.
  - Page buffer: unread records, at most 200, oldest dropped and counted;
    `window.__bbxRuntimeLint = { take(): { records, dropped } }` returns and
    clears them. One consumer (`bin/browse`). Installed once per page;
    module re-evaluation under HMR keeps the existing buffer.
- **Vocabulary lock-ins:** `[runtime-lint]` tag; the `runtime-lint` source;
  check and surface names; `BBX_RUNTIME_LINT`; `window.__bbxRuntimeLint`.
- **First chunk:** this track with its tests. No open questions.

### Track 2 — Three checks

1. **`content-replaced`.** Invariant: *while a file's view stays open, the
   content in it is not unmounted and mounted again.*
   - `FileView` provides a view scope: a registry of live counts per
     (surface, content key), created on mount and discarded on unmount.
   - `useWatchedContent(surface, contentKey)` registers with the nearest
     scope from a passive effect, and unregisters in its cleanup. Watch
     points: `CardBody` (`card-body`, the card path) and the embed component
     in `FigureEmbed.tsx` (`card-embed`, the embed source). The embed hook
     sits in the outer card's scope, outside the embed's own `FileView`, so a
     replaced embed is seen by the view it is in.
   - A replacement: the live count for a (surface, key) drops, and returns to
     its earlier level within 2 s, while the scope is still mounted. Same
     commit (a wrapper change) and a short loading flash (a stale notice, a
     placeholder) both qualify. A count that stays down (a deleted embed,
     compose mode hiding a region) is not reported; a return after 2 s (a
     region hidden and shown again by the person) is not reported. Two equal
     embeds: one replaced is still 2 → 1 → 2, so it is reported.
   - No input rule and no route rule. Closing and reopening a tab, Back, a
     box change, or a route change unmounts the `FileView`, which discards the
     scope.
   - Fields: `surface`, `content`, `gapMs`.
2. **`fetch-storm`.** Invariant: *one request (procedure and input) does not
   start more than 8 times in 10 s.*
   - A counting link placed above `retryLink` in `lib/trpc/client.ts`
     counts each query operation once; retries are not counted (they belong
     to `retryLink` and are bounded there). Vanilla callers go through the
     same link, so they count too.
   - The raw text query function in `components/file-view-data.ts` calls
     the same counter under procedure `raw-file`.
   - The request input becomes an opaque id (a stable JSON string of the
     input, then `opaqueId`).
   - Fields: `procedure`, `input`, `starts`, `windowMs`.
3. **`refresh-failed`.** Reported as an episode: *content on screen could not
   be refreshed*, then *recovered*.
   - In `useFileData` (`components/file-view-data.ts`): when `stale` turns
     non-null for a path, report `phase=failed` with `kind`
     (`not-found` for a tRPC `NOT_FOUND`, `unreachable` when
     `unreachableCause` (`lib/trpc/transient.ts`, used at `lib/file-load-state.ts:60`) finds one, else
     `other`). When it turns null for the same path, report
     `phase=recovered` with `durationMs`.
   - A path change or unmount ends the episode with no record.
   - Fields: `surface` (`card-body` or `file`), `content`, `phase`, `kind`,
     `durationMs`.

- **Why:** the most frequent and least visible classes in the evidence.
- **Vocabulary lock-ins:** `useWatchedContent(surface, key)`.
- **First chunk:** after Track 1. No open questions.

### Track 3 — `bin/browse` drain

- **What:** after a page command, `bin/browse` takes the page buffer and
  prints the records to stderr as `runtime-lint: <check> k=v …`, and
  `runtime-lint: n dropped` when the buffer overflowed.
- **Why:** the max-update-depth warning was found only in journey-walk
  console logs. An agent that checks UI should see a broken invariant at the
  command that caused it.
- **Direction:**
  - `browse/src/runtime-lint-drain.ts`: one bounded upstream `eval` of
    `window.__bbxRuntimeLint?.take()` with a 2 s timeout.
  - `main` dispatches through one function; the drain runs in its `finally`,
    after successes and failures, on the current tab.
  - Skipped when the command was a session close, when the command timed out
    (a wedged page), or when the page is not on the router's origin.
  - The page owns the cursor: `take()` clears what it returns, so separate
    CLI processes need no shared state. A reload or a new tab has its own
    buffer. Commands that leave the page (`open`, `reload`, `back`,
    `forward`, `close`) also drain before they run, so records written since
    the last command are not lost with the old page.
  - The command's exit status does not change.
- **First chunk:** after Track 2. No open questions.

### Track 4 — Hosted activation

- **Status:** done 2026-11-04, with the boxholder's yes ("turn it on ...
  after you land"). `BBX_RUNTIME_LINT=1` was added to the hub's
  `/home/beebox/.env` and applied by a controller redeploy of `c71b2406b`.
  The hub wrote it into `/etc/beebox/box.env`, and all seven box units
  run with it. A test `debugLog.submit` entry with source `runtime-lint`
  was written to a box's `client-debug.log`.
- **What:** set `BBX_RUNTIME_LINT=1` in the hosted deployment's box server
  environment, and confirm a test line arrives in a box's `client-debug.log`.
- **Why:** the boxholder asked for it on for the hosted deployment. Until
  this step, the work is ready for activation, not done.
- **Direction:** a production change; it waits for the boxholder's yes, given
  separately from the merge.

## Could this be simpler?

The simplest version is one `console.warn` in `CardBody` on a second mount.
It reports two panes with the same card, and a person closing and reopening
a card. It misses the other two recurring classes and floods the 100 KB log
in a remount loop. The view scope is what tells a replacement from
navigation without a timing-and-input guess. The budget is what makes it safe
to leave on for a hosted box. The server-side switch replaces a client
setting read, a per-browser override, and a startup dependency. The
`bin/browse` drain is what makes it a lint for agents rather than a log
someone reads afterwards. Cut from the catalog: ten candidates (table above).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A noisy check fills the log | new test (budget) | per-key and global budget, `suppressed` record | clear: suppressed count |
| A recovery within 60 s of its failure is suppressed | new test | `phase` in the budget key | n/a |
| Closing and reopening a tab is reported | new test | the scope is discarded on `FileView` unmount | n/a |
| One of two equal embeds is replaced and missed | new test | live counts, no twin exemption | n/a |
| A region hidden by compose mode is reported | new test | count stays down; 2 s limit | silent skip |
| A content key or input reaches the log | new type test and output test | branded `OpaqueId`; per-check payloads | would be silent; tests guard |
| A refetch storm with cancel-and-restart is missed | new test (overlapping refetches with cached data) | counting at the link | n/a |
| `bin/browse` drain on a wedged page | new test | 2 s bound; skipped after a timeout | clear: drain skipped |
| Hosted box without the setting | n/a | server drops entries | silent by design |
| Forwarding batch fails (box down) | none | existing route drops it | silent; the page buffer still holds it |

The last row is existing behavior of `DebugLog.tsx` (its buffer is cleared
before the send). Accepted: a box that is down cannot store its log, and the
page buffer covers browser verification.

## Agent-flow / user-flow edge cases

- Wrong tag / stale ref / fabricated value / validation UX / partial
  migration: not applicable; no agent-facing card vocabulary.
- Two agents touching the same card: ADDRESSED. Edits re-render the body in
  place; a replacement is what `content-replaced` reports.
- A browsing agent reading lines: ADDRESSED (Track 3). Lines name the check
  and fields; `docs/client-debug-log.md` says what each invariant means.

## NOT in scope

- The deferred and cut checks in the catalog table, each with its reason.
- Watch points in chat rows and in Markdown children (links, citations):
  after the first set shows the noise level.
- Sanitizing what the existing route already forwards (arbitrary console
  errors): the privacy rule here covers runtime-lint records only.
- Durable offline delivery of browser logs.
- A change to the `debugLog.submit` response (the iOS contract shares it):
  the client keeps sending when the server drops.

## Open design questions

- Thresholds (2 s replacement window, 8 starts in 10 s, budget 1/key/min and
  20/min) are first guesses. Lean: ship them, read a week of hosted logs
  after Track 4, adjust.

## Knowledge audits

None: no box-agent-facing concept. The dev-facing part (what a
`runtime-lint:` line means to a browsing agent) lives in
`docs/client-debug-log.md` and the browse skill's command reference.

## What will hold this after it ships

- `test/lib/runtime-lint/report.test.ts`: per-key and global budget,
  `phase` keys, suppressed record, page buffer `take()` and overflow, line
  length, and a type test that a raw string in `content` fails to compile.
- `test/webapp/debug-log-runtime-lint.test.ts` (backend): `runtime-lint`
  entries written with `devSurfaces` or `BBX_RUNTIME_LINT=1`, dropped
  otherwise; other sources unchanged.
- `test/components/runtime-lint/watched-content.test.ts` (DOM harness):
  - a body replaced inside a mounted `FileView` scope reports (the
    `withBodyNotices` shape from before `contents-menu-stable`, rebuilt in the
    test);
  - an embed made by a per-render factory reports (the 10-26 shape);
  - the scope unmounted and mounted again (tab close and reopen) does not;
  - one of two equal embeds replaced reports;
  - a region removed and not restored, or restored after 2 s, does not.
- `fetch-storm`: a tRPC client with the counting link and a fake transport:
  ten overlapping invalidations of an active query with cached data report
  once with `procedure=card.get`; retries of one operation do not count.
- `refresh-failed`: failure then recovery within 10 s gives two records; a
  path change ends the episode with none.
- `browse` drain: two separate CLI invocations against a fake page buffer
  (no double print), a failed command still drains, a timed-out command
  skips.
- A browser check: with the 11-03 fix reverted, `bin/card-remount-check`'s
  missing-file step shows a `runtime-lint: content-replaced` line in the
  `bin/browse` output.

## Implementation order

1. Track 1 + tests. Commit.
2. Track 2, one check per commit, with its tests.
3. Track 3 + tests; the docs section and the browse reference line. Commit.
4. Browser verification (the reverted-fix run above).
5. Track 4 after the boxholder's yes.

## Rollout shape

Done when the tests above pass, typecheck, layout-check, and lint pass, and
the reverted-fix browser run shows the line. On landing it is on for every
development box. It is done for the hosted deployment after Track 4. No data
shape change, no migration.
