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
