---
title: "Stuck in one landmark — the switch menu doesn't move you, though the whole server side resolves correctly"
workstream: chat-wayfinding
area: callback-box
labels: [chat, navigation, ios, landmarks]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder report from a deployed box
---

On a deployed box, the chat is stuck in one landmark: the place-switch menu
will not move to another. Observed on iOS; unconfirmed whether the web client
does the same.

The boxholder had just added a new landmark and suspected it as the cause. The
evidence says otherwise — the new landmark is healthy and resolves correctly
like every other.

## The server side is entirely ruled out (checked 2026-08-20)

Read-only inspection of the deployed box, at both steps the switch performs:

- **All 7 `*.landmark.card` files validate**, including the newly added one.
- **`chat.placeMenu` returns all 7**, in the documented order, each with
  `path`, `dir`, `label`, `symbol`, `freshCount`. **`problems: []`** — and since
  `loadLandmarkSummaries` deliberately *reports* unparseable landmarks rather
  than dropping them, an empty array means nothing was malformed or skipped.
- **`chat.lastSessionForDirectory` resolves each landmark to a distinct
  destination**: 5 of the 7 return 5 different session ids, and the other 2
  return `null` — exactly the 2 whose `freshCount` is 0. That is the correct
  answer for every one of them.

So both queries the switch depends on return correct, complete, *distinct*
data. Whatever is failing happens after that, in the client.

## The web client's path looks built for this

Worth knowing before someone re-derives it:

- Selection is keyed by the landmark's `dir`, not by list index
  (`PlacePill.tsx:231`), so the recency-based reordering caused by adding a
  landmark does not misaddress the target. That was the leading hypothesis and
  it is wrong.
- `useOpenLandmarkChat` resolves the landmark's newest session and navigates to
  `/<box>/chat` with either `?session=<id>` or `?session=new&contextDir=<dir>`.
- `ChatPage` reads `?session` reactively and **keys `InteractiveChat` so a real
  session switch remounts the machine and reloads history** — including an
  assignment latch specifically so "an explicit landmark/session navigation
  from a fresh chat" is not confused with a `new → assigned id` transition
  (`ChatPage.tsx:133-163`).

So the same-route, search-params-only navigation that a chat→chat switch
performs is handled deliberately in the web client. That makes the iOS shell
the prime suspect.

## The question that halves the search

**Does it reproduce in a desktop browser?** The boxholder saw it on iOS and is
unsure about web. Given the above, a web repro would mean the careful
session-switch handling in `ChatPage` has a hole; no web repro localizes it to
the `WKWebView` shell. Nothing else narrows this as cheaply.

## Leads, in the order worth trying

- **iOS navigation has regressed in exactly this shape before.** The
  composer-flag loss on navigation
  (`closed/bugs/2026-07-22-ios-both-composers-nativecomposer-flag-lost-on-nav.md`)
  was also a route change inside the `WKWebView` that the native shell and the
  web client disagreed about.
- **Check the two zero-chat landmarks separately.** They take the other branch
  (`?session=new&contextDir=…` rather than `?session=<id>`). If the client
  mishandles that branch, those two fail differently from the rest — and a
  brand-new landmark is normally in exactly that state, which may be why adding
  one made the problem noticeable even though the card itself is fine.
- **`client-debug.log` should have the answer.** `useOpenLandmarkChat` logs
  `[landmarks] failed to open chat for <dir>` on a lookup failure, and iOS
  entries land in the same sink tagged `[ios]` (`docs/client-debug-log.md`). If
  that line is present the failure is in the fetch; if absent, the navigation
  was issued and the client did not act on it.

## It does reproduce in a desktop browser (2026-08-21)

The question above is answered: yes. Observed three times in the web client on a
local box, driving `/test1/chat` with the browser.

Opening a landmark-scoped chat — from the Place menu, or from a card page's
"New" chat button — leaves the header chip reading `Place: Chat` with no `Here:`
chip, while the URL carries `contextDir=store/courses/Acids_Bases.attach`. A full
page load of that same URL renders `Place: Acids & Bases` + `Here:
Acids_Bases.attach` correctly. Everything the landmark menu offers (its
directory, curated links, Recent files) is therefore unreachable until a reload.

That the same URL is right on a cold load and wrong on a client-side navigation
points at the props, not the lookups. `ChatPage` passes `contextDir` down only
while the rendered session is the literal `"new"`
(`callback-box/src/frontend/src/pages/ChatPage.tsx:327-338`), and the chip is
published from that prop (`InteractiveChat.tsx:160` →
`InteractiveChat-view.tsx:127` → `ChatBarChrome.tsx:87` `useAppBarPlace`). On a
cold load the first paint is `"new"`, so the dir arrives. On a chat→chat
navigation the coining/latch machinery above that line can hand back a session id
instead, and the dir is dropped — leaving the chat bound but unlabelled.

So the search is not confined to the iOS shell.

## The prop-drop diagnosis above is wrong; the cause is the reservation (2026-08-25)

Re-reproduced in the web client on a local box. The symptom is real and worse
than filed — **a cold load of the same URL is wrong too**, which the section
above says it is not. Two observations rule the filed mechanism out:

- Switching to a landmark whose chat already has a committed history row
  relabels the chip immediately, on the client-side navigation, with no reload.
  So `ChatPage`'s `contextDir={rendered === "new" ? … }` is not dropping
  anything that matters.
- A landmark chat that has never had a turn is unlabelled on a cold load as
  well, so the difference is not client-side-nav versus first paint.

What actually happens: opening a landmark with no committed chat takes the coin
path, and a coined chat's binding lives **only in the in-memory reservation**
(`core/chat/session/reserve.ts` — "Reservations are in-memory only";
`contextDir` sits on the `ChatReservation`). `chat.directoryFor` reads only the
persisted history (`getDirectoryForSession` → `loadHistoryEntries`), which has
no row until the first turn commits. It therefore answers `null`, and the chat
is bound server-side but unlabelled client-side until the chat has been used
*and* the page reloaded — the `null` is cached.

A second-order bug rides along: `chat.lastSessionForDirectory` ignores
reservations too, so switching to a landmark whose only chat is
reserved-not-yet-started coins a *fresh* chat every time rather than returning
to the one you just left. That is the same complaint as
[no consistent way back to chat](2026-08-23-no-consistent-way-back-to-chat.md).

Both are fixed on `worktree-chat-wayfinding`: the two procedures consult the
reservation store, `""` (the box-root landmark) is kept distinct from `null`
through the reserve path so a chat opened from the Box row is labelled too, and
`ChatReservationStore.latestForDirectory` is what "open this landmark's chat"
falls back to.
