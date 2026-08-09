# Chat processing-status display

The backend `busy` flag remains the send-admission truth, but a busy snapshot
from initial chat bootstrap is not enough by itself to paint "Agent is
working…". The display waits for a status confirmation. A locally streaming
turn remains immediate, and its final history refresh keeps the indicator;
only the refresh used to clear a transient bootstrap snapshot stays hidden.

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
```

## Local streaming and normal finalization remain immediate

```ts
shouldShowAgentWorking({ phase: "streaming", processBusy: false, confirmation: "unconfirmed" })
=> true

shouldShowAgentWorking({ phase: "refreshing", processBusy: false, confirmation: "unconfirmed" })
=> true
```

## Clearing a transient snapshot does not flash during history refresh

```ts
shouldShowAgentWorking({ phase: "refreshing", processBusy: true, confirmation: "clearing" })
=> false

shouldShowAgentWorking({ phase: "idle", processBusy: true, confirmation: "clearing" })
=> false

shouldShowAgentWorking({ phase: "idle", processBusy: false, confirmation: "confirmed" })
=> false
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
