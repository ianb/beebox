# What a file view shows when a load or a refresh fails (`file-load-state.ts`)

`resolveLoadState` folds a React Query result into one of four outcomes:
loading, a hard error, the loaded body, or the loaded body marked out of date.
The rule it exists to enforce: **an error may only take content away when there
is no content.** Before this, `useFileData` checked the error first, so a single
background refetch that failed replaced an already-rendered card with an error
message and never came back.

```ts setup
import { resolveLoadState, describeQueryFailure } from "../../src/frontend/src/lib/file-load-state.js";
import { BoxUnreachableError } from "../../src/frontend/src/lib/trpc/transient.js";

/** A query result with everything quiet; each example overrides what it cares about. */
function query(over: Partial<Parameters<typeof resolveLoadState<string>>[0]>) {
  return { data: undefined, isLoading: false, isLoadingError: false, isRefetchError: false, error: null, ...over };
}
```

## A refresh that fails keeps the body, and says it is out of date

The reported bug, in one example: the card loaded, the box restarted, the
refetch got 502s until its retries ran out. `data` is still in the cache — it
must still be on screen.

```ts
const gateway = new BoxUnreachableError({ status: 502 });
const state = resolveLoadState(query({ data: "the card body", isRefetchError: true, error: gateway }));

state.value
=> the card body

state.error
=> null

state.stale?.headline
=> The box did not answer — it may be restarting.
```

The transport fact is kept as supporting detail under the headline.

```ts continue
state.stale?.detail
=> HTTP 502 from the gateway
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

## Describing a failure

Which failures are retried, and for how long, is decided in the transport
(`trpc-transient.doctest.md`); by the time a failure reaches this function the
retries are over. It recognizes the unreachable box by its class, whether it
arrives bare (the text loader) or as the `cause` of a tRPC client error. A
network failure reports that nothing answered at all.

```ts
JSON.stringify(describeQueryFailure(new BoxUnreachableError({ status: null, cause: new TypeError("Failed to fetch") })))
=> {"headline":"The box did not answer — it may be restarting.","detail":"Failed to fetch"}

describeQueryFailure({ message: "wrapped by the link", cause: new BoxUnreachableError({ status: 503 }) }).detail
=> HTTP 503 from the gateway
```

Every other failure is an answer from the box, and keeps its own message. That
includes a parse complaint: once gateways are classified by status, a malformed
body can only come from our own API, and is a bug to look at.

```ts
describeQueryFailure({ message: "Card not found: Foo.card" }).headline
=> Card not found: Foo.card

describeQueryFailure({ message: `Unexpected token 'x' at position 4` }).headline
=> Unexpected token 'x' at position 4
```
