---
title: "Runtime lint: the frontend reports problem React behavior to the box log"
status: draft
workstream: contents-menu-stable
issues: []
---
# Runtime lint: the frontend reports problem React behavior to the box log

The frontend checks a few invariants while it runs: content the person is
reading is not replaced under them, the same request is not repeated in a
storm, content does not re-render while it is unchanged, and a card that
cannot refresh says so. A broken invariant writes one short line to the box's
`client-debug.log`. The checks are on in development and on a hosted
deployment that turns them on. A browser agent sees the lines after each
`bin/browse` command, so UI verification catches what a static lint cannot.

**Issues addressed:** none filed. This follows the boxholder's direction after
`issues/closed/bugs/2026-11-03-card-contents-menu-collapses-and-reappears.md`,
where a hosted remount could not be confirmed after the fact because nothing
was logged. Related open issues the checks would have informed:
`issues/bugs/2026-11-03-card-reread-of-a-half-written-file-reshapes-the-open-card.md`,
`issues/bugs/2026-09-18-admin-page-load-hangs-the-tab.md`,
`issues/bugs/2026-09-04-chat-scroll-still-bad-after-rewrite.md`.
Searched open issues for "runtime lint", "diagnostic", "client-debug",
"remount detector": no existing item.

## Design

No design section: developer diagnostics. Nothing a person using the box sees
changes; lines go to a log file and to the browsing agent.

## Smallest fix and budget

**Smallest fix:** a remount warning on the card body only (the contents-menu
case). It answers one question and leaves the other recurring classes
(render storms, request storms, failed refreshes) to the next field report.

**Chosen:** shared reporting machinery, four checks, and the `bin/browse`
drain.

| Track | Estimated changed lines |
|---|---|
| 1. Machinery: report, budget, switch, local buffer | ~140 source, ~120 test |
| 2. Four checks | ~150 source, ~150 test |
| 3. `bin/browse` drain | ~50 source, ~40 test |
| Docs (`docs/client-debug-log.md` section) | ~40 |

About 610 changed lines plus docs. Not a BIG CHANGE.

## Stated preferences this plan trades against

- The boxholder: *"we should be logging problematic things happening in
  React. Maybe with a switch, but a switch we turn on for localhost and
  [the hosted deployment]. Like... a runtime lint of sorts."* And: think about
  React issues generally, not only the contents menu.
- The boxholder on remounts: *"I really dislike remounts! Especially in
  content! We need firmer boundaries!"*
  (`issues/closed/bugs/2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget.md`).
- Minimize invented concepts, prefer platform primitives: the checks use
  public APIs (`useEffect`, TanStack `QueryCache.subscribe`, DOM events) and
  the existing console-to-log pipeline. One new vocabulary item: the check
  name list.
- Bias toward strict, but do not over-engineer rare failures: each check
  names the invariant it proves was broken. An observable event alone (a
  scroll, a mutation, a refetch) is not reported.
- Privacy rule of the existing diagnostics
  (`src/frontend/src/lib/chat-send-diagnostics.ts:6-7`): *"Never add message
  text, attachment names/paths, URLs, or raw error strings here."*

## What already exists

- **The log pipeline.** `src/frontend/src/components/DebugLog.tsx:67-76`
  forwards every `console.warn`/`console.error` to `debugLog.submit`, batched
  every 500 ms. The server appends to `<box>/.beebox/client-debug.log`
  (`src/webapp/trpc/routers/debug-log.ts:62-64`), truncated to its last half
  past 100 KB (`src/lib/rolling-log.ts:11`). Per batch: 100 entries, 4000
  characters each (`debug-log.ts:7-8`). No rate limit. Reuse; add a budget on
  the client side.
- **Precedent diagnostics.** `lib/chat-send-diagnostics.ts` (metadata-only
  timelines through `console.warn`) and `lib/scroll-diagnostics/` (a
  flag-gated trace, toggled by `/scrolldebug`, stored with
  `lib/stored-flag.ts`). Reuse the flag storage and the metadata-only rule.
- **The switch's server side.** `src/lib/env.ts` `serverEnvSchema` holds
  validated server settings. `BBX_DEV_SURFACES` (`env.ts:131`) exists but also
  enables mock routes (`webapp/routes/chat/audio-routes.ts:76`). Not reused:
  turning it on for a hosted box would open those routes. A new
  `BBX_RUNTIME_LINT` setting instead.
- **Requests.** `lib/trpc/query-client.ts:8`: *"queries: { staleTime: 5000,
  retry: false }"*; retries happen in the tRPC link. TanStack
  `QueryCache.subscribe` is public API and reports query updates with
  `fetchStatus`.
- **Failed refresh.** `lib/file-load-state.ts:72`: *"const stale =
  query.isRefetchError ? describeQueryFailure(query.error) : null;"*.
- **Static lint already covers part.** `personal-vibe-check/preset/react-rules.ts`
  enables `react-hooks/static-components`, `react-hooks/set-state-in-effect`,
  `react-hooks/exhaustive-deps`. Components made by a factory inside
  `useMemo` (the 10-26 cause, `stable-card-body.md`) slip past it; the
  runtime remount check covers that.
- **Browser driver.** `browse/src/cli.ts` (`main`, line 140) wraps the
  upstream CLI; it has no drain for page records. `bin/browse console` and
  `errors` exist upstream but print everything.

## Prior art (external)

- React 18 production builds call no `<Profiler>` `onRender`; only the
  profiling build does. Evaluated-only:
  https://react.dev/reference/react/Profiler . Hence watch points with plain
  hooks.
- React 18 Suspense can hide committed content and show a fallback without
  unmounting it, re-running layout effects on reveal. Evaluated-only:
  https://github.com/reactjs/rfcs/blob/main/text/0213-suspense-in-react-18.md .
  The remount check counts passive-effect mount and unmount, which a hide
  does not run.
- TanStack Query `QueryCache.subscribe` events. Evaluated-only:
  https://tanstack.com/query/latest/docs/framework/react/reference/classes/QueryCache .
- Long Animation Frames, Event Timing, `layout-shift`: Chrome-first, partial
  in Safari/WKWebView. Evaluated-only; deferred (see the catalog).

## Ontology

- **Check**: a named invariant. Identified by a fixed name in a closed union
  (`content-replaced`, `render-while-unchanged`, `fetch-storm`,
  `refresh-failed`). Not a log level, not a component name.
- **Surface**: a fixed name for where content shows (`card-body`,
  `card-embed`). A closed union; never text from the content.
- **Content key**: the identity of the content on a surface (a card path,
  an embed source). Stays inside the page. The log line carries a page-local
  opaque number for it (`c1`, `c2`, …), assigned on first sight.
- **Record**: one reported break: check, surface, opaque content number,
  numeric or enum fields. Goes to `console.warn` as
  `[runtime-lint] <check> k=v …` and to the local buffer.
- **Local buffer**: the page's last 200 records with a sequence number, at
  `window.__bbxRuntimeLint`, read by `bin/browse`. Not the log file.

## Tracks / scope

### The catalog, after review

A candidate catalog of 18 checks was reviewed by codex gpt-6-astra before
this plan. Its main change: a check reports a broken invariant, not an
event. Decisions:

| Candidate | Decision | Reason |
|---|---|---|
| Content remount | **First set** (`content-replaced`) | Most frequent class: 7+ incidents (`2026-10-26`, `2026-11-03`, `2026-10-16-live-turn-key-lost…`, `2026-08-08-new-chat-first-message…`). |
| Render storm | **First set**, narrowed (`render-while-unchanged`) | `2026-10-08-client-max-update-depth…` (cards re-rendered on every token; found only in console logs) and `2026-10-08-chat-message-list-rerenders-per-token`. A global DOM-mutation rate is not a render signal (streaming mutates; heavy renders may not); cut. |
| Request storm | **First set** (`fetch-storm`) | Commit `add0c339` ("client-side refetch storm"); `2026-10-23-frontend-live-refresh-hooks-disagree`. Counts fetch starts, not cache events or invalidations. |
| Failed refresh with data on screen | **First set** (`refresh-failed`) | The 11-03 hosted case could not be confirmed after the fact. An episode report (on, off, duration), not a bug claim. |
| Reconnect storm | Deferred | 1–2 incidents; count at the singleton socket when it recurs. |
| Focus or selection lost by removal | Deferred | No incidents found. `focusout` on removal is unreliable on WebKit; needs `focusin` tracking plus MutationObserver. |
| Scroll without input | Cut as a warning | Scroll anchoring that keeps the reader's place is correct browser behavior; the 11-03 bug was the app's reaction to it. The chat scroll trace (`/scrolldebug`) stays the tool. |
| Layout shift, long frames, interaction latency | Deferred | Chrome-first APIs; no permanent-hang coverage (the admin hang needs its next-load probe). |
| Stuck loading / fallback replacing content | Deferred | No incident; needs per-surface wait budgets (a human decision). |
| Resource load failures (images) | Deferred | Cheap capture listener; no incident yet. |
| Content flap (item gone, then back) | Deferred | The cited issue is fixed and awaiting manual confirmation; list membership changes legitimately. |
| Listener/timer leaks, DOM growth, work while hidden | Cut | Counts do not prove a leak; tests on cleanup and the 600-message cap are the right tier. |
| Out-of-order responses, caret jumps | Cut | Not detectable in general. |
| Error boundaries log | No work | All three boundaries already log. |

### Track 1 — Machinery

- **What:** `src/frontend/src/lib/runtime-lint/`: `report.ts`, `switch.ts`,
  `buffer.ts`.
- **Why:** each check needs the same budget, privacy shape, and switch; the
  log has no rate limit and truncates by halves, so one noisy check would
  erase other evidence.
- **Direction:**
  - `report(check: Check, fields: { surface?: Surface; content?: string } & Record<string, number | boolean | Enum>)`.
    Field values are numbers, booleans, or members of closed string unions;
    TypeScript rejects free text. `content` is a content key, replaced by its
    opaque number before output.
  - Budget: per (check, surface, content number) at most one line per 60 s;
    globally at most 20 lines per 60 s; the key map is bounded (200 entries,
    oldest dropped). Suppressed counts are carried on the next line for that
    key, and a 60 s timer writes one `[runtime-lint] suppressed n=…` line
    when any were dropped. Each line is under 300 characters.
  - Switch, resolved once at startup: a per-browser override (stored flag
    `bbx-runtime-lint`, tri-state on/off/absent, key suffixed with the app's
    base path so worktrees on one localhost origin do not share it), else
    `import.meta.env.DEV`, else the server setting. Server setting:
    `BBX_RUNTIME_LINT` (`"1"`) in `serverEnvSchema`, exposed as
    `debugLog.settings` → `{ runtimeLint: boolean }` (public, like
    `debugLog.submit`). Read with the vanilla tRPC client once at startup;
    a failed read means off. Off means the checks install nothing.
  - Composer command `/runtimelint` toggles the override (precedent:
    `/scrolldebug`).
  - Local buffer: ring of 200 records with an increasing sequence number;
    `window.__bbxRuntimeLint = { since(seq): Record[]; dropped: number }`.
    Installed once per page; HMR-safe (re-installation keeps the existing
    buffer).
  - The reporter does not count its own `console.warn` traffic or the debug
    panel's renders in any check.
- **Vocabulary lock-ins:** `[runtime-lint]` line tag; check and surface
  names; `BBX_RUNTIME_LINT`; `debugLog.settings`; `window.__bbxRuntimeLint`.
- **First chunk:** this track with its tests. No open questions.

### Track 2 — Four checks

1. **`content-replaced`.** Invariant: *content the person was looking at is
   not replaced while they did nothing.* Hook `useContentWatch(surface,
   contentKey)` in `CardBody` (card body) and the figure embed. A
   module-level registry, outside the watched subtree, records each unmount
   (surface, key, time). A mount of the same (surface, key) within 5 s of an
   unmount, with no `pointerdown` or `keydown` on the page in between and
   the page visible throughout, is a replacement. Two panes showing the same
   card are two registrations; an unmount with a still-mounted twin is not
   counted. HMR in development: an `import.meta.hot` dispose clears the
   registry. Fields: `gapMs`.
2. **`render-while-unchanged`.** Invariant: *a watched content component
   does not commit again while its content is unchanged, many times in a
   short span.* The same hook takes a content version (the body string's
   length and a cheap hash, computed inside the page). A `useEffect` without
   dependencies counts commits; more than 10 commits in 2 s with an
   unchanged version reports once. Fields: `commits`, `windowMs`.
3. **`fetch-storm`.** Invariant: *one query does not start more than 8
   fetches in 10 s.* `QueryCache.subscribe`; count transitions of
   `fetchStatus` to `"fetching"` per query hash. The tRPC procedure path
   (the first element of the query key, e.g. `card.get`) is code, not
   content, and is logged; inputs are not. Fields: `procedure` (the tRPC
   path from the query key, a code name), `fetches`, `windowMs`. A query
   key that is not a tRPC key logs `procedure=other`.
4. **`refresh-failed`.** Invariant reported as an episode: *content on screen
   could not be refreshed.* At `resolveLoadState`'s caller in
   `components/file-view-data.ts`: when `stale` turns non-null, report `kind`
   (`not-found` | `unreachable` | `other`); when it clears, report
   `recovered` with `durationMs`. Surface `card-body` or `file`.

- **Why:** the four most frequent or least visible classes in the evidence.
- **Vocabulary lock-ins:** `useContentWatch(surface, key, version?)`.
- **First chunk:** after Track 1. No open questions.

### Track 3 — `bin/browse` drain

- **What:** after every page command, successful or failed, `browse/src/cli.ts`
  reads `window.__bbxRuntimeLint.since(cursor)` and prints new records to
  stderr as `runtime-lint: <check> …`. The cursor is per session and resets
  on navigation, reported as a boundary line. If the buffer is absent (lint
  off, other origin) it prints nothing; if records were dropped it says how
  many.
- **Why:** the max-update-depth warning was found only in journey-walk
  console logs; an agent verifying UI should see a broken invariant at the
  command that caused it.
- **Direction:** a reader in `browse/src/runtime-lint-drain.ts` used by
  `main` after the upstream call. The command's exit status is unchanged.
- **First chunk:** after Track 2. No open questions.

## Could this be simpler?

The simplest version is one `console.warn` in `CardBody` on a second mount.
It fails on: two panes with the same card (a false report), a person
navigating away and back (a false report), the three other recurring classes
(render storms, request storms, failed refreshes), and log flooding (one
remount loop fills the 100 KB file and erases other evidence). The budget,
the switch, and the opaque content numbers are what make it safe to leave on
for a hosted box. The `bin/browse` drain is what makes it a lint for agents
rather than a log someone reads after the fact. Cut from the fuller catalog:
nine candidates (table above).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A noisy check fills the log | new test (budget) | per-key and global budget, suppressed line | clear: suppressed count |
| A legitimate remount after a click is reported | new test | input between unmount and mount skips | silent skip |
| Two panes with the same card | new test | twin registration | n/a |
| Streaming or editing makes a card commit often while its text changes | new test | version check | n/a |
| A content key or text reaches the log | new test (output contains no key) | opaque numbers; typed fields | would be silent; test guards |
| `debugLog.settings` fails at startup | new test | treated as off | silent: lint stays off on that load |
| `bin/browse` drain on a page with no buffer | new test | prints nothing | silent by design |
| Forwarding batch fails (box down) | none | existing pipeline drops it | silent; the local buffer still has it |

The last row is existing behavior of `DebugLog.tsx` (the buffer is cleared
before the send). Accepted: a box that is down cannot store its log, and the
local buffer covers browser verification.

## Agent-flow / user-flow edge cases

- Wrong tag / stale ref / fabricated value / validation UX / partial
  migration: not applicable; no agent-facing card vocabulary.
- Two agents touching the same card: ADDRESSED. Agent edits change the
  content version, so commits are not `render-while-unchanged`; a remount
  while the person is idle is exactly what `content-replaced` reports.
- A browsing agent reading lines: ADDRESSED (Track 3). Lines name the check
  and fields; the docs section says what each invariant means.

## NOT in scope

- The deferred and cut checks in the catalog table, each with its reason.
- Sanitizing what the existing pipeline already forwards (arbitrary console
  errors): the privacy guarantee here covers runtime-lint records only.
- Durable offline delivery of browser logs.
- Turning the setting on for the hosted deployment: a production change that
  needs its own yes; the plan delivers the setting and the docs line for it.
- iOS native diagnostics: the WKWebView runs the same web code, so the checks
  run there when on.

## Open design questions

- Thresholds (5 s replacement window, 10 commits in 2 s, 8 fetches in 10 s)
  are first guesses. Lean: ship them, read a week of hosted logs, adjust.

## Knowledge audits

None: no box-agent-facing concept. The dev-facing part (what a
`runtime-lint:` line means to a browsing agent) lives in
`docs/client-debug-log.md` and the browse skill's command reference.

## What will hold this after it ships

- `test/lib/runtime-lint/report.test.ts`: budget per key and global,
  suppressed line, opaque content numbers, field typing.
- `test/lib/runtime-lint/switch.test.ts`: override precedence, failed
  settings read means off.
- `test/components/runtime-lint/content-watch.test.ts` (DOM harness): a
  remount with no input reports; with a `pointerdown` between, it does not;
  twin panes do not; the stale-notice remount fixed in
  `contents-menu-stable` reports when its fix is reverted (the mutant check).
- `render-while-unchanged`: a component re-rendered 20 times with the same
  version reports; with changing versions it does not.
- `fetch-storm`: a `QueryClient` with a fake fetcher invalidated 10 times
  reports once with the procedure name.
- `browse` drain: a unit test of the cursor and boundary logic.
- A browser check: run `bin/card-remount-check` with the contents-menu fix
  reverted and confirm a `runtime-lint: content-replaced` line appears in
  the `bin/browse` output.

## Implementation order

1. Track 1 + tests. Commit.
2. Track 2, one check per commit, with its tests.
3. Track 3 + test; docs section in `docs/client-debug-log.md` and a line in
   the browse skill's command reference. Commit.
4. Browser verification (the reverted-fix run above). Exhibit only if the UI
   changes (it should not).

## Rollout shape

Done when the tests above pass, typecheck, layout-check, lint, and the
reverted-fix browser run shows the line. No data shape change, no migration.
On landing it is on for every development checkout. The hosted deployment
gets `BBX_RUNTIME_LINT=1` in its server environment when the boxholder says
so.
