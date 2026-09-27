# Presence tracker: tabs heard from in the last 90 seconds

The server counts, per box, the web tabs that sent a heartbeat in the last 90
seconds, and says when `.beebox/presence.json` needs writing: when the count
changes, including one write when it drops to zero, and every 30 seconds while
it is nonzero, so a reader never sees a live count go stale.

```ts setup
import { createPresenceTracker } from "../../../src/core/notification/presence-tracker.js";

const T0 = Date.parse("2026-09-26T12:00:00Z");
const at = (seconds) => new Date(T0 + seconds * 1000);

// Take whatever write is due and record it, as the server does.
function flush(tracker, seconds) {
  const due = tracker.due(at(seconds));
  if (due !== null) tracker.written({ activeWeb: due, now: at(seconds) });
  return due === null ? "no write" : `write ${due}`;
}
```

## Nobody has sent a heartbeat: nothing to write

```ts
const tracker = createPresenceTracker();
flush(tracker, 0)
=> no write
```

## Two tabs count as two; a repeat heartbeat from one tab does not add

```ts continue
tracker.heard("tab-aaaaaaaa", at(0));
flush(tracker, 0)
=> write 1

tracker.heard("tab-bbbbbbbb", at(5));
tracker.heard("tab-aaaaaaaa", at(10));
tracker.count(at(10))
=> 2

flush(tracker, 10)
=> write 2
```

## An unchanged count is rewritten every 30 seconds, not on every heartbeat

```ts continue
tracker.heard("tab-aaaaaaaa", at(20));
flush(tracker, 20)
=> no write

tracker.heard("tab-aaaaaaaa", at(40));
flush(tracker, 40)
=> write 2
```

## A tab not heard from for 90 seconds expires

Tab b last spoke at 5 s, so at 96 s only tab a (last heard at 40 s) remains.
When tab a also lapses, zero is written once and then nothing more.

```ts continue
tracker.count(at(95))
=> 2

flush(tracker, 96)
=> write 1

flush(tracker, 131)
=> write 0

flush(tracker, 200)
=> no write
```

## The session map is bounded

A client chooses its own id, so a flood of ids drops the oldest past 64.

```ts
const flooded = createPresenceTracker();
for (let i = 0; i < 100; i++) flooded.heard(`tab-${String(i).padStart(8, "0")}`, at(i / 10));
flooded.count(at(10))
=> 64
```
