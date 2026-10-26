---
title: "iOS box screen: an accurate chat list while the box sleeps, and an honest one when it cannot answer"
status: draft
workstream: ios-stale-chat
issues:
  - ../../../issues/bugs/2026-10-26-ios-shows-stale-chat-when-box-is-asleep.md
---
# iOS box screen: an accurate chat list while the box sleeps, and an honest one when it cannot answer

The iOS box screen draws its chat list from a cached server answer. When the box cannot answer, the app shows that cached list with its first chat styled as the current one, and nothing says the list is old. This plan has two parts. First, the box screen checks the box each time it comes forward, says when it cannot reach the box and how old the list is, stops styling an unconfirmed chat as current, and refreshes on its own when the box answers (Track 1). Second, a hosted box that has gone to sleep leaves an exact copy of its list with the hub, and the hub answers the phone from that copy at once, without waking the box (Tracks 2-4).

**Issues addressed:** `issues/bugs/2026-10-26-ios-shows-stale-chat-when-box-is-asleep.md`. Related, not closed: `issues/bugs/2026-09-12-ios-unreachable-box-shows-a-blank-screen.md` covers the web view's failure page and the dev router's mobile bootstrap 503; this plan does not touch the web view. Queue search for "stale", "box screen", "could not refresh", and "asleep" in `issues/` found no other item.

## Design

Situations, from the issue:

- When I open the app and the box cannot answer, I want to see that the box is unreachable and how old the list is, so I do not read an old chat as what I was last doing.
- When the box answers again, I want the list to update without my action, so I do not have to keep pulling to refresh.
- When my hosted box is asleep and I open the app, I want its real list at once, so a chat I started on the desktop is there.

The boxholder, 2026-10-26, on the hosted case: *"Feels like a generated response would be ideal here. It doesn't require a push, can be handled near-instantaneously when the app opens."* And: *"For now, don't wake the [box]. The value still needs to be protected by authentication. Though only mobile authentication needs to be allowed in."*

What the person sees on the box screen, at the top of the list, in place of today's "Could not refresh" row:

| State | Status row | "Pick up where you left off" |
|---|---|---|
| Fresh answer since the app came forward | none | first chat styled as the primary action (today's look) |
| The hub answered from the sleeping box's snapshot | "<box> is asleep", second line "Chats as of <relative time it went to sleep>." No button | first chat styled as the primary action: it is the box's own last answer |
| Checking, under 2 s | none | every chat plain |
| Checking, 2 s or more | spinner, "Checking <box>…", second line "Last updated <relative age>." | every chat plain |
| Failed: no connection or timeout | "Can't reach <box>", second line "Last updated <relative age>. Trying again." and a "Retry now" button | every chat plain |
| Failed: hub 503 `box_closed` | "<box> is closed for <reason>", same second line and button | every chat plain |
| Failed: other 503 | "<box> is not open right now", same second line and button | every chat plain |
| Failed: other status | "Could not refresh <box>", same second line and button | every chat plain |

With no cached list, the second line drops the age ("Trying again.") and the section shows only "All chats", as today.

The primary styling returns when a fresh answer lands. Tapping any chat still opens it; the web view's own unreachable page (`ios-app/BeeBox/Views/RootView.swift:629-630`, `UnreachableBoxView`) covers that path. The app does not open a chat by itself on launch today (`ios-app/BeeBox/Models/RootSurface.swift:61-85` shows the box screen on a cold launch) and this plan does not change that.

Opening a chat from the snapshot list wakes the box through the normal request path, as today. The snapshot answer itself does not wake it. While the box screen shows a sleeping box in the foreground, the app asks again every 60 s; the hub answers each from the snapshot until the box wakes for some other reason, and then the live answer replaces it.

When the hub has no snapshot it can read (a crash, a host reboot, a box from before this change), the request takes today's path and wakes the box once. This plan reads the boxholder's "don't wake" as applying to the snapshot answer; the stricter reading would leave the phone with no list until something else wakes the box. Flagged for the boxholder.

The status row is a status line plus a style change. No new surface, card type, or notification, so the bbx-design skill's full template is not used.

## Smallest fix and budget

The smallest fix: refresh on return to the foreground, and show the cached age in the existing "Could not refresh" row. That leaves the first chat styled as current while unconfirmed and leaves no recovery without a pull. The issue's three expectations need the fuller version.

Estimate: about 1,000 changed lines, not a big change.

- Track 1 (iOS, implemented as of this revision): about 300 source and 160 test lines.
- Track 2 (box writes the snapshot): about 60 source and 60 test lines.
- Track 3 (hub serves it): about 70 source and 100 test lines.
- Track 4 (contract and iOS): about 50 source, 40 test, and a fixture.
- Docs: `ios-app/AGENTS.md` fixture list, `docs/mobile-contract.md` §5.11 and the Q1 row, hub guidance; reported separately.

The boxholder chose the snapshot after seeing this size, 2026-10-26: *"OK, adjust the plan accordingly, review, and begin implementation."*

## Stated preferences this plan trades against

- `beebox/docs/plans/box-screen.md:256`: *"The box screen draws at once from the outbox and a cached copy of the last `home` answer for the box, then refreshes."* Kept. This plan adds the age and the unconfirmed style; it does not hide the cache.
- `beebox/docs/plans/box-screen.md:198`: *"`recentChats`, the first one styled as the primary action."* Changed to: only after a fresh answer. The issue's expectation, *"It does not present an old chat as the current one when it could not check"*, is the reason.
- `ios-app/AGENTS.md`, Runtime diagnostics: *"Repeated callbacks must log transitions rather than retries. An offline reload loop must not fill the queue with identical lines."* The automatic retry logs only the first failure and the recovery.
- Memory `feedback_minimal_concepts_prefer_primitives`: the fetch time comes from the cache file's modification date, so the cache format does not change. The snapshot reuses the hub's existing published-file pattern and the box's existing hub secret; it adds no new key store.
- `beebox/src/core/hub-meta.ts:1-13`: the hub reads only what a box publishes, *"No secret is in it."* The snapshot holds chat titles, which are box content. The boxholder accepted the hub holding them, with authentication. It is encrypted so that the world-readable mode the hub path needs (`hub-meta.ts:20-22`, *"the file is 0644, and the box root and `.beebox/` are made 0751"*) does not expose titles to other users on the host.
- `beebox/src/hub/AGENTS.md`, per-box isolation: the hub verifies credentials without waking a box (`src/hub/server/box-credentials.ts:1-17`). The snapshot route uses the same check.

## What already exists

- `BoxScreenStore.refresh(boxID:)` (`ios-app/BeeBox/Storage/BoxScreenStore.swift:226`) with `Refresh` `.idle/.refreshing/.failed` (`:107-111`). Reuse; `.failed` gains a reason.
- The automatic refresh call is in `RootView`'s `.task(id: store.selectedBox?.id)` (`ios-app/BeeBox/Views/RootView.swift:188-204`): *"await boxScreenStore.refresh(boxID: boxID)"*. It runs on a cold launch and a box switch, not on a return to the foreground; the only other caller is pull to refresh (`BoxScreenView.swift:56-58`). This is the likely cause of the reported staleness: a return from the background redraws the box screen from the in-memory home with no request.
- `setForeground` (`BoxScreenStore.swift:186`) and `setShownBox` (`:200`) already tell the store when the app is active and which box screen shows. Reuse both as the refresh triggers.
- `homeRequest()` (`ios-app/BeeBox/Services/QuickChatAPI.swift:96-101`) sets no `timeoutInterval`, so URLSession's default request timeout of 60 s applies. With the host asleep and no connection refusal, the request can wait up to that long, and today the screen shows nothing during it.
- The hub's 503 JSON body: `{ error: "box_closed", reason, ..., message }` or `{ error: "box_unavailable", message }` (`beebox/src/hub/server/box-unavailable.ts:14-21`). `QuickChatAPI.errorMessage` decodes only the tRPC envelope (`QuickChatAPI.swift:139-145`), so today these become "The box could not answer."
- Fixture `--box-screen-fixture=refresh-failed` (`BoxScreenFixtureScreen.swift:113-115`). Extend.
- Production boxes sleep by exiting: `deploy/systemd/beebox-box@.service:31`, *"--idle-exit 1800000"*. The idle exit runs the server's graceful `shutdown` (`src/webapp/server/app.ts:409`, *"onIdle: () => fireShutdown(\"idle\")"*; `shutdown` at `:358-377` closes the server before exit). A lazy spawning hub stops a box with SIGTERM, which reaches the same `shutdown` (`:399`).
- The hub can tell an asleep box without waking it: `EndpointProvider.get(slug)` answers from polled state, and only `ensureRunning` connects (`src/hub/socket-provider.ts:9-14`; `src/hub/endpoints.ts:45-60`). The catch-all route resolves with `ensureRunning` (`src/hub/server/core.ts:183-186`, `:505`).
- The hub verifies a phone's credential without the box: `hasMobileAuth` (`src/hub/server/core.ts:127-130`), computed as `mobileAuthed` at the top of the catch-all route (`:460-465`).
- Both the box and the hub hold the box's hub secret: the box as `BBX_HUB_SECRET` (`src/core/mobile/session.ts:93-98`; set for spawned children at `src/hub/supervisor/child-spawn.ts:90`), the hub through `secretFor(slug)`. `deriveMobileSessionKey` (`session.ts:84-90`) is the HKDF precedent for deriving a purpose key from it.
- `quickChatHome(boxRoot)` (`src/core/chat/routing/quick-chat-home.ts:56-70`) computes the answer; `quickChatHomeSchema` (`src/webapp/trpc/routers/quick-chat.ts:26-29`) is its output schema.

## Prior art (external)

No design decision depends on an external premise. `Text(_:format: .relative(presentation: .named))` is the iOS 15+ date format used for the age (deployment target is iOS 17, `ios-app/AGENTS.md`). AES-256-GCM through `node:crypto` is the standard authenticated encryption for the snapshot; no library is adopted.

## Ontology

- **Home**: the `quickChat.home` answer (`QuickChatHome`, `ios-app/BeeBox/Models/QuickChatView.swift:82`). Existing.
- **Home date** (new, `homeDates[boxID]`): when the shown home came from the server. From the response time, or from the cache file's modification date on load.
- **Confirmed** (new, `confirmedBoxIDs`): the shown home came from the server since the app last came to the foreground. Cleared when the app goes to the background. Not the same as `refreshes[boxID] == .idle`, which is also true for a cache-only load.
- **Refresh failure** (new, `BoxScreenStore.RefreshFailure`): `.unreachable` (URLError), `.closed(reason: String?)` (503 `box_closed`), `.notOpen` (other 503), `.other`. Carried by `Refresh.failed(_)`.
- **Home snapshot** (new, `.beebox/quick-chat-home.snapshot.json`): the box's `quickChat.home` answer at a clean shutdown, encrypted for the hub. Identified by box root. Not a cache the box reads; only the hub reads it. Present only while the box is asleep after a clean shutdown: the box deletes it first thing at startup, before chat maintenance. It is the box's last answer as of `savedAt`, not a guarantee: the separate scheduler service (`deploy/systemd/beebox-pass@.service`) and hand edits can change chats while `bbx serve` is down, and the seven-day and one-day cutoffs move with time.
- **Snapshot key** (new, derived): HKDF-SHA256 of the box's hub secret with info `beebox quick-chat home snapshot v1 <slug>`. Not stored. On a unit host each box has its own hub secret, so the key isolates boxes; a spawning hub gives every child one secret (`src/hub/supervisor/core.ts:419`), so there the slug only separates keys, and all boxes run as one user anyway.
- **Asleep marker** (new, wire field `asleep: { savedAt: string }` on the home answer): present only on a hub answer from a snapshot. The box never sends it.

## Tracks / scope

### Track 1: confirm, report, and retry the box screen's home

**What.** The store refreshes the shown box when the app comes forward and when a box screen appears, marks the home confirmed or not, classifies failures, and retries a failed refresh on a backoff while the box screen shows in the foreground. The view reads those states.

**Why.** See *What already exists*: no foreground refresh, no age, a 60 s silent wait, and primary styling on an unconfirmed chat.

**Direction.**

- `ComposerDraftRepository.loadQuickChatHome` returns `(home, savedAt: Date?)`; `savedAt` is the file's `.contentModificationDateKey`, nil when unreadable. A nil date reads "Last updated on an earlier visit."
- `QuickChatAPI.homeRequest()` sets `timeoutInterval = 20`. `send` decodes a 503 body at the API boundary: `{ error: "box_closed", reason }` becomes `APIError.closed(reason: String?)` (reason cut to 80 characters); any other 503 becomes `APIError.notOpen`. Tested against the hub's body shape.
- `BoxScreenStore`:
  - `enum Refresh { case idle, refreshing, failed(RefreshFailure) }`.
  - `@Published homeDates: [UUID: Date]` and `@Published confirmedBoxIDs: Set<UUID>`. The view starts its 2 s delay when `refreshes[boxID]` becomes `.refreshing`, with a `.task(id:)` sleep.
  - `setForeground(false)` clears `confirmedBoxIDs` and cancels the retry loop. `setForeground(true)` refreshes `shownBoxID` if set.
  - `setShownBox(id)` refreshes that box when it is not confirmed.
  - Each foreground stretch has a generation number. A refresh records the generation it started in. A success confirms the home only when the generation has not changed; an older in-flight request does not block a new refresh after a return to the foreground. A `CancellationError` leaves the refresh state as it was.
  - `refresh(boxID:)` on success sets `homeDates[boxID] = now()` and inserts into `confirmedBoxIDs`; on failure sets `.failed(classify(error))` and starts the retry loop when that box is shown and the app is in the foreground.
  - Retry loop: one `Task` per store, delays 5, 10, 20, 40, then 60 s repeating; stops on success, background, or a change of shown box. A manual "Retry now" resets the backoff.
- `RootView`'s existing `.task(id:)` refresh stays; the store's `refreshes[boxID] != .refreshing` guard (`BoxScreenStore.swift:227`) drops a duplicate.
- `BoxScreenView`: `refreshNotice` becomes the status row in the Design table; `recentChatRow(..., primary:)` passes `primary: index == 0 && confirmed`.
- Logs: the existing first-failure warn and recovery info (`BoxScreenStore.swift:236-238`, `:248-250`) gain the failure kind. No per-retry line.
- Fixtures: `refresh-failed` seeds a home dated 3 hours ago; add `checking` (a client that never answers) and `box-closed`.

**Vocabulary lock-ins.** None outside the iOS target.

**First implementation chunk.** Store, repository, API, and tests; then view and fixtures.

### Track 2: the box leaves a snapshot when it goes to sleep

**What.** At a clean shutdown the box writes its home answer, encrypted, where the hub can read it. At start it deletes the snapshot before it listens.

**Why.** The list changes only while the box runs, so the answer at shutdown is exact until the next start.

**Direction.**

- New module `src/core/chat/routing/home-snapshot.ts`: `writeHomeSnapshot(boxRoot, { hubSecret, now })`, `removeHomeSnapshot(boxRoot)`, `readHomeSnapshot(boxRoot, { hubSecret })`. The file is `{ v: 1, iv, tag, data }` (base64), mode 0644, written atomically like `writeHubMeta` (`hub-meta.ts:174-193`), including its directory modes. The plaintext is `{ savedAt, home }`. `readHomeSnapshot` returns `{ savedAt, home }` or undefined (absent, wrong key, or malformed; malformed and wrong-key log a warning).
- `shutdown` in `src/webapp/server/app.ts`: after `server.close()`, for each box, write the snapshot when `BBX_HUB_SECRET` is set. Bounded by a 5 s deadline; a result that arrives after the deadline is not written. A failure logs a warning and the shutdown continues. With no hub secret (a box run by hand) it writes nothing. The home is computed as for a live request, including its handling of an unreadable Codex index, so the snapshot is no less complete than a live answer.
- Start: `removeHomeSnapshot` for each box as the first step of serve startup, before the server is created and before chat maintenance (`app.ts:333`, `src/webapp/routes/chat/register.ts:86`). A failure other than ENOENT is an error that stops the start, because a kept snapshot would be served after this box changes.

**Vocabulary lock-ins.** The file name and its envelope; the HKDF info string.

### Track 3: the hub answers from the snapshot

**What.** In the catch-all route, before `resolveEndpoint`: a `GET /<slug>/api/trpc/quickChat.home` with a verified mobile credential, for a box whose `endpoints.get(slug)` is undefined, is answered from the snapshot when one decrypts. Otherwise the request takes today's path, which wakes the box.

**Direction.**

- New `src/hub/server/home-snapshot-route.ts`: `trySnapshotHome({ request, slug, boxRoot, secret, endpoints, mobileAuthed })` returns the reply body or undefined. The body is the tRPC envelope `{ result: { data: { ...home, asleep: { savedAt } } } }`, with `cache-control: no-store`.
- Only the exact path and method; a query string is allowed and ignored (the phone sends none).
- Only `mobileAuthed`. A browser session or an agent bearer takes today's path.
- Logs: none per request. A wrong-key or malformed snapshot warns once per file mtime, in the read.

**Vocabulary lock-ins.** The `asleep` field.

### Track 4: contract and app

**Direction.**

- `quickChatHomeSchema` gains `asleep: z.object({ savedAt: z.string() }).optional()`; `docs/mobile-contract.md` §5.11 and the Q1 row describe it; new shared fixture `test/mobile-contract/fixtures/quick-chat/home-asleep.json` decoded by the TypeScript schema and by XCTest.
- iOS `QuickChatHome` gains `asleep: Asleep?`. A home with `asleep` is a success: confirmed, `homeDates` from `savedAt`, primary styling kept. The view shows the asleep row from the Design table while the box is confirmed and its home carries `asleep`. While shown in the foreground, the store re-checks a sleeping box every 60 s on the same retry task. The cached copy keeps `asleep`, and `loadCachedHome` dates a cached snapshot from its `savedAt` rather than the file's modification time.

## Could this be simpler?

The simplest version is the *Smallest fix* above: a foreground refresh plus the age in the existing row. It fails the issue's second expectation: the top chat stays styled as the current one while the app could not check. It also fails the third: with the box asleep, the person must pull to refresh until it answers. The retry loop is one `Task` with a fixed delay list; failure classification is four cases and only changes the first line of text.

For Tracks 2-4, the simplest version serves the snapshot in plain text at mode 0644, like `hub-meta.json`. It fails on a host with more than one box user: any local user could read every box's chat titles. Encryption with a key both sides already hold costs one derive call and about 30 lines. A second simpler version writes the snapshot on every list change instead of at shutdown. It needs a change trigger that does not exist (sessions change in many places) and gains nothing for the asleep case, where the shutdown copy is exact.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Host asleep: request hangs | Planned: a client that never answers shows `.refreshing`; view shows "Checking" after 2 s | 20 s timeout, then `.failed(.unreachable)` | Clear |
| Hub answers 503 `box_closed` | Planned: classify test | `.closed(reason)` row | Clear |
| Retry loop keeps running in the background | Planned: `setForeground(false)` stops retries | Loop cancelled | Clear |
| Retry loop runs for a box no longer shown | Planned | Loop checks `shownBoxID` | Clear |
| A retry's answer lands after the box switched | Existing guard in `refresh` stores by `boxID` | Home stored for its own box | Clear |
| Cache file date unreadable | Planned | Age reads "from an earlier visit" | Clear |
| A request from before backgrounding answers after the return | Planned: late success does not confirm | Generation check | Clear |
| Retry storm against a waking hub | Planned: delays | Backoff to 60 s | Clear |
| Box crashes: no clean shutdown, so no new snapshot; an older one from a previous clean stop was deleted at that start | Planned: start deletes | Hub finds none, takes today's path | Clear |
| Box start cannot delete the snapshot | Planned | Start fails with an error naming the file | Clear |
| Snapshot write at shutdown fails or times out | Planned | Warning; hub finds none and wakes the box | Clear in the box log |
| Hub secret changed (spawning hub restarted) | Planned: wrong key | Decrypt fails, warning, today's path | Clear |
| Snapshot served while the box is starting | Not tested | Box deletes it first at startup, before chat maintenance changes anything | Accepted |
| Request in the 2 s after an idle exit, while the hub's polled state still says active (`src/hub/socket-provider.ts:184`) | Not tested | Goes to the socket, which starts the box; the box deletes the snapshot and answers live | Accepted: one wake, correct answer |
| Host reboot regenerates the hub secret (`src/hub/secrets.ts:2`) | Planned: wrong key | Decrypt fails, today's path wakes the box once | Clear |
| Shutdown home computation is slow | Planned: late result | 5 s deadline; no write after it | Clear in the box log |
| The box wakes and changes while the phone shows its snapshot | Planned: 60 s re-check while asleep | Next re-check gets the live answer | Clear |
| App restarts with a cached snapshot | Planned | Age from `savedAt`, not the file date | Clear |
| Unauthenticated request for the snapshot path | Planned | Not `mobileAuthed`: today's wall answers 401 | Clear |
| Another local user reads the file | Planned: ciphertext only | AES-GCM with a key from the hub secret | Clear |

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-facing vocabulary.
- Stale ref: ADDRESSED. A chat in the old list that the box has since removed opens in the web view, which shows the box's own answer.
- Two agents touching the same card: not applicable.
- Fabricated free-form value: not applicable.
- Validation error UX: ADDRESSED in the Design table.
- Hand-edit drift: a hand edit to a chat while `bbx serve` is down is not in the snapshot until the box next starts. Accepted, documented under Ontology.
- Partial migration / transition state: an old app ignores the `asleep` field (Swift decoding ignores unknown keys) and shows the snapshot as a fresh list, which is correct. A box from before Track 2 writes no snapshot; the hub takes today's path.
- Web view showing a chat when the box sleeps (a return under 30 minutes keeps the web view, `RootSurface.swift:59`): DEFERRED, see NOT in scope.

## NOT in scope

- The web view's stale chat on a short return. The web app owns its session state (`ios-app/AGENTS.md`: *"The webview is still the chat client"*); a fix there is web-side work.
- The web `/box` screen. The issue is about iOS.
- The dev router's mobile bootstrap 503 (`2026-09-12` re-encounter).
- Honoring `Retry-After`. The backoff cap equals the hub's default of 60 s (`box-unavailable.ts:23`).
- Waking the box when the hub serves the snapshot. The boxholder: *"For now, don't wake the [box]."*
- A snapshot for a laptop box whose host is asleep. Nothing on that side can answer; Track 1 covers it.
- Snapshot answers for the web `/box` screen or for browser sessions. Only the phone's credential is admitted.
- `recentChats` freshness inside the snapshot: `lastActivity` values are as of shutdown, which is exact.

## Open design questions

None. The issue leaves open which chat the app opens when it cannot reach the box; the app opens none by itself and this plan keeps that.

## Knowledge audits

None: no agent-facing concept.

## What will hold this after it ships

`BoxScreenStoreTests` with the fake client, as the existing refresh test does (`BoxScreenStoreTests.swift:261`). Fixture screenshots for the view states. `test/core/chat/routing/home-snapshot.test.ts` for the round trip, wrong key, and malformed file. A hub test beside the existing `test/hub/server/` tests with a static endpoint provider: asleep plus mobile credential gets the snapshot; awake, no credential, a browser cookie, or no snapshot each take today's path. The shared fixture test for `asleep`.

## Implementation order

1. Track 1: store, repository, API changes with tests. Done.
2. Track 1: view status row, unconfirmed style, fixtures, `ios-app/AGENTS.md` fixture list. Done.
3. Track 2 with its tests.
4. Track 3 with its tests.
5. Track 4: schema, fixture, contract doc, iOS decode and asleep row.
6. Simulator walk against the worktree's test1 clone through a local switchable proxy (forward, drop, hang, 503, and a recorded snapshot answer), before and after; exhibit. If a lazy local hub over a throwaway box can be run without touching the shared router, one end-to-end snapshot check through it.

## Rollout shape

Done when the new `BoxScreenStoreTests` cases pass with `bin/apple-test --ios`, the snapshot and hub tests pass under `pnpm test:changed`, the simulator walk shows each Design row, and the exhibit holds the before and after. No migration: the snapshot appears at the first clean shutdown after deploy.
