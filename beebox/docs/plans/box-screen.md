---
title: "Box screen: a thought goes in before the box loads"
status: draft
workstream: quick-chat-design
issues:
  - ../../../issues/features/2026-09-25-quick-drop-entry-points.md
---
# Box screen: a thought goes in before the box loads

When I open the app with a thought in my head, I want to type or say it at once, so that it is safe in the box before any chat has loaded. When the box knows where the thought belongs, I want it posted there without a question. When the box does not know, I want a short list to pick from, and I want the thought kept if I walk away.

Today the iOS app loads the full web chat and the last conversation first. Quick chat sits behind that load, as a web form in a sheet. The web Quick chat page skips the box load, but its send and recovery behavior loses messages and overwrites drafts. This plan adds a box screen with an inline composer on iOS and web, moves routing and delivery to one server operation, and reshapes the app bar's menus so that the box screen holds what concerns the whole box.

**Issues addressed:** `issues/features/2026-09-25-quick-drop-entry-points.md` (partly: the in-app door and the after-drop state; it stays open for the doors outside the app). Related and not closed by this plan: `issues/features/2026-08-08-ios-siri-app-intent-capture.md` (a later caller of the same server operation), `issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md` (half 2 is this routing; the issue also owns Gmail admission), `issues/bugs/2026-09-21-share-sheet-webpage-stub-never-completed.md`, `issues/bugs/2026-08-20-capture-success-is-invisible.md`, `issues/features/2026-08-30-chat-input-everywhere.md`, `issues/features/2026-09-25-notifications-and-proactive-design.md`. Queue search for "cold start", "launch screen", "home screen", "box selector", and "quick chat" found no other open item about the launch path.

## Smallest fix and budget

**BIG CHANGE.** The estimate is about 3,750 changed lines. The boxholder has agreed the design in discussion and has not yet approved this size.

The smallest fix for the reported problem is a native screen with a text field that posts to the existing `quickChat.prepare` and then sends from native code. It fails on the reported recovery defects: the two-step send still loses the message when the caller stops between steps, and a routing failure still sends nothing.

The chosen design has four tracks.

| Track | Source | Tests | Notes |
|---|---|---|---|
| 1. Server: one submit operation, disposition policy, records | 450 | 400 | includes extracting the send-route body |
| 2. Web: the box screen | 350 | 150 | replaces the Quick chat page; deletes the client-side send and the draft staging |
| 3. Web: app bar menus | 250 | 150 | landmark menu, folder menu, landmark search page |
| 4. iOS: box screen, outbox, launch rule | 1,300 | 400 | replaces the Quick chat button, the sheet, and the "+" menu's box list |
| Authored docs | 300 | | quick-chat.md, landmarks and navigation docs, mobile-contract.md, ios-app/CLAUDE.md, security report |

What the size buys: a thought is stored by the server in one request; every caller (web, the phone, later Siri and the share sheet) gets the same routing and the same recovery; the phone shows a composer before any web content loads; box-wide navigation has one home on both platforms.

## Stated preferences this plan trades against

- The boxholder, 2026-10-06: "now you load the entire app and last chat before you can quick chat in many cases... The whole point is BEFORE all that happens." The box screen must not construct the web chat.
- The boxholder, 2026-10-06: the screen has "last chat, some boxes to switch to, and an inline input (voice or text, and reusing the ios input) that lets you compose a message for the current box, get it sorted, and give some options if the sorting isn't definitive (low confidence) or directly post if it's high confidence."
- The boxholder, 2026-10-06: "if you had the app open recently, and everything is loaded/cached, then it would show the last conversation. But if not then you get this screen. Also you should be able to get back to this screen."
- The boxholder, 2026-10-06: "I'm slightly concerned it's too complicated for the one-box situation." With one box the Boxes section is absent. With nothing unfinished the Needs you section is absent.
- The boxholder, 2026-10-06, on the way back: "the home button doesn't make sense to me. Let's just put it in the box menu, maybe it'll replace a lot of that box navigation."
- The boxholder, 2026-10-06, on the menus: "Right now switching landmarks is common and useful. Searching is useful. All landmarks could probably go off of the search page or something. Or until I search, the search page could show the hierarchical view. Recent files feels like it should go under the folder menu." Then: "the landmark card itself shouldn't be in the folder menu... For now I think landmark search and file search are different (I use them differently)... Settings and Admin are okay in avatar." Then: "The agent edits the landmark card, not the user. Chat folders pretty much always have landmarks. removing box shortcuts is fine I guess I think."
- The boxholder, 2026-10-06, accepted these as stated ("this sounds good"): an unclear thought the person walks away from stays unsent and shows first on the next open; "recently" is under 30 minutes in the background; the posting floor starts near 0.9; voice on the box screen starts with on-device dictation; on web the box screen replaces the Quick chat page.
- This changes shipped navigation from `beebox/docs/implemented-plans/top-nav-ia.md`: line 296 puts Dashboard, Browse, History, "Other boxes →", and "All landmarks →" in the switch menu, and line 139 puts "Recent files ›" in the menu body with the directory link. The boxholder's statements above replace those placements.
- This reverses two lines of `beebox/docs/plans/chat-routing.md`: "There is no ask-me outcome" and "Automatic iOS cold-start heuristics: explicit button is the first version". Both were choices for an evaluation surface that the boxholder has now evaluated.
- `ios-app/CLAUDE.md:160`: "Native must submit an `Emission` to the visible web session; it must not call chat-send APIs behind the webview." The box screen has no visible web session. The plan amends the rule to name the exception: a quick chat submission from a screen with no web chat mounted. Narrow precedent: the share extension already calls the box from native code with the device token, and posts to `chat/send` for a chat the person picked (`beebox/docs/mobile-contract.md:1284`, row S3). It is precedent for native HTTP and auth. It is not precedent for server routing, a new-chat reservation, or an outbox; those are new in this plan.
- Principle 4, "Resilient AND never silent". A routing failure today ends with "Your message has not been sent." The new operation stores the thought and asks.
- Principle 8, "One way to do each thing". Delivery reuses the send route's own body. It does not add a third delivery implementation beside the route and `deliverUserMessage`.
- Principle 13, "A control shows the state the system is in". The box screen shows stored-not-sent, sending, sent, and not-delivered as different faces.

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
- `beebox/src/core/chat/session/recent-landmark.ts:18`: `listRecentLandmarkChats(boxRoot, options?: { limit?: number; now?: number })`. **Reuse** for the box screen's recent chats.
- `beebox/src/frontend/src/components/AppNav/PlacePill-panels.tsx:292`: `<MenuItem id="bbx-switch-menu-box" onClick={onOpenBoxPanel} keepOpen>`. The box row opens a second panel (lines 338 to 352) with Dashboard, Browse, History, Storage summary, and "Other boxes →". **Change** the row to open the box screen; **delete** the panel.
- `PlacePill-panels.tsx:298`: `All landmarks →` links to the landmarks page. Lines 300 to 306 are the "Recent files ›" row; the chat portals its body through `AppBarRecentFilesSlot` (`components/app-bar-chrome.tsx:242`). `NavCardRows` (line 230) renders the box's `nav.card` entries. The landmark filter appears only past 20 landmarks (line 310: `landmarks.length > 20`). **Change** each as track 3 says.
- `beebox/src/frontend/src/components/AppNav/PlacePill-here.tsx:124`: the folder menu has "Open <dir>/", "Search" (line 127, the box's search page), "Landmark card" (line 130), then the landmark's links. **Delete** the Landmark card row; **add** Recent files.
- `beebox/src/frontend/src/components/landmarks/LandmarksList.tsx:11`: "Order and nesting come from `list` (root first, then lexicographic by dir, depth-indented) — the page is the box's MAP". It has no search. **Extend** with a filter field.
- `beebox/src/frontend/src/components/AppNav/nav.tsx:91`: the avatar menu has Settings, Admin, Publications, Source View, Debug Log, Reload, Sign out. **Unchanged.**
- `beebox/src/webapp/trpc/routers/nav.ts:12`: `get: publicProcedure.query(...)` returns the resolved `nav.card`. **Reuse** on the box screen.
- `beebox/src/frontend/src/components/BoxSelectionTiles.tsx:75`: `to={href(`/${box.slug}/quick-chat`)}` under the label "Quick chat". **Change** the target to the box screen.
- `ios-app/BeeBox/Views/ChatWebView.swift:506`: `decidePolicyFor navigationAction` already decides every main-frame navigation and cancels those outside the box's origin. **Reuse** to catch the navigation to `/<box>/box`.
- `ios-app/BeeBox/Views/ChatWebView.swift:90`: `struct NavigationRequest` carries a path for the web view to open; notification taps use it (`RootView.swift:293`). **Reuse** to open a box-wide page from the native box screen.
- `ios-app/BeeBox/Views/ComposerActionsView.swift:84`: `Section("Boxes")` lists paired boxes and calls `store.select(box)`. **Move** the list to the box screen; reuse the selection call.
- `beebox/src/webapp/server-box-scope.ts:302`: a paired device's bearer token passes `authedProcedure` (`mobileOk`). The share extension calls `share.destinations` and `share.saveTextual` this way. **Reuse**; no new auth.
- `ios-app/BeeBox/Views/RootView.swift:306`: `ChatWebView(` is constructed whenever a box is selected. `ChatWebView.swift:219` creates a new `WKWebView` in `makeUIView` and line 224 loads it. **Change**: construct it only when a chat is shown.
- `ios-app/BeeBox/Views/RootView.swift:439`: `showingQuickChat = true`, and the `QuickChatSheet` struct near line 797. **Delete**; the landmark menu's box row replaces them.
- `ios-app/BeeBox/Views/NativeComposerView.swift:1006`: `private func enqueueMessage(`. It hands the message to `pendingStore.enqueue(...)` with a conversation binding. `NativeComposerFixtureScreen.swift:69` already hosts the composer with no web view. **Reuse** the composer; add one submit seam.
- `ios-app/BeeBox/Storage/PendingEmissionStore.swift`: holds emissions until the web client returns a receipt, scoped to one composer binding. **Not reused** for the box screen; its states are web receipts.
- `ios-app/BeeBox/Services/SpeechDictation.swift:162`: on-device dictation with no session or web dependency. `ChatAPI.transcribeAudio` resolves a session through `chat/default` and needs no web view. **Reuse** both.
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
- **Box screen**: the screen for one box as a whole. It shows unfinished quick chat messages, recent chats, the composer for a new thought, the box-wide pages, the box's shortcut links, and the other boxes when there is more than one. One per platform: native on iOS, a page at `/<box>/box` on web. NOT a chat and NOT bound to a session.
- **Box-wide page**: Dashboard, Browse, History, or Storage summary. Settings, Admin, and Publications are also box-wide and stay in the avatar menu by the boxholder's decision.
- **Landmark menu** (exists: the place pill's left half, the "switch menu"): where the conversation is and where it can move. **Folder menu** (exists: the pill's right half, the "here menu"): the current landmark's directory and what is in it.
- **New-thought draft**: the text being typed on the box screen. Separate from the chat composer's draft on both platforms.
- **Outbox** (exists nowhere today; iOS only): quick chat messages the phone has not yet handed to the server. Identified by the same UUID. An outbox entry is removed when the server returns a record for its id.

## Tracks / scope

### 1. Server: one submit operation

**What.** `quickChat.submit` stores, routes, and delivers in one request. `quickChat.choose` fixes a destination for a stored message and delivers. `quickChat.discard` ends one. `quickChat.home` returns what the box screen shows.

**Why this needs to change.** The page-driven two-step send loses a message when the caller stops between steps (`QuickChatPage.tsx:76`). A native screen, a share extension, or an App Intent cannot stay open through routing and a chat send.

**Direction.**

```ts
submit: { id: uuid, message: string(1..12000), channel?: string } -> QuickChatView
choose: { id: uuid, candidateId: string, channel?: string } -> QuickChatView
discard: { id: uuid } -> QuickChatView
home:   {} -> { open: QuickChatView[], recentlySent: QuickChatView[], recentChats: RecentLandmarkChat[],
                shortcuts: { label: string, to: string }[] }   // the box's nav.card entries, from resolveNav

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

**Delivery.** Extract the body of the `POST /api/chat/send` handler, from sender attribution through the queued-or-started outcome, into a factory beside the route:

```ts
createUserMessageSender(deps: {
  boxRoot; eventBus; registry; scheduleManager; wireSession;
  processedMessageIds: Map<string, number>; inFlightSends: InFlightSends;
}): (args: { target; message; messageId?; user: SessionUser | null; channel; images?; cardFields? }) => Promise<SendOutcome>
```

The route's state is route-local today: `send-routes.ts:57` reads `processedMessageIds` from `ChatRoutesContext` and line 60 creates `inFlightSends` inside `registerChatSendRoutes`. The tRPC context has neither. So `routes/chat/register.ts` creates the sender once, next to `setChatRuntime(boxRoot, {` (line 202), passes it to `registerChatSendRoutes`, and adds it to `ChatRuntime` (`webapp/chat-runtime.ts:17`) as `sendUserMessage`. The route and `quickChat` then share one dedup map and one in-flight table. The route keeps what belongs to HTTP: body parsing, image validation, target resolution with its reply codes, and identity from the request. `quickChat` reaches the sender through `getChatRuntime(ctx.boxRoot)`, as it reaches the registry today, and calls it with `messageId = record.id`, the caller's identity (`ctx.user`, which a paired device fills from `createdBy`), and the `channel` input, resolved by the same `resolveChannel` the route uses (`send-routes.ts:166`). The phone sends `"ios-native"`, as the share extension does (`mobile-contract.md:1284`). A `CHAT_SESSION_UNAVAILABLE` result moves the record to `needs-choice` with `reason: "destination-gone"`. Any other failure leaves it `sending` with `lastError`.

A duplicate answer carries no outcome. `send-dedup.ts:158` answers a durable duplicate with `{ deduplicated: true }` only: no turn id, no queued flag, no assigned session. So the record must hold the destination before delivery starts. The `sending` record stores the destination label and the session id when one exists (an existing chat, or a reserved id). When a repeated delivery is answered as a duplicate, the record becomes `sent` with that stored destination and without `queued`. A new chat on a non-Claude engine has no stored session id; its row offers "All chats".

Duplicate protection ends when the message-id claim expires (`send-dedup.ts:24`, 7 days). A `sending` record stores `deliveryStartedAt` at its first attempt. A delivery attempt more than 6 days after that is refused: the row says "This may already be in <label>. Open the chat to check." and offers Open chat and Discard only.

**Record storage.** Records in `needs-choice` or `sending` live in `.beebox/quick-chat/open/<id>.json`. A record moves to `.beebox/quick-chat/<id>.json` when it becomes `sent` or `discarded`. `home` lists the `open/` directory, so its cost does not grow with history, and an unfinished message never ages out of view. The lock path does not move with the record: every procedure locks `.beebox/quick-chat/<id>.json.lock`, whatever the state. The record gains `sentAt` and `discardedAt`. `recentlySent` is the records whose `sentAt` is in the last 24 hours, at most five; `home` finds them by reading the newest closed records by file time and filtering on `sentAt`. Existing records have no `state`; the reader treats a record with a `receipt` as `sent` and one without as `sending`.

**Vocabulary lock-ins.** The four state names, the three reasons, the procedure names, and the `open/` directory.

**First implementation chunk.** `routingDisposition` with a doctest table: the ten rows above, an exact tie, a single candidate, a selected candidate with no landmark, and a floor of 1. Then the record schema with `state` and the old-record reader, with doctests for each state and for a record written before this change.

### 2. Web: the box screen

**What.** A page at `/<box>/box` replaces `/<box>/quick-chat`. It is the web box screen.

**Why.** The Quick chat page owns a send it cannot guarantee, restages sent text, and overwrites the composer draft. Box-wide navigation is spread over a two-level menu panel.

**Direction.** The page calls `home` on load. Top to bottom:

1. "Needs you": stored messages in `needs-choice` or `sending`. Absent when empty.
2. "Pick up where you left off": `recentChats`, the first one styled as the primary action.
3. "In this box": Dashboard, Browse, History, Storage summary as one row of links, then the `shortcuts`.
4. "Boxes": the other boxes, from the query the box selector page uses. Absent with one box.
5. The input, pinned at the bottom, with the line "New thought. The box picks the conversation."

Send generates an id, keeps `{id, message}` in browser storage under a key of its own until `submit` answers, and retries `submit` with the same id on reload. The key is not the chat composer's draft key, so neither draft can replace the other. The input clears when the server answers; the answer appears as a row under "Needs you" or as a sent row.

- `sent`: "Sent to <label>" and an "Open chat" link that only navigates.
- `needs-choice`: the reason in words ("Not sure where this goes", "Could not sort this", "That chat is gone"), the choices as buttons, and Discard.
- `sending` with `lastError`: "Not delivered", with Retry and Discard.

The percentages, the "Jev's top choices" block, the staged-text correction links, and the read-only textarea state are removed. `/<box>/quick-chat` redirects to `/<box>/box`. The box selector tile's second link points to the box screen and reads "New thought". **The page must not mount the chat.** `ProductLayout` mounts `BoxConversationShell` for every route except one: `main/app-shell.tsx:116` has `const standalonePage = location.pathname.endsWith("/publications");` and line 132 has `{standalonePage ? null : <BoxConversationShell />}<Outlet />`. Today's `/quick-chat` page is an ordinary child, so it mounts the conversation shell and loads chat state. The box screen route is added to that exception by route identity, not by a path suffix, and a frontend test renders the route and fails if `BoxConversationShell` mounts or any `chat.*` query other than `quickChat.home` runs. The app bar stays; its pill runs one light identity query at rest (`PlacePill.tsx:17`).

**First implementation chunk.** The page state as a pure reducer over `home` data and `submit`/`choose` results, with a doctest for each row face and for reload with a stored unsent message.

### 3. Web: app bar menus

**What.** The landmark menu, the folder menu, and the landmarks page change so that each has one job.

**Why.** Box-wide pages are in three places. The box row opens a panel two taps deep. Recent files belong to the directory the chat works in and sit in the landmark menu.

**Direction.**

| Control | Before | After |
|---|---|---|
| Landmark menu | Box row (opens a panel), All landmarks, Recent files, the box's shortcut links, the switch list with a filter past 20, the problems row | Box row (opens the box screen), "Find a landmark", the switch list with the same filter, the problems row |
| Folder menu | Open directory, Search, Landmark card, the landmark's links | Open directory, Search, Recent files, the landmark's links |
| Landmarks page | The hierarchy | A filter field above the hierarchy. Empty shows the hierarchy. Text shows matching landmarks in the same indented form |
| Avatar menu | Settings, Admin, Publications, device items | Unchanged |

- The box row is a plain document navigation to the box screen, not a router link: `href={withBase(`/${boxSlug}/box`)}`, the form "Other boxes →" uses today (`PlacePill-panels.tsx:352`: `href={withBase("/")}`). `withBase` keeps the server prefix; the app is served under one (`api-core.ts:33`). In a browser it loads the web box screen. In the native shell the app intercepts it; see track 4. No bridge command is added: the command envelope cannot report an unknown kind back to the web (`mobile-contract.md:642`), so a command would fail silently on an older build.
- "Find a landmark" replaces "All landmarks →" and opens the landmarks page. The page is the landmarks system card rendered by `LandmarksList`, which has no filter or focus state today (`LandmarksList.tsx:61`). `LandmarksList` gains local filter state and a field at the top of the list. No parameter is passed and the field is not focused on arrival, so the keyboard does not cover the hierarchy on a phone.
- "Search" in the folder menu stays the box's search page. Landmark search and file search stay separate, by the boxholder's decision.
- The Recent files row moves to the folder menu with its sub-panel. The chat still supplies the body through the same slot (`AppBarRecentFilesSlot`); only the slot's host changes. The folder half renders only when a landmark resolves for the directory (`PlacePill.tsx:11`: "Rendered only when a landmark actually resolves for the place's directory"). The boxholder accepts this: "Chat folders pretty much always have landmarks."
- `NavCardRows`, the box panel (`case "box"`), `onOpenBoxPanel`, and `webBoxSwitchingAvailable` are deleted.

**Vocabulary lock-ins.** The route `/<box>/box`. The row label "Find a landmark".

**First implementation chunk.** The landmarks page filter as a pure function over the `landmarks.list` rows that keeps each match's ancestors for indentation, with a doctest table. Then the menu rows.

### 4. iOS: box screen, outbox, launch rule

**What.** A native `BoxScreenView`, a `QuickChatOutbox`, a rule for when the box screen shows, and the interception of the web navigation to the box screen.

**Why.** The app constructs the web chat for every launch (`RootView.swift:306`), so the composer is usable only after the last conversation loads, and its message goes to that conversation.

**Direction.**

- **Root state.** `RootView` gains two pieces of state. `surface: .undecided | .boxScreen | .web` says what the person sees. `webMounted: Bool` says whether `ChatWebView` exists. `ChatWebView` is the whole web app, not only chat pages; the native composer below it stays as it is whenever `surface` is `.web`.
  - Cold launch: `.boxScreen`, `webMounted == false`. No web view is created and nothing loads.
  - First move to `.web` (a recent chat, a box-wide page, a notification tap): `webMounted` becomes true and the web view loads its target.
  - Back to the box screen from the web app: `.boxScreen`, `webMounted` stays true. The web view is hidden, not destroyed, so returning is immediate.
  - The launch rule's 30-minute return, a box switch, or the end of the web content process sets `webMounted` to false.
- **Launch rule.** A cold launch goes to `.boxScreen`. On return to the foreground, the app goes to `.boxScreen` when it was in the background for 30 minutes or more, or when the web content process ended while in the background. Otherwise it stays where it was. A notification tap goes to its target directly (`openNotificationTap`, `RootView.swift:251`); it sets `.web` and `webMounted` before it sets `navigationRequest`, because `ChatWebView` must exist to consume the request. The app records the background time in memory; a killed app is a cold launch. `ChatWebView` reloads itself when its content process ends and tells nobody (`ChatWebView.swift:491`), so it gains an `onWebContentTerminated` callback that `RootView` records for the rule.
- **Pending chat messages come first.** Messages already sent from the chat composer wait in `PendingEmissionStore` and are delivered only through a mounted `ChatWebView` (`RootView.swift:306` passes `pendingEmissions: pendingEmissionStore.deliveries`). If the selected box has pending emissions, the app opens on `.web` for their conversation, whatever the other inputs say.
- **The rule waits for the restore.** `PendingEmissionStore` loads its entries asynchronously when the box is activated (`RootView.swift:143`, `.task(id: store.selectedBox?.id)`). The surface stays `.undecided`, drawing only the background, until that activation returns. Then the rule runs once with `hasPendingEmissions` known. The restore reads local storage only.
- **Box screen content, top to bottom.** "Needs you": outbox entries not yet accepted, then the server's `open` list. Then sent rows for this app session's submissions. Then "Pick up where you left off": `recentChats`, the first one styled as the primary action, and "All chats", which opens the web chat list. Then "In this box": Dashboard, Browse, History, Storage, and the `shortcuts`; each sets `.web` and issues a `NavigationRequest` for its path, as a notification tap does. Then "Boxes", only with two or more paired boxes. The composer is pinned at the bottom with the line "New thought. The box picks the conversation."
- **Loading.** The box screen draws at once from the outbox and a cached copy of the last `home` answer for the box, then refreshes. The composer does not wait for the refresh.
- **Composer seam.** `NativeComposerView` gains `submitTarget: .conversation | .quickChat((String) -> Void)`. This is more than one call site. The composer reaches `pendingStore.enqueue(...)` from `enqueueMessage` (line 1006) and from a second site near line 825 that captures its own binding, and the binding guard "Choose a conversation before sending." appears at lines 723, 772, 827, 903, 1015, and 1274. The change routes every send through one private function that switches on `submitTarget`. For `.quickChat` it calls the closure with the final text and clears the draft; it never touches `PendingEmissionStore` and never checks a binding. The box screen hosts the composer with `captureAvailable: false`. For `.quickChat` the composer hides the "+" button, the screenshot action, and location sharing, and turns off spoken send keywords and high-quality transcription. Dictation on the box screen is on-device (`SpeechDictation`) and fills the text field; the person sends with the Send button.
- **Two drafts.** `RootView` owns one `ComposerDraftStore` today (`RootView.swift:8`), and the composer binds its text to it. The store has no storage namespace: it activates by box id against one repository load path (`ComposerDraftStore.swift:36`), so two instances would read and write the same draft. `ComposerDraftStore` and its repository calls gain a `scope` parameter (`.conversation` or `.newThought`) that is part of the storage key. The box screen gets a second instance with `.newThought`. A half-typed chat message stays with the chat; a half-typed new thought stays with the box screen.
- **Outbox.** `QuickChatOutbox` persists `{id, boxID, text, createdAt, attempts, lastAttemptAt}` in the app's repository. Submitting adds an entry and starts `submit`. Success removes the entry and shows the returned view. A network failure keeps the entry; the app retries with backoff while it is in the foreground and once on each launch. After 7 days without success the entry stops retrying and shows "Not sent" with Retry and Discard. An outbox entry has no server record, so nothing was delivered and a late Retry cannot post twice.
- **Result rows.** The same three faces as the web page. Choosing a destination calls `choose`. "Open chat" sets `.web` with that session.
- **The way back.** The web landmark menu's box row navigates to `/<box>/box`. `decidePolicyFor` compares the URL with `box.baseURL` plus `/box`, not with the origin alone, because the box lives under a path prefix. The check runs before the existing same-origin allow (`ChatWebView.swift:517`), cancels the navigation, and sets `.boxScreen`. A `ChatWebViewRequestTests` case uses a prefixed base URL such as `http://127.0.0.1:3210/main/test1` and proves `/main/test1/box` is intercepted and `/main/test1/browse` is not. An older build does not recognize it and loads the web box screen in the web view, which works without the native bridge.
- **Removed.** The "Quick chat" button above the composer, `QuickChatSheet`, `showingQuickChat`, `ChatWebView`'s `.quickChat` page, and `Section("Boxes")` in the "+" menu.
- **Box switch and lock.** Selecting a box reloads the box screen for that box. A locked box shows `LockedBoxView` over the box screen, as it does over chat today. `obstructedNativeSurface` (`RootView.swift:580`) gains a case for the box screen.
- **Native API.** `QuickChatAPI` with `submit`, `choose`, `discard`, `home`, using `BoxRequest.apply` for the bearer token, in the pattern of `ShareExtensionAPI`.
- **Contract.** `mobile-contract.md` gains a section 5 entry for the four procedures and a section 3 entry for the intercepted `/<box>/box` navigation, with shared fixtures for the procedures under `beebox/test/mobile-contract/fixtures/`. The "Quick chat evaluation entry" section is replaced. `ios-app/CLAUDE.md:160` gains the stated exception.

**Vocabulary lock-ins.** `surface`, `submitTarget`, `QuickChatOutbox`, `BoxScreenView`.

**First implementation chunk.** The launch rule as a pure function `initialSurface(coldLaunch:, backgroundedFor:, webContentAlive:, notificationTap:, hasPendingEmissions:)` with XCTest cases for each input, and the `surface`/`webMounted` transitions as a second pure function with a case for each bullet above. Then `QuickChatOutbox` with tests for add, accept, network failure, the 7-day stop, and restart.

## Could this be simpler?

The simplest version that could work: keep the web page, fix its two staging bugs, and add an iOS cold-start rule that opens the existing web sheet first. It fails on the stated goal. The sheet is a web view, so the person still waits for web content, has no native dictation, and the two-step send still loses messages. Principle 4 rules out keeping the lossy send.

A version without track 3 keeps the menus as they are and adds one "Box screen" row. It is about 350 lines smaller. It leaves box-wide pages in the panel and on the box screen at once, two ways to do one thing (principle 8), and it ignores the boxholder's menu decisions.

A version that drops `needs-choice` and always posts, as today, is about 300 lines smaller. The boxholder asked for options at low confidence, and the samples show debatable matches near 0.85 that would post to a wrong chat with no undo.

A version that reuses `deliverUserMessage` and skips the send-route extraction is about 150 lines smaller. It gives a typed thought no sender, no message-id claim, and the `clientComposed` flag meant for wrappers. Fixing those inside `deliverUserMessage` rebuilds the route body a third time (principle 8).

The outbox could be dropped by making the composer wait for the server. Then a thought typed with no signal is lost when the app closes. That is the case the box screen exists for.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Jev key missing, timeout, or malformed answer | Planned router doctest with the fake service | Record stored as `needs-choice`, `routing-unavailable` | Clear |
| Catalog cannot be built (invalid rubric, more than 255 candidates) | Planned router doctest | Stored as `needs-choice` with "New general chat" only | Clear |
| Server stops after writing `sending` and before delivery | Planned router doctest that re-submits the id | Record stays in `open/`; the box screen shows "Not delivered"; a repeat `submit` or Retry delivers | Clear |
| Server stops after delivery and before writing `sent` | Planned doctest: second delivery with the same message id | The message-id claim answers the second attempt as a duplicate; the record becomes `sent` with the destination it stored before delivery. Whether the message was queued is not recovered | Clear |
| Retry of a `sending` record after the message-id claim expired | Planned router doctest with a late clock | Refused past 6 days; the row sends the person to the chat to check | Clear |
| Chosen chat deleted between routing and delivery | Planned router doctest | `needs-choice`, `destination-gone` | Clear |
| Chosen chat is busy | Existing send-route queue test; planned view test | `sent` with `queued`; the row says "Queued in" | Clear |
| Server restarts while the message waits in a busy chat's queue | No | No. The queue is memory only (`run/core.ts:61`: `private messageQueue: ChatSendInput[] = []`) | The record says `sent`; the agent may never run it. Existing behavior of every queued send. Documented risk, see NOT in scope |
| New chat on a non-Claude engine has no session id yet | Planned router doctest | `sent` without a session id; the row offers "All chats", not "Open chat" | Clear |
| Phone has no signal at submit | Planned outbox XCTest | Entry stays in the outbox and retries; row shows "Waiting to send" | Clear |
| Outbox entry never succeeds | Planned outbox XCTest | Stops at 7 days; "Not sent" with Retry and Discard | Clear |
| `submit` succeeded and the response was lost | Planned outbox XCTest and router doctest | Retry with the same id returns the stored record | Clear |
| Person submits to box A, then switches to box B | Planned outbox XCTest | Entries carry `boxID`; each is sent to its own box | Clear |
| App opens while a chat message is still undelivered | Planned launch-rule XCTest, with the restore pending and complete | The surface waits for the restore; pending emissions force `.web` | Clear |
| The box screen's cached list is stale | Planned `BoxScreenView` fixture | Refresh replaces it; a failed refresh shows "Could not refresh" above the list | Clear |
| Web content process ends in the background | Planned launch-rule XCTest | Return goes to the box screen | Clear |
| An older iOS build meets the navigation to `/<box>/box` | Planned `ChatWebViewRequestTests` case for the interception; the web page test covers the fallback | The older build loads the web box screen in its web view | Clear |
| A chat's directory has no landmark | No | The folder half is absent (`PlacePill.tsx:234`), so Recent files is unreachable for that chat. Today the row shows for every chat (`ChatBarChrome.tsx:108`) | Silent. The boxholder answered this exact case with "Chat folders pretty much always have landmarks". Confirm at approval; the fallback is to keep the row in the landmark menu only when the folder half is absent |
| Confident post lands in the wrong chat | No test can cover routing quality | No undo. The row names the chat and links to it. The person corrects it in that chat | Clear, not recoverable. Accepted for this version |

No critical gap: every new codepath has a planned test and a visible state, except the two rows marked accepted.

## Agent-flow / user-flow edge cases

- Wrong destination: ADDRESSED in part. Uncertain messages ask. A confident wrong post is visible and not reversible (Failure modes, last row).
- Stale ref: ADDRESSED. `destination-gone` at delivery; `choose` validates the candidate against the stored record.
- Two actors on one record: ADDRESSED. All four procedures take one per-id file lock (`quick-chat.ts:47`, `withFileLock`). A second `choose` on a `sent` record returns the record unchanged.
- Hand-edit drift: ADDRESSED by the existing rubric validation; a bad rubric now stores and asks. An invalid `nav.card` yields no shortcuts, as it yields no menu rows today.
- Fabricated value: ADDRESSED. `choose` accepts only a `candidateId` present in the record.
- Validation error UX: ADDRESSED. Each `reason` and `lastError` has a fixed sentence on both platforms.
- Partial transition: ADDRESSED. Old records read as `sent` or `sending`. An old iOS build still opens `/quick-chat` in its sheet and is redirected to the web box screen, which works without the native bridge. `prepare` and `receipt` are removed in the same change as their only caller.
- A draft crossing surfaces: ADDRESSED. The new-thought draft and the chat draft are separate stores on both platforms.
- The agent's knowledge of the menus: DEFERRED to Knowledge audits. A box agent that tells the person where a page is must name the new place.

## NOT in scope

- Siri, Shortcuts, the Action Button, a widget, and a Control Center control: they call `quickChat.submit` later. Their own questions are in `issues/features/2026-08-08-ios-siri-app-intent-capture.md`.
- The share extension: it keeps its picker. Giving it an automatic destination is a small follow-up once `submit` exists.
- Photos, files, and capture from the box screen: routing judges text only, and uploaded files under `_tmp/` are swept (`uploads.ts:17`). A photo thought needs its own storage rule.
- High-quality transcription on the box screen: `ChatAPI.transcribeAudio` resolves a chat session first (`ChatAPI.swift:110`), and the setting is reported by the web chat.
- A notification for an unplaced thought: it needs a new notification target for the box screen on both platforms. The box screen shows the thought on the next open.
- Undo or move after a confident post: the first chat's agent has already acted.
- A hold before a confident post: the boxholder's words were "directly post if it's high confidence".
- Calibrating the post floor: needs real records. The constant is provisional.
- Making the busy-chat queue survive a restart: a property of every chat send, not of this plan.
- Preloading the last chat's web view behind the box screen.
- Merging landmark search and file search: the boxholder uses them differently.
- Moving Settings, Admin, or Publications: they stay in the avatar menu.
- The web box selector page: it stays as the multi-box front page.
- Making the web index route open the box screen: `/<box>/` keeps its redirect to the chat.
- Telegram, jobs, and inbox destinations: unchanged from `chat-routing.md`.

## Open design questions

- **Names the boxholder has not chosen.** The route `/<box>/box`, the box selector tile's label "New thought", the menu row "Find a landmark", the composer line "New thought. The box picks the conversation.", and the section headings "Needs you", "Pick up where you left off", and "In this box". The mockups used most of them. Lean: keep them; each is one string.
- **One landing or two.** Tracks 1 to 3 are web and server and deploy on merge. Track 4 holds most of the risk: the composer seam, the outbox, and the launch rule. Lean: approve the whole plan, build in the listed order, and let the boxholder land tracks 1 to 3 early if track 4 runs long.
- **Storage summary on the box screen.** It is one of four box-wide pages and may be rarely used. Lean: keep it in the row.
- **Web index route.** Opening `/<box>/` could show the box screen, as the phone's cold launch does. Lean: no; a browser tab is usually opened to continue a chat.

## Knowledge audits

The routing rubric concept is unchanged and is covered by the existing audit from `chat-routing`. `beebox/docs/box/quick-chat.md` gains one sentence: an uncertain thought waits for the person. Re-run the existing rubric audit after that edit.

The agent-facing navigation description changes: where Dashboard, Browse, History, Storage summary, Recent files, and the landmark list are reached. Search the box-loaded guidance for those menu names during implementation. If any names a moved item, update it and add one `knows_directly` audit entry for "where the person finds the box-wide pages", and run it against the test box.

## What will hold this after it ships

- Pure doctests: `routingDisposition`, the record reader, the box screen reducer, the landmarks filter.
- Router doctests with the fake Jev service (`createFakeJev`, `jev.ts:135`) and the caller pattern in `test/webapp/trpc/routers/quick-chat.doctest.md`: every row of the failure table that names one.
- Send-route doctests, unchanged, cover the route after the extraction. They do not cover the shared state, so one new doctest sends the same message id through `POST /api/chat/send` and through `quickChat.submit` against one runtime, in both orders, and expects one chat message.
- Mobile-contract fixtures for the four procedures, parsed by both the Swift and TypeScript sides, and a `ChatWebViewRequestTests` case for the intercepted navigation.
- XCTest: `initialSurface`, `QuickChatOutbox`, `QuickChatAPI` request shapes, the two draft stores.
- A DEBUG `--box-screen-fixture=<state>` launch argument, in the pattern of `--composer-fixture=`, for simulator screenshots of each face.
- A browser walk of the three menus and the box screen at phone and desktop widths, recorded as an exhibit.
- Not covered by automation: dictation on the box screen on a physical phone, and routing quality.

## Implementation order

1. `routingDisposition` and the record schema with states (track 1, first chunk).
2. Extract `createUserMessageSender` from the send route. No behavior change; the existing route tests pass.
3. `submit`, `choose`, `discard`, `home`; remove `prepare` and `receipt`.
4. The web box screen (track 2) and the `/quick-chat` redirect.
5. The landmarks page filter, then the landmark and folder menus (track 3).
6. Mobile-contract fixtures, `QuickChatAPI`, and the navigation interception.
7. `initialSurface`, `QuickChatOutbox`, the second draft store.
8. `BoxScreenView`, the composer seam; remove the button, the sheet, and the "+" menu's box list.
9. Docs: `docs/chat/quick-chat.md`, `docs/box/quick-chat.md`, the landmarks and navigation references, `mobile-contract.md`, `ios-app/CLAUDE.md`, security report section 3.
10. Browser walk against the test box. Simulator walk with fixtures and against the test box. The test box needs an `openrouter` grant for the sorted path; without one, the walk covers the `routing-unavailable` path only.

## Rollout shape

Done when the doctests and XCTests named above pass, `pnpm test:changed` and `pnpm lint:changed` pass, the mobile-contract check passes, and the browser and simulator walks are recorded as an exhibit. Record shape changes are read-compatible; no migration runs. The server and web parts deploy on merge. The iOS part reaches the phone with the next build the boxholder installs; an older build keeps working through the web box screen. A physical-phone check of dictation on the box screen and of the launch rule is manual testing for the boxholder.
