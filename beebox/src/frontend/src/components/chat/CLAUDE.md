# Chat UI

## Scrolling

The message list is **not virtualized** — it renders the loaded window
(`HISTORY_TAIL`, plus 40/page via "load older") in normal DOM order.
Virtualization (react-virtuoso) was removed deliberately; don't reintroduce it
without revisiting `docs/implemented-plans/chat-scroll-redesign.md`.

A single in-repo controller, `useChatScroll` (`chat-scroll.ts`), owns all scroll
behavior. **The model: it writes `scrollTop` only in response to a discrete user
action, plus geometric compensations for changes the reader cannot see. Content
growth below the reader never scrolls** — a streaming reply that outgrows the
screen continues below the fold and the button lights up
(`docs/plans/chat-scroll-model.md`). The writes, exhaustively:

1. **Open a thread** — hold the bottom on every growth until the first history
   render has landed (`settleOpen()`; the hold waits for the transcript's
   images to load or fail — an `<img>` reserves no height until
   its bytes land, and the chat has no dimension metadata to reserve with —
   then ends after a short quiet period with no growth — a cached image is
   `complete` before it is laid out — under an 8s cap). A reader who
   scrolls away (scrollTop moves *up* — being off the bottom is not enough,
   since content grows between the hold's write and its scroll event), sends,
   or presses the button ends the hold themselves.
2. **Send** — the new user message goes to the top of the viewport
   (`anchorToTop`), from a layout effect, after the commit that added both the
   message and the spacer. The reply streams in below it; nothing follows it.
3. **The scroll-to-bottom button** — smooth scroll to the bottom.
4. **Compensations**, all "measure delta, write delta" on a resize: restore the
   captured gap across an older-history prepend, hold the reading anchor when
   content above the viewport reflows, and preserve the previous `fromBottom`
   when the scroller box itself resizes (keyboard, composer, banners). The pure
   dispatcher is `decideReconcile` in `scroll-reconcile.ts`, unit-checked in
   `test/frontend/chat-scroll-reconcile.doctest.md`.

The controller keeps *geometry* state only (previous `scrollHeight`, previous
`fromBottom`, one anchor) and no *intent* state: it never asks whether a scroll
event was the user's, because nothing it does depends on the answer. That
question — a programmatic-write epsilon, a 250ms input-intent window,
wheel/touch/key listeners, a smooth-scroll target — is what the previous
`useStickToBottom` needed in order to follow the bottom, and each of its cases
was only testable on the device that produced it (iOS momentum with no
`touchmove`, keyboard clamps, rubber-band). `atBottom = fromBottom <= 24`,
recomputed on every scroll and every resize, drives the button's visibility;
`hasUnseenContent` its accent.

**Invariant: exactly one thing controls scroll.** Don't add another effect that
calls `scrollTo` / sets `scrollTop` on the list, and don't reintroduce a
library's own follow logic — two authorities fighting (Virtuoso's `followOutput`
vs. a hand-rolled pin layer) was the original bug. Three details the controller
depends on:

- It runs a `ResizeObserver` on **both** the content and the scroller element.
  Below-list chrome (status banners, composer, the iOS keyboard) resizes the
  scroller's `clientHeight` without changing content height, and that is rule
  4's third branch — a content-only observer cannot see it at all.
- **Every message wrapper carries `data-role`**, and the reading anchor is the
  first such item that *starts* in the viewport. Both halves matter: the content
  wrapper's own children are two boxes (the load-older header and the
  scan-boundary wrapper holding the whole transcript), which measure no shift;
  and anchoring to the topmost *partly*-visible item would miss an image
  decoding inside it, which grows it downward without moving its own top.
- **The last turn carries `min-height: <scroller clientHeight>`** once the person
  has sent in this session (the controller reports `viewportPx`), so "the user
  message at the top of the screen" is a reachable scroll position even for a
  one-line reply. It moves down with the turn.

**After changing scroll code, run the scenario table at `/dev/chat-scroll`**
(`window.__scrollHarness.runAll()` via `bin/browse eval` — every scenario must
PASS) **and the browser procedure in `docs/chat-scroll-testing.md`**, and verify
on a real iOS device for keyboard/momentum/rubber-band, which headless Chromium
can't emulate.

## Streaming → finalize

The live (still-streaming) assistant turn and its finalized form render through
**one component (`AssistantMessage`) under one stable key** — the streamed turn
is a *provisional* assistant group (built by `buildStreamEntry`, appended in
`buildDataItems`) keyed by `liveTurnId` (chat-machine context, set on send), and
`MessageList` keys the newest assistant group by that same `liveTurnId`. So
finalize is an in-place props update, not a remount.

The other half of "in place" is that `streamText` must survive until the
authoritative history lands. `streamingShown` keeps the provisional bubble up
through `refreshing` (the post-turn `fetchHistory` roundtrip), and `refreshing`'s
`onDone` swaps messages in and clears the stream in ONE `assign`. **Invariant:
no other transition may clear `streamText` while a turn is finalizing.** Both
`streaming` and `refreshing` therefore ignore `REFRESH` — the backend broadcasts
`chat-complete` the moment a turn ends and `InteractiveChat-ws.ts` turns that
into a `REFRESH` that lands just after `STREAM_RESULT`. When `refreshing` lacked
that guard, the global handler blanked `streamText` mid-flight: the bubble
unmounted, the list collapsed to the user message for a full roundtrip, and the
scroll controller rode the shrink up to the top of the turn (the "finalize jumps
back to my message" bug, fixed 2026-07-29). The extra fetch bought nothing —
`waitForTranscriptEntry` (`core/chat/session/transcript-sync.ts`) holds
`result`/`done` until the turn is durable, so the in-flight read is already
authoritative. Locked down in
`test/frontend/chat-machine-finalize.doctest.md`.

**Invariant: don't render the streaming turn as a separate bubble/component and
swap in the finalized one** — that remount is the "shudder" this design removed
(`docs/implemented-plans/chat-stream-finalize-unify.md`). `liveTurnId` is held
across finalize until the next send; the previous turn re-keys to its uuid only
then (a one-time, send-masked remount — the deliberate trade-off). Because both
states go through `AssistantMessage`, the now-playing speech highlight works
during streaming too.

## Composer input lives in a store, not root state

The composer text changes on every keystroke, so it must NOT be `useState` at
the `InteractiveChat` root — that root is the common parent of the message
history *and* the companion view pane (custom box views / sandbox cards), and
React would reconcile both subtrees on every key press. (A custom view
re-rendering per keystroke is exactly the bug this avoids.)

It lives in a small external store instead (`input-store.ts`): only the composer
textareas subscribe via `useInputValue()` and re-render on a keystroke;
everything else (the root, and the hooks that mutate input on send / voice /
attachments / selections) reads the current value at call-time with `get()` and
writes with `set()` — neither subscribes, so a keystroke never re-renders them.

**Invariant: don't reintroduce `input`/`setInput` as React state or thread it as
a prop through the body.** New code that needs the text reads `useInputValue()`
(reactive, composer-only) or takes the `InputStore` and calls `get()`/`set()`.
`MessageList` is also wrapped in `React.memo` as a second line of defense; the
store is the first. Verify with the render-count probe (commit-hook +
`actualDuration`) that a keystroke re-renders only the composer subtree.

## The companion pane doesn't re-render on message submit

Same class of problem, one level up from keystrokes. The `InteractiveChat` root
reads the chat-machine snapshot (`messages`, `streamText`, `liveTurnId`,
`processBusy`, …), so a send — and every streaming token after it — re-renders
the root and `InteractiveChatBody`, which parents BOTH the message list and the
open companion card. The pane's real inputs (`activeView` / `tabs` from
`useChatTabs`) don't change on a send, so the pane should stay put.

`CompanionViewPanel` (`InteractiveChat-controls.tsx`) is wrapped in `React.memo`
to hold it still — the same defense as `MessageList`. Memo only holds if EVERY
prop is referentially stable across a submit, so:

- `onNavigate` is a `useCallback` (`handleCompanionNavigate` in
  `InteractiveChat-view.tsx`), not an inline arrow.
- `useCompanionSelection`'s `handleAddSelection` depends on
  `selections.addSelection` (a stable callback), NOT the whole `selections`
  object — `useChatSelections` returns a fresh object literal every render.
- `tabs`/`activePath`/`onSelectTab`/`onCloseTab`/`onClosePanel` come from
  `useChatTabs` (`[]`-dep callbacks + `panel` state untouched by a send), and
  `reportActivity` from `useCompanionCard` is a `[]`-dep callback.

**Invariant: keep every `CompanionViewPanel` prop referentially stable across a
submit** — a new unstable callback/object prop silently re-enables the flicker.
The memo is standard prop-diffing, so the pane still re-renders correctly when
you navigate within it or switch cards (those change `activePath`/`tabs`);
FileView owns its own data subscription, so a card-data change updates the pane
regardless of the memo. Verify with the render-count probe (drive via
`bin/browse`, log a render marker in the panel body, submit a message): the
companion pane's render count must not tick.
