# Dev stubs

Deterministic stand-ins for the backend so streaming UI and component states
can be checked by hand in a browser.

## What it is

Some frontend bugs only manifest against real layout and measurement — scroll
behavior, virtualization, streaming-driven reflow — and can't be reproduced in a
doctest. For these, drive the running app with `bin/browse` (see
`.claude/skills/browse/SKILL.md`, monorepo root) and use a dev stub to make the
input deterministic instead of depending on a live agent response.

Two kinds. A **stub** replaces one input to the real app (`/fakestream`
replaces the agent's reply). A **dev harness** is a DEV-only route that mounts
real components over injectable fake services so every state is reachable:
`/dev/capture-mode`, `/dev/composer-states` (states catalogued in
[composer states](../chat/composer.md)), `/dev/chat-scroll`. Tours walk the
real app; harnesses fabricate states.

## Running it

### `/fakestream`

**Location:** `src/frontend/src/machines/chat-actors.ts` (`runFakeStream`)
**Trigger:** Send a chat message beginning with `/fakestream`.

Instead of calling the backend, the chat machine plays a timed script of
`STREAM_TEXT` events, growing the assistant bubble at a controlled rate with no
API calls. This reproduces streaming-UI bugs (scroll-follow, layout jitter)
frame-for-frame.

```
/fakestream [chunks] [intervalMs] [chunkLen]
```

- `chunks` — total text events to emit (default 200)
- `intervalMs` — delay between events (default 40)
- `chunkLen` — approx chars per event (default 25)

Example: `/fakestream 2000 30 25` streams ~50k chars over ~60s. The message
list is a single scroll container with `data-testid="chat-scroller"` driven by
the `useChatScroll` controller (`components/chat/chat-scroll.ts`). Measure
scroll state from the browser to assert behavior deterministically — with
`bin/browse eval --no-wait`, since a plain `eval` waits out the stream and hands
you the settled page:

```js
// Under the write-on-user-action model, fromBottom GROWS as the reply streams
// and scrollTop does not move: nothing follows the bottom.
const s = document.querySelector('[data-testid="chat-scroller"]');
({ fromBottom: s.scrollHeight - s.scrollTop - s.clientHeight, scrollTop: s.scrollTop, scrollHeight: s.scrollHeight });
```

**Driving the scroll behavior.** The two instruments — the scenario table at
`/dev/chat-scroll` and the step-by-step `bin/browse` procedure, plus the
real-device checklist — live in
[chat-scroll-testing.md](../chat/scroll.md). Note that `/fakestream`
content **vanishes at finalize in a server-backed session** (the authoritative
history has no such turn), so sample while it streams, not after.

The stub is gated purely on the message prefix, so it ships harmlessly — a real
message never starts with `/fakestream`.
