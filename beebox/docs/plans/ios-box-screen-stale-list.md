---
title: "iOS box screen: say when the chat list is old, and refresh when the box answers"
status: draft
workstream: ios-stale-chat
issues:
  - ../../../issues/bugs/2026-10-26-ios-shows-stale-chat-when-box-is-asleep.md
---
# iOS box screen: say when the chat list is old, and refresh when the box answers

The iOS box screen draws its chat list from a cached server answer. When the box cannot answer, the app shows that cached list with its first chat styled as the current one, and nothing says the list is old. This plan makes the box screen check the box each time it comes forward, say when it cannot reach the box and how old the list is, stop styling an unconfirmed chat as current, and refresh on its own when the box answers.

**Issues addressed:** `issues/bugs/2026-10-26-ios-shows-stale-chat-when-box-is-asleep.md`. Related, not closed: `issues/bugs/2026-09-12-ios-unreachable-box-shows-a-blank-screen.md` covers the web view's failure page and the dev router's mobile bootstrap 503; this plan does not touch the web view. Queue search for "stale", "box screen", "could not refresh", and "asleep" in `issues/` found no other item.

## Design

Situations, from the issue:

- When I open the app and the box cannot answer, I want to see that the box is unreachable and how old the list is, so I do not read an old chat as what I was last doing.
- When the box answers again, I want the list to update without my action, so I do not have to keep pulling to refresh.

What the person sees on the box screen, at the top of the list, in place of today's "Could not refresh" row:

| State | Status row | "Pick up where you left off" |
|---|---|---|
| Fresh answer since the app came forward | none | first chat styled as the primary action (today's look) |
| Checking, under 2 s | none | every chat plain |
| Checking, 2 s or more | spinner, "Checking <box>…", second line "Chats from <relative age>" | every chat plain |
| Failed: no connection or timeout | "Can't reach <box>", second line "Chats from <relative age>. Trying again." and a "Retry now" button | every chat plain |
| Failed: hub 503 `box_closed` | "<box> is closed for <reason>", same second line and button | every chat plain |
| Failed: other 503 | "<box> is not open right now", same second line and button | every chat plain |
| Failed: other status | "Could not refresh <box>", same second line and button | every chat plain |

With no cached list, the second line drops the age ("Trying again.") and the section shows only "All chats", as today.

The primary styling returns when a fresh answer lands. Tapping any chat still opens it; the web view's own unreachable page (`ios-app/BeeBox/Views/RootView.swift:629-630`, `UnreachableBoxView`) covers that path. The app does not open a chat by itself on launch today (`ios-app/BeeBox/Models/RootSurface.swift:61-85` shows the box screen on a cold launch) and this plan does not change that.

The status row is a status line plus a style change. No new surface, card type, or notification, so the bbx-design skill's full template is not used.

## Smallest fix and budget

The smallest fix: refresh on return to the foreground, and show the cached age in the existing "Could not refresh" row. That leaves the first chat styled as current while unconfirmed and leaves no recovery without a pull. The issue's three expectations need the fuller version.

Estimate: one track, iOS only. About 180 changed source lines (`BoxScreenStore.swift`, `BoxScreenView.swift`, `ComposerDraftRepository.swift`, `QuickChatAPI.swift`, `RootView.swift`, fixture screen) and 150 test lines (`BoxScreenStoreTests.swift`). Docs: `ios-app/AGENTS.md` fixture list, a few lines.

## Stated preferences this plan trades against

- `beebox/docs/plans/box-screen.md:256`: *"The box screen draws at once from the outbox and a cached copy of the last `home` answer for the box, then refreshes."* Kept. This plan adds the age and the unconfirmed style; it does not hide the cache.
- `beebox/docs/plans/box-screen.md:198`: *"`recentChats`, the first one styled as the primary action."* Changed to: only after a fresh answer. The issue's expectation, *"It does not present an old chat as the current one when it could not check"*, is the reason.
- `ios-app/AGENTS.md`, Runtime diagnostics: *"Repeated callbacks must log transitions rather than retries. An offline reload loop must not fill the queue with identical lines."* The automatic retry logs only the first failure and the recovery.
- Memory `feedback_minimal_concepts_prefer_primitives`: the fetch time comes from the cache file's modification date, so the cache format does not change.

## What already exists

- `BoxScreenStore.refresh(boxID:)` (`ios-app/BeeBox/Storage/BoxScreenStore.swift:226`) with `Refresh` `.idle/.refreshing/.failed` (`:107-111`). Reuse; `.failed` gains a reason.
- The automatic refresh call is in `RootView`'s `.task(id: store.selectedBox?.id)` (`ios-app/BeeBox/Views/RootView.swift:188-204`): *"await boxScreenStore.refresh(boxID: boxID)"*. It runs on a cold launch and a box switch, not on a return to the foreground; the only other caller is pull to refresh (`BoxScreenView.swift:56-58`). This is the likely cause of the reported staleness: a return from the background redraws the box screen from the in-memory home with no request.
- `setForeground` (`BoxScreenStore.swift:186`) and `setShownBox` (`:200`) already tell the store when the app is active and which box screen shows. Reuse both as the refresh triggers.
- `homeRequest()` (`ios-app/BeeBox/Services/QuickChatAPI.swift:96-101`) sets no `timeoutInterval`, so URLSession's default request timeout of 60 s applies. With the host asleep and no connection refusal, the request can wait up to that long, and today the screen shows nothing during it.
- The hub's 503 JSON body: `{ error: "box_closed", reason, ..., message }` or `{ error: "box_unavailable", message }` (`beebox/src/hub/server/box-unavailable.ts:14-21`). `QuickChatAPI.errorMessage` decodes only the tRPC envelope (`QuickChatAPI.swift:139-145`), so today these become "The box could not answer."
- Fixture `--box-screen-fixture=refresh-failed` (`BoxScreenFixtureScreen.swift:113-115`). Extend.

## Prior art (external)

No design decision depends on an external premise. `Text(_:format: .relative(presentation: .named))` is the iOS 15+ date format used for the age (deployment target is iOS 17, `ios-app/AGENTS.md`).

## Ontology

- **Home**: the `quickChat.home` answer (`QuickChatHome`, `ios-app/BeeBox/Models/QuickChatView.swift:82`). Existing.
- **Home date** (new, `homeDates[boxID]`): when the shown home came from the server. From the response time, or from the cache file's modification date on load.
- **Confirmed** (new, `confirmedBoxIDs`): the shown home came from the server since the app last came to the foreground. Cleared when the app goes to the background. Not the same as `refreshes[boxID] == .idle`, which is also true for a cache-only load.
- **Refresh failure** (new, `BoxScreenStore.RefreshFailure`): `.unreachable` (URLError), `.closed(reason: String?)` (503 `box_closed`), `.notOpen` (other 503), `.other`. Carried by `Refresh.failed(_)`.

## Tracks / scope

### Track 1: confirm, report, and retry the box screen's home

**What.** The store refreshes the shown box when the app comes forward and when a box screen appears, marks the home confirmed or not, classifies failures, and retries a failed refresh on a backoff while the box screen shows in the foreground. The view reads those states.

**Why.** See *What already exists*: no foreground refresh, no age, a 60 s silent wait, and primary styling on an unconfirmed chat.

**Direction.**

- `ComposerDraftRepository.loadQuickChatHome` returns `(home, savedAt: Date?)`; `savedAt` is the file's `.contentModificationDateKey`, nil when unreadable. A nil date reads "Chats from an earlier visit".
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

## Could this be simpler?

The simplest version is the *Smallest fix* above: a foreground refresh plus the age in the existing row. It fails the issue's second expectation: the top chat stays styled as the current one while the app could not check. It also fails the third: with the box asleep, the person must pull to refresh until it answers. The retry loop is one `Task` with a fixed delay list; failure classification is four cases and only changes the first line of text.

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

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-facing vocabulary.
- Stale ref: ADDRESSED. A chat in the old list that the box has since removed opens in the web view, which shows the box's own answer.
- Two agents touching the same card: not applicable.
- Hand-edit drift: not applicable.
- Fabricated free-form value: not applicable.
- Validation error UX: ADDRESSED in the Design table.
- Partial migration / transition state: none; the cache format does not change.
- Web view showing a chat when the box sleeps (a return under 30 minutes keeps the web view, `RootSurface.swift:59`): DEFERRED, see NOT in scope.

## NOT in scope

- The web view's stale chat on a short return. The web app owns its session state (`ios-app/AGENTS.md`: *"The webview is still the chat client"*); a fix there is web-side work.
- The web `/box` screen. The issue is about iOS.
- The dev router's mobile bootstrap 503 (`2026-09-12` re-encounter).
- Honoring `Retry-After`. The backoff cap equals the hub's default of 60 s (`box-unavailable.ts:23`).

## Open design questions

None. The issue leaves open which chat the app opens when it cannot reach the box; the app opens none by itself and this plan keeps that.

## Knowledge audits

None: no agent-facing concept.

## What will hold this after it ships

`BoxScreenStoreTests` with the fake client, as the existing refresh test does (`BoxScreenStoreTests.swift:261`). Fixture screenshots for the view states.

## Implementation order

1. Store, repository, API changes with tests.
2. View status row, unconfirmed style, fixtures, `ios-app/AGENTS.md` fixture list.
3. Simulator reproduction against the worktree's test1 clone through a local switchable proxy (forward, refuse, hang, 503), before and after; exhibit.

## Rollout shape

Done when the new `BoxScreenStoreTests` cases pass with `bin/apple-test --ios`, the simulator walk shows each Design row, and the exhibit holds the before and after. No migration.
