---
title: "Quick chat Home: a thought goes in before the box loads"
status: draft
workstream: quick-chat-design
issues:
  - ../../../issues/features/2026-09-25-quick-drop-entry-points.md
---
# Quick chat Home: a thought goes in before the box loads

When I open the app with a thought in my head, I want to type or say it at once, so that it is safe in the box before any chat has loaded. When the box knows where the thought belongs, I want it posted there without a question. When the box does not know, I want a short list to pick from, and I want the thought kept if I walk away.

Today the iOS app loads the full web chat and the last conversation first. Quick chat sits behind that load, as a web form in a sheet. The web Quick chat page skips the box load, but its send and recovery behavior loses messages and overwrites drafts. This plan adds a native Home screen with an inline composer, moves routing and delivery to one server operation, and rebuilds the web page on the same operation.

**Issues addressed:** `issues/features/2026-09-25-quick-drop-entry-points.md` (partly: the in-app door and the after-drop state; it stays open for the doors outside the app). Related and not closed by this plan: `issues/features/2026-08-08-ios-siri-app-intent-capture.md` (a later caller of the same server operation), `issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md` (half 2 is this routing; the issue also owns Gmail admission), `issues/bugs/2026-09-21-share-sheet-webpage-stub-never-completed.md`, `issues/bugs/2026-08-20-capture-success-is-invisible.md`, `issues/features/2026-08-30-chat-input-everywhere.md`, `issues/features/2026-09-25-notifications-and-proactive-design.md`. Queue search for "cold start", "launch screen", "home screen", "box selector", and "quick chat" found no other open item about the launch path.

## Smallest fix and budget

**BIG CHANGE.** The estimate is about 2,900 changed lines. The boxholder must approve this size before implementation.

The smallest fix for the reported problem is a native screen with a text field that posts to the existing `quickChat.prepare` and then sends from native code. It fails on the reported recovery defects: the two-step send still loses the message when the caller stops between steps, and a routing failure still sends nothing.

The chosen design has three tracks.

| Track | Source | Tests | Notes |
|---|---|---|---|
| 1. Server: one submit operation, disposition policy, records | 450 | 400 | includes extracting the send-route body |
| 2. Web: Quick chat page on the new operation | 250 | 100 | deletes the client-side send and the draft staging |
| 3. iOS: Home screen, outbox, launch rule, Home button | 1,100 | 350 | replaces the Quick chat sheet |
| Authored docs | 250 | | quick-chat.md, mobile-contract.md, ios-app/CLAUDE.md, security report |

What the size buys: a thought is stored by the server in one request; every caller (web, Home, later Siri and the share sheet) gets the same routing and the same recovery; the phone shows a composer before any web content loads.

## Stated preferences this plan trades against

- The boxholder, 2026-10-06: "now you load the entire app and last chat before you can quick chat in many cases... The whole point is BEFORE all that happens." Home must not construct the web chat.
- The boxholder, 2026-10-06: Home has "last chat, some boxes to switch to, and an inline input (voice or text, and reusing the ios input) that lets you compose a message for the current box, get it sorted, and give some options if the sorting isn't definitive (low confidence) or directly post if it's high confidence."
- The boxholder, 2026-10-06: "if you had the app open recently, and everything is loaded/cached, then it would show the last conversation. But if not then you get this screen. Also you should be able to get back to this screen."
- The boxholder, 2026-10-06: "I'm slightly concerned it's too complicated for the one-box situation." With one box the Boxes section is absent. With nothing unfinished the Needs you section is absent.
- This reverses two lines of `beebox/docs/plans/chat-routing.md`: "There is no ask-me outcome" and "Automatic iOS cold-start heuristics: explicit button is the first version". Both were choices for an evaluation surface that the boxholder has now evaluated.
- `ios-app/CLAUDE.md:160`: "Native must submit an `Emission` to the visible web session; it must not call chat-send APIs behind the webview." Home has no visible web session. The plan amends the rule to name the exception: a quick chat submission from a screen with no web chat mounted. Precedent: the share extension already posts to `chat/send` in exact mode (`beebox/docs/mobile-contract.md:1284`, row S3).
- Principle 4, "Resilient AND never silent". A routing failure today ends with "Your message has not been sent." The new operation stores the thought and asks.
- Principle 8, "One way to do each thing". Delivery reuses the send route's own body. It does not add a third delivery implementation beside the route and `deliverUserMessage`.
- Principle 13, "A control shows the state the system is in". Home shows stored-not-sent, sending, sent, and not-delivered as different faces.

## What already exists

Paths are monorepo-relative.

- `beebox/src/webapp/trpc/routers/quick-chat.ts:84`: `prepare: authedProcedure.input(prepareSchema).mutation(...)`. It builds candidates, asks Jev, and writes `.beebox/quick-chat/<id>.json`. **Reuse** the judgment, the reservation of a new session, the record lock, and the idempotent "same id returns the same record" behavior. **Replace** `prepare` and `receipt` with `submit`, `choose`, `discard`, and `home`.
- `beebox/src/frontend/src/pages/quick-chat/QuickChatPage.tsx:76`: `const ack = await startChatTurn({ ...prepared.delivery, message: prepared.message, messageId: prepared.id });`. The page performs the send. A caller that stops after `prepare` has a record and no message. **Delete.**
- `beebox/src/frontend/src/pages/quick-chat/QuickChatResult.tsx:29`: the "Open chat" link has `onClick={openDestination}`. `openDestination` (line 16) writes the message into the box-scoped composer draft with `localStorage.setItem(emissionKey(...), draft)`. After a successful send this stages the same text again, and it replaces any draft the person already had. **Delete.**
- `beebox/src/webapp/trpc/routers/quick-chat.ts:69`: `if (!ctx.services.jev && !key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Quick chat needs an OpenRouter key granted to this box. Your message has not been sent." });`. **Change**: a missing key or a failed judgment produces a stored record that asks.
- `beebox/src/services/jev.ts:20`: `JevDecision {model, probabilities, confidence}`. The record stores `confidence` and no code reads it. **Reuse** the probabilities in the disposition policy.
- `beebox/src/core/chat/routing/policy.ts:31`: `selectRoutingDestination`, with the comment "Trial preference, not a calibrated correctness threshold." **Reuse** for selection; add the disposition beside it.
- `beebox/src/webapp/routes/chat/send-routes.ts:62`: the `POST /api/chat/send` handler. After target resolution it attributes the sender (`injectUserAttr`), claims the message id (`claimMessageId`), records the user message, and queues or starts a turn. **Extract** the part after target and identity resolution into a function both the route and `quickChat.submit` call.
- `beebox/src/core/chat/session/deliver-user-message.ts:128`: `deliverUserMessage`, used by capture and bulk upload. It emits `user: null` and sends `{ text: message, clientComposed: true as const }` (line 187), and takes no message-id claim. It fits server-composed wrappers. **Not reused** for a person's typed thought.
- `beebox/src/webapp/routes/chat/send-dedup.ts:24`: `const MESSAGE_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days`, persisted in `.beebox/message-dedup.json`. **Reuse**: the record id is the message id, so a repeated delivery of one record posts once.
- `beebox/src/core/chat/session/reserve.ts:215`: `if (engine !== "claude") return { kind: "unsupported" };`. A new chat on another engine has no session id until the engine assigns one. **Reuse** the existing fallback in `quick-chat.ts` `reserve`.
- `beebox/src/core/chat/session/recent-landmark.ts:18`: `listRecentLandmarkChats(boxRoot, options?: { limit?: number; now?: number })`. **Reuse** for Home's recent chats.
- `beebox/src/webapp/server-box-scope.ts:302`: a paired device's bearer token passes `authedProcedure` (`mobileOk`). The share extension calls `share.destinations` and `share.saveTextual` this way. **Reuse**; no new auth.
- `ios-app/BeeBox/Views/RootView.swift:306`: `ChatWebView(` is constructed whenever a box is selected. `ChatWebView.swift:219` creates a new `WKWebView` in `makeUIView` and line 224 loads it. **Change**: construct it only when a chat is shown.
- `ios-app/BeeBox/Views/RootView.swift:439`: `showingQuickChat = true`, and the `QuickChatSheet` struct near line 797. **Delete**; the Home button replaces them.
- `ios-app/BeeBox/Views/NativeComposerView.swift:1006`: `private func enqueueMessage(`. It hands the message to `pendingStore.enqueue(...)` with a conversation binding. `NativeComposerFixtureScreen.swift:69` already hosts the composer with no web view. **Reuse** the composer; add one submit seam.
- `ios-app/BeeBox/Storage/PendingEmissionStore.swift`: holds emissions until the web client returns a receipt, scoped to one composer binding. **Not reused** for Home; its states are web receipts.
- `ios-app/BeeBox/Services/SpeechDictation.swift:162`: on-device dictation with no session or web dependency. `ChatAPI.transcribeAudio` resolves a session through `chat/default` and needs no web view. **Reuse** both.
- `ios-app/BeeBox/Views/ComposerActionsView.swift:84`: `Section("Boxes")` lists paired boxes and calls `store.select(box)`. **Reuse** the selection call on Home.
- No record of "backgrounded at" exists in the app. A search for `lastBackground`, `backgroundedAt`, `lastActive`, and `didEnterBackground` found only an unrelated line in `CaptureAcquisition.swift`.

## Prior art (external)

No design decision here depends on an external library limit. One external premise was measured: routing speed and score shape. Ten synthetic thoughts were sent through the real service on 2026-10-06 with the development key, against three existing chats and four new-chat candidates.

| Thought | Top choice | Second |
|---|---|---|
| Check whether the raised bed lumber order shipped | Garden raised beds 1.00 | |
| The dishwasher repair guy is coming Tuesday at 10 | Household 1.00 | |
| Look into whether we need travel insurance | Trip planning 0.99 | |
| How much did we spend on groceries last month | New chat in Finances 0.98 | |
| Save this: sourdough starter feeding ratio is 1:5:5 | New chat in Recipes 0.98 | |
| Call mom | New general chat 0.96 | Household 0.04 |
| Remind me to renew my passport | Trip planning 0.85 | New general chat 0.14 |
| Ask Dana about the 14th | Trip planning 0.83 | New general chat 0.17 |
| ok | New general chat 0.58 | Garden raised beds 0.40 |
| What should I plant next to the tomatoes | New chat in Garden 0.53 | Garden raised beds 0.47 |

Each call took 0.2 to 0.5 seconds. Clear matches scored 0.95 or more. Debatable matches scored near 0.85. The last row is not a real doubt: both choices are the same place, and the existing-chat preference already resolves it. These are ten synthetic samples. They justify a provisional rule and nothing more.

## Ontology

- **Quick chat message**: one thought submitted for routing. Identified by a client-made UUID. Stored as a quick chat record. It is NOT a chat message until it is delivered; after delivery the chat message carries the same UUID as its message id.
- **Quick chat record** (exists: `QuickChatRecord`, `quick-chat.ts:32`): the stored message, its candidates, probabilities, and state. Gains a `state` field.
- **State**: one of `needs-choice`, `sending`, `sent`, `discarded`.
  - `needs-choice`: stored, no destination fixed. Carries a `reason`: `uncertain`, `routing-unavailable`, or `destination-gone`.
  - `sending`: destination fixed, delivery not yet acknowledged. Carries `lastError` after a failed attempt.
  - `sent`: delivery acknowledged. Carries the session id when known, and `queued` when the chat was busy.
  - `discarded`: the person removed it. Terminal.
- **Candidate** (exists: `RoutingCandidate`, `policy.ts:10`): an existing chat or a new chat in a place.
- **Disposition**: the policy's answer for a judged message: `post` or `ask`. NOT stored separately; it becomes the record's first state.
- **Home**: the screen that shows unfinished quick chat messages, recent chats, paired boxes when there is more than one, and the composer. One per platform: the native Home on iOS, the Quick chat page on web. NOT a chat and NOT bound to a session.
- **Outbox** (new, iOS only): quick chat messages the phone has not yet handed to the server. Identified by the same UUID. An outbox entry is removed when the server returns a record for its id.

## Tracks / scope

### 1. Server: one submit operation

**What.** `quickChat.submit` stores, routes, and delivers in one request. `quickChat.choose` fixes a destination for a stored message and delivers. `quickChat.discard` ends one. `quickChat.home` returns what Home shows.

**Why this needs to change.** The page-driven two-step send loses a message when the caller stops between steps (`QuickChatPage.tsx:76`). A native screen, a share extension, or an App Intent cannot stay open through routing and a chat send.

**Direction.**

```ts
submit: { id: uuid, message: string(1..12000) } -> QuickChatView
choose: { id: uuid, candidateId: string } -> QuickChatView
discard: { id: uuid } -> QuickChatView
home:   {} -> { open: QuickChatView[], recentlySent: QuickChatView[], recentChats: RecentLandmarkChat[] }

type QuickChatView = {
  id; message; createdAt; state;
  destination?: { label; sessionId?: string };          // sending, sent
  queued?: boolean;                                      // sent
  reason?: "uncertain" | "routing-unavailable" | "destination-gone";   // needs-choice
  lastError?: string;                                    // sending
  choices?: { candidateId; label; detail?: string }[];   // needs-choice, at most 4
};
```

`submit` runs under the existing per-record lock.

1. A record with this id exists: the text must match (existing CONFLICT rule). If its state is `sending`, attempt delivery again. Return its view.
2. Build candidates and ask Jev. On `RoutingCatalogError`, a missing key, or `JevError`: write a `needs-choice` record with `reason: "routing-unavailable"`. Its choices are the recent chats and "New general chat", built without Jev. A catalog failure leaves only "New general chat".
3. Apply `selectRoutingDestination`, then the disposition policy.
4. `ask`: write `needs-choice` with `reason: "uncertain"`. Choices are the three highest candidates plus "New general chat" when it is not among them.
5. `post`: reserve a new session when needed, write the record as `sending`, deliver, then write `sent`.

The views carry no probabilities. The record keeps them for calibration.

**Disposition policy** (pure, in `core/chat/routing/policy.ts`):

```ts
export function routingDisposition(args: {
  selected: RoutingCandidate; ranked: RankedRoutingCandidate[]; postFloor?: number;
}): "post" | "ask"
```

It sums the probabilities of the candidates in the same place as `selected` (same `landmark.path`, or the root when neither has a landmark). It returns `post` when that sum is at least `postFloor`, default 0.9. Against the ten samples above this posts seven and asks three ("passport", "Dana", "ok"). The floor is provisional and is one named constant.

**Delivery.** Extract the body of the `POST /api/chat/send` handler, from sender attribution through the queued-or-started reply, into `sendUserMessage(deps, { target, message, messageId, user, channel, images, cardFields })` beside the route. The route calls it with the values it already computes. `quickChat` calls it with `messageId = record.id`, the caller's identity (`ctx.user`, which a paired device fills from `createdBy`), and the channel the caller reports (the share extension already sends `channel:"ios-native"`, `mobile-contract.md:1284`). A `CHAT_SESSION_UNAVAILABLE` result moves the record to `needs-choice` with `reason: "destination-gone"`. Any other failure leaves it `sending` with `lastError`.

**Record storage.** Records in `needs-choice` or `sending` live in `.beebox/quick-chat/open/<id>.json`. A record moves to `.beebox/quick-chat/<id>.json` when it becomes `sent` or `discarded`. `home` lists the `open/` directory, so its cost does not grow with history, and an unfinished message never ages out of view. `recentlySent` is the records sent in the last 24 hours, found by file time, at most five. Existing records have no `state`; the reader treats a record with a `receipt` as `sent` and one without as `sending`.

**Vocabulary lock-ins.** The four state names, the three reasons, the procedure names, and the `open/` directory.

**First implementation chunk.** `routingDisposition` with a doctest table: the ten rows above, an exact tie, a single candidate, a selected candidate with no landmark, and a floor of 1. Then the record schema with `state` and the old-record reader, with doctests for each state and for a record written before this change.

### 2. Web: the Quick chat page

**What.** `/<box>/quick-chat` becomes the web Home: the unfinished list, recent chats, and the input.

**Why.** The page owns a send it cannot guarantee, restages sent text, and overwrites the composer draft.

**Direction.** The page calls `home` on load. Send generates an id, keeps `{id, message}` in browser storage until `submit` answers, and retries `submit` with the same id on reload. The input clears when the server answers; the answer appears as a row above it.

- `sent`: "Sent to <label>" and an "Open chat" link that only navigates.
- `needs-choice`: the reason in words ("Not sure where this goes", "Could not sort this", "That chat is gone"), the choices as buttons, and Discard.
- `sending` with `lastError`: "Not delivered", with Retry and Discard.

The percentages, the "Jev's top choices" block, the staged-text correction links, and the read-only textarea state are removed. The box selector tile keeps its link.

**First implementation chunk.** The page state as a pure reducer over `home` data and `submit`/`choose` results, with a doctest for each row face and for reload with a stored unsent message.

### 3. iOS: Home, outbox, launch rule

**What.** A native `HomeView`, a `QuickChatOutbox`, a rule for when Home shows, and a Home button in the chat view.

**Why.** The app constructs the web chat for every launch (`RootView.swift:306`), so the composer is usable only after the last conversation loads, and its message goes to that conversation.

**Direction.**

- **Root state.** `RootView` gains `surface: .home | .chat(sessionID: String?)`. `ChatWebView` is constructed only for `.chat`. The native composer below it stays as it is for `.chat`.
- **Launch rule.** A cold launch starts on `.home`. On return to the foreground, the app goes to `.home` when it was in the background for 30 minutes or more, or when the web content process ended while in the background (`webViewWebContentProcessDidTerminate`, `ChatWebView.swift:491`). Otherwise it stays on the chat it was showing. A notification tap goes to its target chat directly (`openNotificationTap`, `RootView.swift:251`). The app records the background time in memory; a killed app is a cold launch.
- **Home content, top to bottom.** "Needs you": outbox entries not yet accepted, then the server's `open` list. Then `recentlySent` rows for this app session's submissions. Then "Pick up where you left off": `recentChats`, the first one styled as the primary action, and "All chats", which opens the web chat list. Then "Boxes", only with two or more paired boxes. The composer is pinned at the bottom with the line "New thought. The box picks the conversation."
- **Loading.** Home draws at once from the outbox and a cached copy of the last `home` answer for the box, then refreshes. The composer does not wait for the refresh.
- **Composer seam.** `NativeComposerView` gains `submitTarget: .conversation | .quickChat((String) -> Void)`. For `.quickChat`, `enqueueMessage` calls the closure with the final text and clears the draft. Home hosts it with `requiresConversationBinding: false` and `captureAvailable: false`. The "+" button, the screenshot action, location sharing, and spoken send keywords are hidden for `.quickChat`. Dictation works as in chat. High-quality transcription uses the last value of the box's setting that the web chat reported; the app stores that value per box.
- **Outbox.** `QuickChatOutbox` persists `{id, boxID, text, createdAt, attempts, lastAttemptAt}` in the app's repository. Submitting from Home adds an entry and starts `submit`. Success removes the entry and shows the returned view. A network failure keeps the entry; the app retries with backoff while it is in the foreground and once on each launch. After 7 days without success the entry stops retrying and shows "Not sent" with Retry and Discard. The 7 days matches the server's message-id retention, so a late retry cannot post twice.
- **Result rows.** The same three faces as the web page. Choosing a destination calls `choose`. "Open chat" switches to `.chat(sessionID)`.
- **Home button.** The bar above the chat composer shows "Home" where "Quick chat" was. `QuickChatSheet`, `showingQuickChat`, and `ChatWebView`'s `.quickChat` page are removed.
- **Box switch and lock.** Selecting a box on Home reloads Home for that box. A locked box shows `LockedBoxView` over Home, as it does over chat today.
- **Native API.** `QuickChatAPI` with `submit`, `choose`, `discard`, `home`, using `BoxRequest.apply` for the bearer token, in the pattern of `ShareExtensionAPI`.
- **Contract.** `mobile-contract.md` gains a section 5 entry for the four procedures with shared fixtures under `beebox/test/mobile-contract/fixtures/`. The "Quick chat evaluation entry" section is replaced. `ios-app/CLAUDE.md:160` gains the stated exception.

**Vocabulary lock-ins.** `surface`, `submitTarget`, `QuickChatOutbox`, `HomeView`.

**First implementation chunk.** The launch rule as a pure function `initialSurface(coldLaunch:, backgroundedFor:, webContentAlive:, notificationTap:)` with XCTest cases for each input. Then `QuickChatOutbox` with tests for add, accept, network failure, the 7-day stop, and restart.

## Could this be simpler?

The simplest version that could work: keep the web page, fix its two staging bugs, and add an iOS cold-start rule that opens the existing web sheet first. It fails on the stated goal. The sheet is a web view, so the person still waits for web content, has no native dictation, and the two-step send still loses messages. Principle 4 rules out keeping the lossy send.

A middle version drops `needs-choice` and always posts, as today. It is about 300 lines smaller. The boxholder asked for options at low confidence, and the samples show debatable matches near 0.85 that would post to a wrong chat with no undo.

A second middle version reuses `deliverUserMessage` and skips the send-route extraction. It is about 150 lines smaller. It gives a typed thought no sender, no message-id claim, and the `clientComposed` flag meant for wrappers. Fixing those inside `deliverUserMessage` rebuilds the route body a third time (principle 8).

The outbox could be dropped by making the composer wait for the server. Then a thought typed with no signal is lost when the app closes. That is the case the Home screen exists for.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Jev key missing, timeout, or malformed answer | Planned router doctest with the fake service | Record stored as `needs-choice`, `routing-unavailable` | Clear |
| Catalog cannot be built (invalid rubric, more than 255 candidates) | Planned router doctest | Stored as `needs-choice` with "New general chat" only | Clear |
| Server stops after writing `sending` and before delivery | Planned router doctest that re-submits the id | Record stays in `open/`; Home shows "Not delivered"; a repeat `submit` or Retry delivers | Clear |
| Server stops after delivery and before writing `sent` | Planned doctest: second delivery with the same message id | The message-id claim answers the second attempt as a duplicate; the record becomes `sent` | Clear |
| Chosen chat deleted between routing and delivery | Planned router doctest | `needs-choice`, `destination-gone` | Clear |
| Chosen chat is busy | Existing send-route queue test; planned view test | `sent` with `queued`; the row says "Queued in" | Clear |
| Server restarts while the message waits in a busy chat's queue | No | No. The queue is memory only (`run/core.ts:61`: `private messageQueue: ChatSendInput[] = []`) | The record says `sent`; the agent may never run it. Existing behavior of every queued send. Documented risk, see NOT in scope |
| New chat on a non-Claude engine has no session id yet | Planned router doctest | `sent` without a session id; the row offers "All chats", not "Open chat" | Clear |
| Phone has no signal at submit | Planned outbox XCTest | Entry stays in the outbox and retries; row shows "Waiting to send" | Clear |
| Outbox entry never succeeds | Planned outbox XCTest | Stops at 7 days; "Not sent" with Retry and Discard | Clear |
| `submit` succeeded and the response was lost | Planned outbox XCTest and router doctest | Retry with the same id returns the stored record | Clear |
| Person submits to box A, then switches to box B | Planned outbox XCTest | Entries carry `boxID`; each is sent to its own box | Clear |
| Home's cached list is stale | Planned HomeView fixture | Refresh replaces it; a failed refresh shows "Could not refresh" above the list | Clear |
| Web content process ends in the background | Planned launch-rule XCTest | Return goes to Home | Clear |
| Confident post lands in the wrong chat | No test can cover routing quality | No undo. The row names the chat and links to it. The person corrects it in that chat | Clear, not recoverable. Accepted for this version; see Open design questions |

No critical gap: every new codepath has a planned test and a visible state. The busy-queue row is pre-existing and silent; it is recorded as an accepted risk.

## Agent-flow / user-flow edge cases

- Wrong destination: ADDRESSED in part. Uncertain messages ask. A confident wrong post is visible and not reversible (Failure modes, last row).
- Stale ref: ADDRESSED. `destination-gone` at delivery; `choose` validates the candidate against the stored record.
- Two actors on one record: ADDRESSED. All four procedures take the per-record file lock (`quick-chat.ts:47`, `withFileLock`). A second `choose` on a `sent` record returns the record unchanged.
- Hand-edit drift: ADDRESSED by the existing rubric validation; a bad rubric now stores and asks.
- Fabricated value: ADDRESSED. `choose` accepts only a `candidateId` present in the record.
- Validation error UX: ADDRESSED. Each `reason` and `lastError` has a fixed sentence on both platforms.
- Partial transition: ADDRESSED. Old records read as `sent` or `sending`. An old iOS build still opens `/quick-chat` in its sheet and gets the new web page, which works without the native bridge. `prepare` and `receipt` are removed in the same change as their only caller.
- Typing on Home while a notification tap arrives: ADDRESSED. The composer draft is the box-scoped draft store and survives the switch to the chat.

## NOT in scope

- Siri, Shortcuts, the Action Button, a widget, and a Control Center control: they call `quickChat.submit` later. Their own questions (lock-screen access, spoken results) are in `issues/features/2026-08-08-ios-siri-app-intent-capture.md`.
- The share extension: it keeps its picker. Giving it an automatic destination is a small follow-up once `submit` exists.
- Photos, files, and capture from Home: routing judges text only, and uploaded files under `_tmp/` are swept (`uploads.ts:17`). A photo thought needs its own storage rule.
- A notification for an unplaced thought: it needs a new notification target for Home on both platforms. Home shows the thought on the next open.
- Undo or move after a confident post: the first chat's agent has already acted.
- Calibrating the post floor: needs real records. The constant is provisional.
- Making the busy-chat queue survive a restart: a property of every chat send, not of this plan.
- Preloading the last chat's web view behind Home.
- The web box selector page as Home: the Quick chat page is the web Home. The selector keeps its link.
- Telegram, jobs, and inbox destinations: unchanged from `chat-routing.md`.

## Open design questions

- **The 30 minutes.** The boxholder's rule is "open recently and everything loaded". Lean: 30 minutes, one constant, adjust after use.
- **A hold before a confident post.** A few seconds with a Change button would let the person stop a wrong post. The boxholder's words were "directly post if it's high confidence". Lean: no hold in this version.
- **An unplaced thought nobody returns to.** It stays in "Needs you" with no time limit. Lean: keep it; add a notification when the target type exists.
- **The post floor.** 0.9 from ten synthetic samples. Lean: ship it, then review real records after two weeks of use.
- **Preloading the last chat.** It would make the "last chat" tap faster and costs a web load on every cold launch. Lean: no, until the tap feels slow.

## Knowledge audits

The agent-facing concept is unchanged: the rubric in `_config/chat-routing.yaml`, covered by the existing audit from `chat-routing`. `beebox/docs/box/quick-chat.md` gains one sentence: an uncertain thought waits for the person. Re-run the existing rubric audit after that edit. No new audit.

## What will hold this after it ships

- Pure doctests: `routingDisposition`, the record reader, the web page reducer.
- Router doctests with the fake Jev service (`createFakeJev`, `jev.ts:135`) and the caller pattern in `test/webapp/trpc/routers/quick-chat.doctest.md`: every row of the failure table that names one.
- Send-route doctests, unchanged, prove the extraction kept the route's behavior.
- Mobile-contract fixtures for the four procedures, parsed by both the Swift and TypeScript sides.
- XCTest: `initialSurface`, `QuickChatOutbox`, `QuickChatAPI` request shapes.
- A DEBUG `--home-fixture=<state>` launch argument, in the pattern of `--composer-fixture=`, for simulator screenshots of each Home face.
- Not covered by automation: dictation on Home on a physical phone, and routing quality.

## Implementation order

1. `routingDisposition` and the record schema with states (track 1, first chunk).
2. Extract `sendUserMessage` from the send route. No behavior change; the existing route tests pass.
3. `submit`, `choose`, `discard`, `home`; remove `prepare` and `receipt`.
4. Web page on the new procedures (track 2).
5. Mobile-contract fixtures and `QuickChatAPI`.
6. `initialSurface`, `QuickChatOutbox`.
7. `HomeView`, the composer seam, the Home button; remove the sheet.
8. Docs: `docs/chat/quick-chat.md`, `docs/box/quick-chat.md`, `mobile-contract.md`, `ios-app/CLAUDE.md`, security report section 3.
9. Browser walk of the web page against the test box. Simulator walk of Home with fixtures and against the test box. The test box needs an `openrouter` grant for the sorted path; without one, the walk covers the `routing-unavailable` path only.

## Rollout shape

Done when the doctests and XCTests named above pass, `pnpm test:changed` and `pnpm lint:changed` pass, the mobile-contract check passes, and the browser and simulator walks are recorded as an exhibit. Record shape changes are read-compatible; no migration runs. The server and web parts deploy on merge. The iOS part reaches the phone with the next build the boxholder installs; an older build keeps working through the web page. A physical-phone check of dictation on Home and of the launch rule is manual testing for the boxholder.
