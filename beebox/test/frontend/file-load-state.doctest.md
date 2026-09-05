# What a file view shows when a load or a refresh fails (`file-load-state.ts`)

`resolveLoadState` folds a React Query result into one of four outcomes:
loading, a hard error, the loaded body, or the loaded body marked out of date.
The rule it exists to enforce: **an error may only take content away when there
is no content.** Before this, `useFileData` checked the error first, so a single
background refetch that failed replaced an already-rendered card with an error
message and never came back.

```ts setup
import { resolveLoadState, isTransientQueryError, describeQueryFailure } from "../../src/frontend/src/lib/file-load-state.js";

/** A query result with everything quiet; each example overrides what it cares about. */
function query(over: Partial<Parameters<typeof resolveLoadState<string>>[0]>) {
  return { data: undefined, isLoading: false, isLoadingError: false, isRefetchError: false, error: null, ...over };
}
```

## A refresh that fails keeps the body, and says it is out of date

The reported bug, in one example: the card loaded, the box restarted, the
refetch got a 502. `data` is still in the cache — it must still be on screen.

```ts
const gateway = { message: "Failed to load: 502 Bad Gateway" };
const state = resolveLoadState(query({ data: "the card body", isRefetchError: true, error: gateway }));

state.value
=> the card body

state.error
=> null

state.stale?.headline
=> The box did not answer — it may be restarting.
```

The underlying message is kept as supporting detail rather than shown as the
headline, because the headline the transport produces names the wrong problem.

```ts continue
state.stale?.detail
=> Failed to load: 502 Bad Gateway
```

## A first load that fails is still an error

Nothing is cached, so there is nothing to protect.

```ts
const state = resolveLoadState(query({ isLoadingError: true, error: { message: "Card not found: Foo.card" } }));

state.value
=> null

state.error?.headline
=> Card not found: Foo.card
```

A caller that matches on the underlying message — `FileView`'s missing-card
branch — reads `detail`, which is the message verbatim.

```ts continue
state.error?.detail
=> Card not found: Foo.card
```

## A successful load, and a refresh that succeeds after failing

```ts
const loaded = resolveLoadState(query({ data: "body" }));
JSON.stringify(loaded)
=> {"value":"body","loading":false,"error":null,"stale":null}
```

React Query clears `isRefetchError` on the next success, so recovery needs no
handling of its own — the stale marker simply stops being returned.

```ts continue
resolveLoadState(query({ data: "newer body", isRefetchError: false, error: null })).stale
=> null
```

## Loading, and the genuinely-empty result

```ts
resolveLoadState(query({ isLoading: true })).loading
=> true

JSON.stringify(resolveLoadState(query({})))
=> {"value":null,"loading":false,"error":null,"stale":null}
```

## Which failures are worth retrying

A 5xx, a request that never reached a server, and the JSON parse error a
gateway's plain-text body produces inside `httpBatchStreamLink` all mean "try
again shortly". That last shape is the one the reported outage actually
delivered to the client.

```ts
isTransientQueryError({ message: "Failed to load: 502 Bad Gateway" })
=> true

isTransientQueryError({ message: "Failed to fetch" })
=> true

isTransientQueryError({ message: `Failed to execute 'json' on 'Response': Unexpected token 'B', "Bad Gateway" is not valid JSON` })
=> true

isTransientQueryError({ data: { httpStatus: 503 }, message: "Service Unavailable" })
=> true
```

A missing card, a rejected request, and an expired session are answers, not
outages: retrying them delays the correct state by several seconds and changes
nothing.

```ts
isTransientQueryError({ data: { code: "NOT_FOUND", httpStatus: 404 }, message: "Card not found: Foo.card" })
=> false

isTransientQueryError({ data: { code: "UNAUTHORIZED", httpStatus: 401 }, message: "Not signed in" })
=> false

isTransientQueryError({ message: "Failed to load: 404 Not Found" })
=> false

isTransientQueryError(null)
=> false
```

A tRPC code wins over the status beside it, because the code is the server's
own classification.

```ts
isTransientQueryError({ data: { code: "NOT_FOUND", httpStatus: 500 } })
=> false
```

## Describing a failure

```ts
describeQueryFailure({ message: "Failed to fetch" }).headline
=> The box did not answer — it may be restarting.

describeQueryFailure({ message: "Card not found: Foo.card" }).headline
=> Card not found: Foo.card
```
