# Chat processing-status display

The backend `busy` flag remains the send-admission truth, but a busy snapshot
from initial chat bootstrap is not enough by itself to paint "Agent is
working…". The display waits for a status confirmation. A locally streaming
turn remains immediate, and the history refresh that finalizes it keeps the
indicator. A refresh the machine entered for any *other* reason — a WS
(re)connect resync, a `chat-complete` broadcast on an idle chat, a status poll
that read idle — is a plain history round-trip and never paints the strip
(`chatMachine.ts` records the cause in `context.refreshCause`).

```ts setup
import {
  shouldShowAgentWorking,
  streamWatchdogAdvance,
  STREAM_WATCHDOG_IDLE_POLLS,
} from "../../../src/frontend/src/components/chat/processing-status-display.js";
```

## An unconfirmed bootstrap snapshot stays hidden

```ts
shouldShowAgentWorking({ phase: "idle", processBusy: true, confirmation: "unconfirmed" })
=> false

shouldShowAgentWorking({ phase: "idle", processBusy: true, confirmation: "confirmed" })
=> true

shouldShowAgentWorking({ phase: "idle", processBusy: false, confirmation: "confirmed" })
=> false
```

## Local streaming and its finalizing refresh remain immediate

```ts
shouldShowAgentWorking({ phase: "streaming", processBusy: false, confirmation: "unconfirmed" })
=> true

shouldShowAgentWorking({ phase: "refreshing-turn", processBusy: false, confirmation: "unconfirmed" })
=> true
```

## A resync refresh never flashes the strip

The reported flash (issues/bugs/2026-08-05-open-chat-flashes-agent-working-no-send.md):
the reconnect gate's trailing timer fires a REFRESH ~5s after every chat
mount, so an idle chat spent one history round-trip in `refreshing` with the
strip painted. The status poll's idle read drops its confirmation before it
sends the REFRESH, so that path is unconfirmed too. A resync is neutral, not
a suppressor: a busy turn already confirmed (the agent working on a capture,
say) keeps its strip through a reconnect's round-trip rather than flickering.

```ts
shouldShowAgentWorking({ phase: "refreshing-resync", processBusy: false, confirmation: "unconfirmed" })
=> false

shouldShowAgentWorking({ phase: "refreshing-resync", processBusy: true, confirmation: "unconfirmed" })
=> false

shouldShowAgentWorking({ phase: "refreshing-resync", processBusy: true, confirmation: "confirmed" })
=> true
```

## The stream watchdog recovers a wedged stream, and only a wedged one

The machine's `streaming` state is exited only by frames on the per-turn WS
subscription; if the socket dies and never reconnects, "Agent is working…"
persists forever while the server has long been idle (seen in a field test:
20+ minutes, twice). `streamWatchdogAdvance` is the pure policy behind the
5s watchdog poll: recover only after `STREAM_WATCHDOG_IDLE_POLLS` consecutive
server-idle reads, so the milliseconds-wide busy→STREAM_RESULT window at a
healthy turn end can never trigger a false recovery.

```ts
// A busy server resets the count — a long tool phase never accumulates.
JSON.stringify(streamWatchdogAdvance({ busy: true, idlePolls: 2 }))
=> {"idlePolls":0,"recover":false}

// Idle reads accumulate; recovery fires exactly at the threshold.
STREAM_WATCHDOG_IDLE_POLLS
=> 3

const s1 = streamWatchdogAdvance({ busy: false, idlePolls: 0 });
const s2 = streamWatchdogAdvance({ busy: false, idlePolls: s1.idlePolls });
const s3 = streamWatchdogAdvance({ busy: false, idlePolls: s2.idlePolls });
JSON.stringify([s1.recover, s2.recover, s3.recover])
=> [false,false,true]
```
