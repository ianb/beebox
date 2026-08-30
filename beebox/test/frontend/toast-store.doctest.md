# ToastStore — the app's transient error channel

`createToastStore` (src/frontend/src/components/ui/toast-store.ts) is the
framework-free core behind `toastError(...)`. It's the one place chat action
handlers, xstate machine actions, and plain async `.catch` blocks surface a
failure the stream-error banner can't reach. Errors only — no success/info
vocabulary. This exercises the behaviors the UI leans on: the dedupe counter,
auto-expiry, dismiss, and the persistent-with-an-action shape a session-ended
notice uses.

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
    schedule: (bbx) => {
      const key = ++seq;
      timers.set(key, bbx);
      return () => timers.delete(key);
    },
    fireAll: () => { for (const bbx of [...timers.values()]) bbx(); },
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

## A condition that is still true in ten seconds does not expire

Most errors are moments — a restart that failed, a fetch that did not land — and
they should get out of the way. Some are *states*. A session that ended has not
un-ended by the time an expiry timer fires, and every request after it fails the
same way, so a notice that quietly disappeared would leave someone looking at an
app that answers nothing for no stated reason
(`issues/bugs/2026-08-25-one-401-ejects-the-whole-app-to-a-login-form.md`).

`persist` arms no timer at all:

```ts
const clock = makeFakeSchedule();
const store = createToastStore({ schedule: clock.schedule });
store.error("Your session has ended, so the box stopped answering.", {
  persist: true,
  action: { label: "Sign in", href: "/auth/login?returnTo=%2Fchat" },
});
JSON.stringify({ pending: clock.pending(), toasts: store.getSnapshot().length })
=> {"pending":0,"toasts":1}
```

It carries the way out with it. An href rather than a handler, because the
destination is a URL and an anchor gets middle-click and keyboard activation
for free:

```ts continue
JSON.stringify(store.getSnapshot()[0].action)
=> {"label":"Sign in","href":"/auth/login?returnTo=%2Fchat"}
```

Firing every timer the store armed leaves it standing, and an ordinary error
raised alongside it still expires normally:

```ts continue
store.error("Failed to restart the agent process");
clock.fireAll();
store.getSnapshot().map((t) => t.message).join(",")
=> Your session has ended, so the box stopped answering.
```

A repeat collapses into it as usual — but must not hand it a timer on the way
in. The second 401 is more of the same condition, not evidence it is ending:

```ts continue
store.error("Your session has ended, so the box stopped answering.", { persist: true });
JSON.stringify({ pending: clock.pending(), count: store.getSnapshot()[0].count })
=> {"pending":0,"count":2}
```

Dismissing still works — the person can put it away once they have read it:

```ts continue
store.dismiss(store.getSnapshot()[0].id);
store.getSnapshot().length
=> 0
```
