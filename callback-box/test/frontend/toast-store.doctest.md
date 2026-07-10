# ToastStore — the app's transient error channel

`createToastStore` (src/frontend/src/components/ui/toast-store.ts) is the
framework-free core behind `toastError(...)`. It's the one place chat action
handlers, xstate machine actions, and plain async `.catch` blocks surface a
failure the stream-error banner can't reach. Errors only — no success/info
vocabulary. This exercises the three behaviors the UI leans on: the dedupe
counter, auto-expiry, and dismiss.

Timers are injected via `schedule` so expiry is deterministic here instead of
a real 10s wait — the same seam the React viewport never touches (it uses the
default `setTimeout`).

```ts setup
import { createToastStore } from "../../src/frontend/src/components/ui/toast-store.js";

// A controllable stand-in for setTimeout: records each armed expiry so the
// test fires it by hand. Returns a cancel that removes it (what a repeat /
// dismiss calls before re-arming), so `pending()` reflects live timers.
function makeFakeSchedule() {
  const timers = new Map();
  let seq = 0;
  return {
    schedule: (cb) => {
      const key = ++seq;
      timers.set(key, cb);
      return () => timers.delete(key);
    },
    fireAll: () => { for (const cb of [...timers.values()]) cb(); },
    pending: () => timers.size,
  };
}
```

## A single error toast carries message + cause detail

```ts
const clock = makeFakeSchedule();
const store = createToastStore({ schedule: clock.schedule });
store.error("Failed to restart the agent process", { cause: new Error("HTTP 500") });
JSON.stringify(store.getSnapshot())
=> [{"id":1,"message":"Failed to restart the agent process","detail":"HTTP 500","count":1}]
```

A cause is optional; without one there's no secondary detail line:

```ts continue
store.error("Failed to load earlier messages");
store.getSnapshot().length
=> 2

store.getSnapshot()[1].detail
=> undefined
```

## Duplicate messages collapse into one toast with a counter

An identical message doesn't stack a second card — it increments the counter on
the existing one and refreshes its detail to the latest cause:

```ts
const clock = makeFakeSchedule();
const store = createToastStore({ schedule: clock.schedule });
store.error("Failed to interrupt the agent", { cause: new Error("first") });
store.error("Failed to interrupt the agent", { cause: new Error("second") });
JSON.stringify(store.getSnapshot())
=> [{"id":1,"message":"Failed to interrupt the agent","detail":"second","count":2}]
```

A repeat with no cause keeps the prior detail rather than blanking it:

```ts continue
store.error("Failed to interrupt the agent");
JSON.stringify(store.getSnapshot())
=> [{"id":1,"message":"Failed to interrupt the agent","detail":"second","count":3}]
```

The counter refreshes expiry — one live timer, not three, since each collapse
cancels and re-arms:

```ts continue
clock.pending()
=> 1
```

## Auto-expiry removes the toast

Firing the armed timer (what the real 10s `setTimeout` does) drops the toast:

```ts
const clock = makeFakeSchedule();
const store = createToastStore({ schedule: clock.schedule });
store.error("Failed to cancel the schedule");
store.getSnapshot().length
=> 1

clock.fireAll();
store.getSnapshot().length
=> 0
```

## Dismiss removes a specific toast and notifies subscribers

```ts
const clock = makeFakeSchedule();
const store = createToastStore({ schedule: clock.schedule });
let notifications = 0;
store.subscribe(() => { notifications += 1; });
store.error("Failed to restart the agent process");
store.error("Failed to load earlier messages");
store.getSnapshot().map((t) => t.id).join(",")
=> 1,2
```

Dismissing by id leaves the sibling and fires one notification:

```ts continue
store.dismiss(1);
store.getSnapshot().map((t) => t.message).join(",")
=> Failed to load earlier messages

notifications
=> 3
```

Dismissing an already-gone id is a no-op — no phantom notification:

```ts continue
store.dismiss(1);
notifications
=> 3
```

## Snapshot identity is stable between mutations

`useSyncExternalStore` requires `getSnapshot` to return the same reference when
nothing changed, or React re-renders forever:

```ts continue
store.getSnapshot() === store.getSnapshot()
=> true
```
