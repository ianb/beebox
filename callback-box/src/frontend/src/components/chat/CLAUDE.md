# Chat UI

## Scrolling

The message list is **not virtualized** — it renders the loaded window
(`HISTORY_TAIL`, plus 40/page via "load older") in normal DOM order.
Virtualization (react-virtuoso) was removed deliberately; don't reintroduce it
without revisiting `docs/implemented-plans/chat-scroll-redesign.md`.

A single in-repo controller, `useStickToBottom` (`InteractiveChat-scroll.ts`),
owns all scroll behavior: follow-the-bottom while streaming, disengage on a
genuine user scroll-up, the floating scroll-to-bottom button's state
(`isPinned` / `hasUnseenContent`), prepend anchoring for "load older", and
holding the reading position when content loads above the viewport.

**Invariant: exactly one thing controls scroll.** Don't add another effect that
calls `scrollTo` / sets `scrollTop` on the list, and don't reintroduce a
library's own follow logic — two authorities fighting (Virtuoso's `followOutput`
vs. a hand-rolled pin layer) was the original bug. Two non-obvious details the
controller depends on:

- It runs a `ResizeObserver` on **both** the content and the scroller element.
  Below-list chrome (status banners, composer, the iOS keyboard) resizes the
  scroller's `clientHeight` without changing content height; a content-only
  observer silently drifts off the bottom.
- User vs. programmatic scroll is told apart by recording the last `scrollTop`
  the controller wrote (not `event.isTrusted`), and a scroll-up only disengages
  when a real wheel/touch/key intent fired recently.

**After changing scroll code, run the manual procedure in
`docs/chat-scroll-testing.md`** (drives the app via `bin/browse`; layout
behavior can't be doctested), and verify on a real iOS device for
keyboard/momentum/rubber-band, which headless Chromium can't emulate.

## Streaming → finalize

The live (still-streaming) assistant turn and its finalized form render through
**one component (`AssistantMessage`) under one stable key** — the streamed turn
is a *provisional* assistant group (built by `buildStreamEntry`, appended in
`buildDataItems`) keyed by `liveTurnId` (chat-machine context, set on send), and
`MessageList` keys the newest assistant group by that same `liveTurnId`. So
finalize is an in-place props update, not a remount.

**Invariant: don't render the streaming turn as a separate bubble/component and
swap in the finalized one** — that remount is the "shudder" this design removed
(`docs/implemented-plans/chat-stream-finalize-unify.md`). `liveTurnId` is held
across finalize until the next send; the previous turn re-keys to its uuid only
then (a one-time, send-masked remount — the deliberate trade-off). Because both
states go through `AssistantMessage`, the now-playing speech highlight works
during streaming too.
