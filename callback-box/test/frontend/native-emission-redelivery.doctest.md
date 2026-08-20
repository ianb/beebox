# Native emission redelivery is idempotent per page

The iOS shell redelivers a pending emission with the SAME id until a receipt
settles it — on navigation, relaunch, and a backoff while a receipt is missing
(`docs/mobile-contract.md` §4.2). The web page must not turn a redelivered id
into a second optimistic send: `resolveNativeDispatch` shares the original
dispatch's outcome so the shell gets its receipt re-posted while the
transcript gains no duplicate row (the 2026-08-19 voice-duplicate regression).

```ts setup
import { createNativeDispatchRegistry, resolveNativeDispatch } from "../../src/frontend/src/components/chat/native-emission-redelivery.js";
import type { Receipt } from "../../src/frontend/src/input/targets/receipts.js";

function sent(emissionId: string): Receipt {
  return { disposition: "sent", emissionId, deduplicated: false };
}
```

## A redelivered id shares the outcome — one dispatch, two receipts

```ts
const registry = createNativeDispatchRegistry();
let dispatches = 0;
const first = resolveNativeDispatch("em-1", {
  registry,
  dispatch: () => { dispatches += 1; return Promise.resolve(sent("em-1")); },
});
const second = resolveNativeDispatch("em-1", {
  registry,
  dispatch: () => { dispatches += 1; return Promise.resolve(sent("em-1")); },
});
const [a, b] = await Promise.all([first.outcome, second.outcome]);
JSON.stringify({ dispatches, redelivered: [first.redelivered, second.redelivered], same: a === b });
=> {"dispatches":1,"redelivered":[false,true],"same":true}
```

## A settled send keeps answering later redeliveries

The entry outlives settlement on purpose: the shell may redeliver after the
receipt was dropped mid-navigation, and the answer is still this outcome.

```ts continue
const third = resolveNativeDispatch("em-1", {
  registry,
  dispatch: () => { dispatches += 1; return Promise.resolve(sent("em-1")); },
});
JSON.stringify({ dispatches, redelivered: third.redelivered, disposition: (await third.outcome).disposition });
=> {"dispatches":1,"redelivered":true,"disposition":"sent"}
```

## A rejection is per-attempt: the shell's Retry dispatches for real

```ts continue
const rejecting = createNativeDispatchRegistry();
let attempts = 0;
const failed = resolveNativeDispatch("em-2", {
  registry: rejecting,
  dispatch: () => {
    attempts += 1;
    return Promise.resolve({ disposition: "rejected", emissionId: "em-2", reason: "backend down" } satisfies Receipt);
  },
});
await failed.outcome;
const retried = resolveNativeDispatch("em-2", {
  registry: rejecting,
  dispatch: () => { attempts += 1; return Promise.resolve(sent("em-2")); },
});
JSON.stringify({ attempts, retriedWasFresh: !retried.redelivered, disposition: (await retried.outcome).disposition });
=> {"attempts":2,"retriedWasFresh":true,"disposition":"sent"}
```

## A thrown dispatch also clears the entry

```ts continue
const throwing = createNativeDispatchRegistry();
let calls = 0;
const boom = resolveNativeDispatch("em-3", {
  registry: throwing,
  dispatch: () => { calls += 1; return Promise.reject(new Error("dispatch died")); },
});
const caught = await boom.outcome.then(() => "resolved", (e: unknown) => (e instanceof Error ? e.message : "?"));
const after = resolveNativeDispatch("em-3", {
  registry: throwing,
  dispatch: () => { calls += 1; return Promise.resolve(sent("em-3")); },
});
JSON.stringify({ calls, caught, afterWasFresh: !after.redelivered });
=> {"calls":2,"caught":"dispatch died","afterWasFresh":true}
```
