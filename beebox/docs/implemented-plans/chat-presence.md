---
title: "Chat presence: show who else has this chat open"
status: implemented
workstream: chat-presence
issues:
  - ../../../issues/closed/features/2026-11-11-chat-shows-who-is-present-and-typing.md
---
# Chat presence: show who else has this chat open

When two box members have the same chat open, each sees the other's head
under the profile menu. A server-side room per chat holds who is there; one
WebSocket subscription per open chat is both the "I am here" signal and the
feed of who else is. Typing and speaking indicators, and voice/video calls,
come later on the same subscription.

**Issues addressed:** `issues/features/2026-11-11-chat-shows-who-is-present-and-typing.md`
(presence half; the typing/speaking half stays open on that issue, see *NOT in
scope*). Related, not closed: `2026-11-11-voice-and-video-calls-in-a-shared-chat.md`
(builds on this), `2026-09-28-private-chat-sessions-search-gating.md` (decides
who may see a chat; see *Failure modes*). Searched the queue for `presence`,
`who is here`, `typing`, `avatar`: no duplicates.

## Design

### Situations

- When Priya opens the dinner-planning chat on her laptop and Tomas already
  has it open on his phone, I want Priya to see Tomas's head by the profile
  menu, so she knows he will see what she writes now, not later.
- When Tomas is reading along while Priya talks to the box, I want him to
  stay visible to her without doing anything, so being there is enough.
- When Priya switches to another tab or Tomas puts his phone down, I want
  their head to go away within seconds, so a head means "here now", not
  "was here this morning".
- When Odette has the box to herself, I want nothing to change, so a
  one-person box carries no empty "nobody here" decoration.
- When Priya opens a chat to think something through alone, she does not
  want to announce herself to everyone in the box. Presence is shown only to
  people who have the *same* chat open, so opening a chat tells nobody
  outside it.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Two people in one chat | Show | Small heads (avatars) stacked just below the profile avatar, while the chat's transcript is on screen | Background; no sound, no animation beyond a short fade |
| Someone leaves | Show (the head goes) | Same place | Background |
| Alone | Quiet | Nothing rendered | None |
| More than two others | Show two heads and a `+N` disc | Same place; the disc's accessible label and desktop tooltip list the names | Background |
| Different chats | Quiet | Nothing | None |

The heads sit under the profile avatar because the bar is the one place
present on every page. The chat runtime is mounted on every page
(`BoxConversationShell`), but a person counts as present only while the
chat's transcript is on screen (`workspace.transcriptVisible`), so a person
reading a card full-screen is not "in" the chat.

### Spirit

- **Serves:** *It should feel like a place* — a shared chat with other
  people visibly in it feels like a room, not a log.
- **Risks:** *People aren't broken versions of their better selves* — presence
  can become surveillance ("why weren't you looking at it?"). Guard: nothing
  is stored, there is no "last seen", and a person outside the chat learns
  nothing.

### Trust

Shows only, takes no action. The box agent does not see presence in this
round.

### When it goes wrong or does nothing

- A dropped connection: the server drops the subscription within about 35
  seconds (WebSocket keep-alive, `server-box-scope.ts:258`), and the head
  goes. The person's own reconnect re-joins without anything for them to do.
- A person with no name on record shows the first letter of their email; the
  tooltip shows the email.
- The subscription fails: no heads show, which looks the same as being alone.
  The failure goes to the console (`[chat-presence]`). This is acceptable
  because presence is a courtesy; nothing a person does depends on it.

### Walkthrough

Priya opens `/chat?session=S` on her laptop. `BoxConversationProvider`
resolves the current conversation to session `S`. The tab is visible, so the
heads component subscribes to `chatPresence.watch({ sessionId: S })`. The
server adds Priya's connection to room `S` of this box and sends her
`{ t: "others", people: [] }` — she is alone, nothing renders. Tomas opens the
same chat in the iOS app. His web view subscribes; the room now holds both.
The server sends Tomas `[Priya]` and sends Priya `[Tomas]`. Priya sees a "T"
head (or Tomas's initial) below her avatar; the tooltip says "Tomas Marlowe
is in this chat". Tomas locks his phone. The web view becomes hidden, the
component unsubscribes, the server removes him and sends Priya `[]`; the head
fades out. Nothing is written to disk.

## Smallest fix and budget

Smallest fix that meets the request: a per-chat in-memory room on the server,
one tRPC subscription, one hook, one component in the app bar. No new storage,
no bridge change, no iOS change.

Estimate (additions plus deletions):

- Core room (`core/chat/presence/`): ~130 lines.
- tRPC router + registration: ~60 lines.
- Frontend hook + heads component + `AppNav` placement: ~150 lines.
- Tests: ~250 lines (room unit tests, router-level subscription test, a
  component test for the face).
- Docs: a short reference section (`docs/chat-presence.md`, ~40 lines) and a
  note in `docs/mobile-contract.md` that presence rides web visibility (~5).

Total ~640 lines. Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Bias toward strict** (boxholder memory): the server, not the client,
  decides who a subscriber is (`ctx.user`), and the client never asserts an
  identity or a picture URL. Cost: no profile pictures for other people in
  this round (see *NOT in scope*).
- **Minimal concepts, prefer primitives** (boxholder memory): presence is the
  lifetime of a subscription. There is no heartbeat, TTL, or "present" flag
  to keep in step; the WebSocket keep-alive that already exists bounds a dead
  connection.
- **`engineering-principles.md` — one source of truth**: the room is the only
  record. It is never written to disk, so there is no file to drift.
- **Precedent:** the per-box presence registry (`core/notification/presence-registry/core.ts`)
  is in-memory and keyed by `boxRoot`, one server process per box. This plan
  uses the same assumption.

## What already exists

- **Per-box presence** — `src/webapp/trpc/routers/presence.ts:22`:
  *"heartbeat: authedProcedure .input(z.object({ sessionId: … }))"*, driven by
  `frontend/src/hooks/usePresenceHeartbeat.ts`, which sends only *"While the
  tab is visible and the person has interacted in the last two minutes"*. It
  records tab ids, not people or chats, and feeds notification decisions.
  **Not reused**: different question (is anyone using the box), different
  semantics (interaction-gated), and it writes a file for other processes.
  Left unchanged.
- **WebSocket subscriptions** — `events.ts:61` `subscribe: publicProcedure
  … .subscription(async function* (opts)`, with the abort-signal + queue +
  wake pattern this plan copies. The frontend uses
  `trpc.events.subscribe.useSubscription` (`hooks/useBusSubscription.ts:43`);
  `lib/trpc/client.ts:172` routes subscriptions over `wsLink`, which
  resubscribes on reconnect.
- **Dead-socket bound** — `server-box-scope.ts:258`: *"keepAlive: { enabled:
  true, pingMs: 30_000, pongWaitMs: 5_000 }"*.
- **Identity on the WebSocket** — `server-box-scope.ts:301-304`: *"A mobile
  device carries the identity of whoever paired it"*, `const user = email ?
  { email, name: identity.name ?? email } : null`. So `ctx.user` is the person
  for browser sessions and for the iOS web view alike. For a device, `name`
  is the email; `localUserName` (`webapp/auth.ts:325`) resolves a display
  name, as `resolveMobileSender` does (`routes/chat/helpers.ts:239`). Reused.
- **Current conversation** — `useBoxConversation()`
  (`components/chat/everywhere/conversation-context/context.tsx:28`);
  `BoxConversationShell/view.tsx:47` derives
  `const sessionId = target?.kind === "session" ? target.sessionId : null`.
  Reused.
- **Avatar** — `components/ui/Avatar.tsx`, initial fallback when there is no
  picture. Reused.
- **Profile button** — `components/app-bar-faces/ProfileButtonFace.tsx`, rendered
  last in `AppNav` (`AppNav/nav.tsx:166`). The heads hang below it.
- **iOS foreground** — the iOS app tracks `scenePhase` natively
  (`ios-app/BeeBox/Views/RootView.swift:205`) but publishes nothing about it
  to the web. The plan relies on the web view's own `document.visibilityState`
  plus the keep-alive bound; no bridge change.

## Prior art (external)

- WebKit sets a `WKWebView` page's visibility to hidden when its app moves to
  the background, so `visibilitychange` fires (Page Visibility API,
  https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event;
  WebKit applies view visibility to `document.visibilityState`). Evaluated-only;
  the design does not depend on it, because an app without a background mode
  is suspended a few seconds after backgrounding, and the keep-alive then
  drops its socket within ~35 seconds.
- Presence channels (Pusher, Phoenix Presence, Ably) model presence as
  membership of a per-room channel, deduped by user id across connections.
  Evaluated-only; the room shape here is the same idea at one-process scale.
  No CRDT-style cross-node merge is needed (one process per box).

## Ontology

- **Chat session** (exists): a conversation, identified by its `sessionId`
  (`ConversationSelection` target `{ kind: "session", sessionId }`). Presence
  attaches to it. Not a tab, not a transcript file.
- **Room** (new, in-memory): the set of watchers of one chat session in one
  box. Key: `(boxRoot, sessionId)`. Not stored; gone when empty.
- **Watcher** (new): one live `chatPresence.watch` subscription. Identified by
  a server-generated id. Carries the person (`email`, `name`) and when it
  joined. A person with two tabs is two watchers.
- **Person present** (new wire shape `PresentPerson`): `{ email, name }`,
  deduped from watchers by email, ordered by earliest join. Not a box
  member record; it is whoever authenticated.
- **Present** (decision): a watcher exists. The web client watches only while
  the chat is the current conversation, its transcript is on screen, and the
  page is active: in a browser, visible and focused
  (`document.hasFocus()`); in the iOS web view, visible (the native composer
  holds focus, so `hasFocus()` would drop people while they type).
- **Presence frame** (new wire union `ChatPresenceFrame`): today only
  `{ t: "others"; people: PresentPerson[] }` — everyone present except the
  subscriber. Later frames (typing, call signaling, ring) are added to this
  union.

## Tracks / scope

### Track 1 — server room and subscription

- **What:** `core/chat/presence/room.ts` with `createChatPresence()`, and a
  tRPC router `chatPresence` with one subscription, `watch`.
- **Why:** nothing on the server knows which person has which chat open.
- **Direction:**

  ```ts
  // core/chat/presence/room.ts
  export interface PresentPerson { email: string; name: string }
  export type ChatPresenceFrame = { t: "others"; people: PresentPerson[] };
  export interface ChatPresence {
    /** Join a room; `onChange` gets everyone else present on join and whenever that list changes. Returns leave(). */
    join(opts: { boxRoot: string; sessionId: string; person: PresentPerson;
                 onChange: (people: PresentPerson[]) => void }): () => void;
    /** Rooms with at least one watcher (tests). */
    size(): number;
  }
  /** Pure: dedupe by email, earliest join first, drop `selfEmail`. */
  export function othersFor(watchers: readonly Watcher[], selfEmail: string): PresentPerson[];
  ```

  `watch: authedProcedure.input(z.object({ sessionId: z.string().regex(/^[\w-]{8,64}$/) })).subscription(...)`
  — when `ctx.user` is null or `ctx.actor` is `agent` (the box's own browser
  or bearer), it yields `{ t: "others", people: [] }` and waits for abort
  without joining: the agent is not a person in the room. Otherwise it joins,
  yields an `others` frame on join and on each change to that list (the room
  skips sends that change nothing), and leaves in `finally`. tRPC's WebSocket
  adapter aborts the iterator when the client stops or the socket closes. Names: `ctx.user.name`
  unless it equals the email, then `localUserName(email) ?? email`.
- **Vocabulary lock-ins:** router name `chatPresence`, procedure `watch`,
  frame discriminant `t`, frame type `"others"`, `PresentPerson`.
- **First chunk:** `room.ts` + `room.test.ts` (join/leave/dedupe/order/self
  excluded/room removed when empty/one listener throwing does not stop the
  others).

### Track 2 — web client

- **What:** `hooks/useChatPresence.ts` and `components/AppNav/PresenceHeads.tsx`
  (container + pure `PresenceHeadsFace`).
- **Why:** the person has to see who is there.
- **Direction:** `useChatPresence(sessionId: string | null): PresentPerson[]`
  subscribes with `enabled: sessionId !== null && transcriptVisible && active`,
  where `active` tracks `visibilitychange`, `focus`, and `blur` (focus is
  ignored in the native shell, `isNativeShell()`). It returns the last frame's
  people only while the subscription status is `pending` (live); while
  `connecting` (the WebSocket is reconnecting), idle, or in error it returns
  `[]`, so a stale head never outlives the connection that reported it. `PresenceHeads` reads the current conversation from
  `useBoxConversation()` and renders `PresenceHeadsFace({ people })`.
  `PresenceHeadsFace` renders nothing for `[]`; otherwise a vertical stack of
  up to two `Avatar size="sm"` heads with a white ring, then a `+N` disc when
  more remain. Each head has `title="<name> is in this chat"`; the stack is a
  `role="list"` labelled "Also in this chat"; the `+N` disc's `aria-label`
  and `title` list the rest (on touch, the count alone shows).
  `AppNav` wraps `ProfileMenu` in a `relative` box and places the heads
  `absolute top-full right-0 mt-1 z-30`, so they float under the avatar
  without changing the bar's height. The face is pure so the theme studio and
  tests render it with fixed props, like `ProfileButtonFace`.
- **Vocabulary lock-ins:** element id `bbx-presence-heads`.
- **First chunk:** hook + face + container + `AppNav` placement + face test.

### Track 3 — docs

- `docs/chat-presence.md` (reference: what counts as present, the frame
  union, the invariants a later frame must keep, the iOS gap); update the
  issue to say typing/speaking is deferred; file the iOS box-screen gap as
  its own issue. No `mobile-contract.md` change, since no bridge surface
  changes.

## Could this be simpler?

Simplest version: extend `presence.heartbeat` with `{ chatSessionId }` and
have tabs poll a `presence.whoIsHere` query every 15 seconds. It reuses the
existing heartbeat, but fails three ways: (1) the heartbeat stops after two
idle minutes (`usePresenceHeartbeat.ts:7`), so Tomas reading along drops
out, contrary to the boxholder's "open in a focused tab" definition; (2) a
leave takes up to the 90-second TTL plus a poll, against "within seconds";
(3) the voice-call follow-up needs a push channel per chat anyway, so polling
would be replaced. The subscription is also less code: no TTL, no sweep, no
poll — its lifetime is the presence.

A smaller cut that was considered: client-side self-filtering (server sends
everyone). Rejected: it is the same amount of server code, and filtering on
the server keeps `ctx.user` the single identity source.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Tab closes without unsubscribing | Router test: aborting the signal removes the watcher | WS close aborts the subscription; `finally` leaves | Clear: head disappears |
| Phone suspended with socket half-open | No (needs a device) | keep-alive drops it in ≤35s (`server-box-scope.ts:258`) | Clear after the bound |
| Same person, two tabs; one closes | Room test: dedupe keeps the person while one watcher remains | `othersFor` dedupes by email | Clear |
| A listener throws (subscriber gone mid-send) | Room test | `join` catches per listener and logs `[chat-presence]` | Logged |
| Agent's browser (browse key, agentBrowsing owner) opens chat | Router test: `actor: "agent"` does not join | Agent check before join | Clear: agent never appears |
| Private chats ship later and a person may not see chat S | No (feature does not exist) | A watcher learns only about room S, which it must name. `authedProcedure` proves box access, not chat access. **Invariant for the private-chat work:** `watch` must make the same permission decision as reading the chat's transcript before joining, and end a watcher whose access is revoked | Documented risk: today every member can list every chat (`private-chat-sessions` issue, "that panel already lists every chat box-wide"), so this adds no exposure |
| iOS: the person goes to the native box screen | No | **None this round.** The web view stays mounted at opacity 0 behind the box screen (`ios-app/BeeBox/Views/RootView.swift:471-482`), so the page stays visible and the person stays present in their last chat until the app goes to the background | **Accepted gap**, filed as an issue: fixing it needs a native→web surface signal (a bridge change and a device build), which the boxholder asked to avoid if possible. Decision for the boxholder |
| iOS: app goes to the background | No (needs a device) | WebKit hides the page when the app backgrounds; if it does not, the suspended app's socket fails keep-alive within ~35s | Unverified on a device; the boxholder checks it on the phone |
| WebSocket reconnecting after a drop | Hook: status gate | People shown only while status is `pending`; `connecting` shows none | Clear: heads vanish during the reconnect and return with fresh data |
| Conversation switches while subscribed | Hook: input change resubscribes (tRPC) | Old subscription aborted, new one joins | Clear |
| Box in open access (no identity) | Router test: `user: null` yields `[]` | No join | Clear: no heads |

No critical gaps.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field — ADDRESSED: no agent-facing vocabulary.
- Stale ref — ADDRESSED: a deleted chat's room empties when its watchers
  leave; a room for an unknown session id holds only people who named it.
- Two agents touching the same card — ADDRESSED: nothing is written.
- Hand-edit drift — ADDRESSED: nothing on disk.
- Fabricated free-form value — ADDRESSED: name and email come from `ctx.user`,
  never from client input.
- Validation error UX — ADDRESSED: a malformed session id fails zod; the
  client logs and shows no heads.
- Partial migration / transition state — ADDRESSED: an old client never
  subscribes, so it neither appears nor sees others. A new client against an
  old server gets a "no procedure" error, logged, no heads.

## NOT in scope

- **Typing and speaking indicators.** Not free: the iOS composer is native
  (`NativeComposerView.swift`), so typing needs a new bridge message, and the
  web composer needs debounced signals. The frame union leaves room for them.
  Filed as `issues/features/2026-11-12-chat-shows-who-is-typing-or-speaking.md`.
- **Idle presence** (hidden tab, backgrounded app). Boxholder direction:
  active only this round.
- **Profile pictures for other people.** The WebSocket identity has no
  picture (`server-box-scope.ts:303` builds `{ email, name }`), and taking a
  URL from the client would let one member point another's browser at any
  URL. Initials only.
- **The agent seeing who is present.** Separate decision (the issue's
  "The agent" question).
- **Showing yourself.** Heads are for other people (boxholder lean).
- **Voice/video calls, signaling, ringing.** Next plan. The boundary it
  inherits: downstream frames (an offer, a ring) join the `ChatPresenceFrame`
  union on this subscription; upstream messages need their own
  `authedProcedure` mutation that names a recipient watcher in the same room,
  and the room's `onChange` callback grows into a frame sender. None of that
  is built now.
- **iOS native box screen.** See *Failure modes*; needs a bridge signal.
- **Replacing `presence.heartbeat`.** Different question (notification
  routing); left as is.
- **Presence across processes.** One process serves a box, as for the
  existing registry.

## Open design questions

Decisions made without the boxholder, to revisit:

1. **Focus in the browser, visibility in the iOS web view.** A browser tab
   counts only when visible and focused. The iOS web view counts when
   visible, because the native composer takes DOM focus from it.
2. **Decided by the boxholder, 2026-11-12:** a card covering the chat still
   counts as present (the transcript-visible gate is removed), and the iOS
   native box screen means present nowhere. iOS reports the box screen with
   a native→web signal (`mobile-contract.md` B15).
3. **Overflow:** two heads and a `+N` disc. Lean: keep.
4. **Order:** earliest arrival first, so heads do not jump. Lean: keep.

## Knowledge audits

Skip: no agent-facing concept. The agent does not see presence.

## What will hold this after it ships

- `core/chat/presence/room.test.ts`: the decision logic (`othersFor`, join,
  leave, dedupe, empty-room removal) is pure or in-memory, so unit tests
  reach all of it.
- `webapp/trpc/routers/chat-presence.test.ts`: drive `watch` through a caller
  with two contexts (Priya, Tomas), an agent context, and a null-user
  context; abort to leave.
- `components/AppNav/PresenceHeads.test.tsx` (or the face's equivalent per
  frontend test conventions): `[]` renders nothing; three people render two
  heads and `+1`.
- No new test tier.

## Implementation order

1. Track 1 room + tests (commit).
2. Track 1 router + registration + tests (commit).
3. Track 2 hook + face + container + placement + face test (commit).
4. Track 3 docs + issue update (commit).
5. Screenshot exhibit: owner in the browser, two scripted watchers (Tomas,
   Odette) subscribed over the WebSocket with dev session cookies, on the
   worktree's test1 clone.
6. Cross-model review of the branch; adjudicate; commit fixes.

## Rollout shape

Done when the room, router, and face tests pass, `pnpm typecheck` and
`pnpm layout-check` pass, and the exhibit shows two heads under the profile
avatar. No data shape changes; no migration. No knowledge audits. Ships with
the voice-call plan or alone, as the boxholder decides.
