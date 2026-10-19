// # What a file view shows when a load or a refresh fails (`file-load-state.ts`)
//
// `resolveLoadState` folds a React Query result into one of four outcomes:
// loading, a hard error, the loaded body, or the loaded body marked out of date.
// The rule it exists to enforce: **an error may only take content away when there
// is no content.** Before this, `useFileData` checked the error first, so a single
// background refetch that failed replaced an already-rendered card with an error
// message and never came back.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { resolveLoadState, describeQueryFailure } from "../../src/lib/file-load-state.js";
import { BoxUnreachableError } from "../../src/lib/trpc/transient.js";

/** A query result with everything quiet; each example overrides what it cares about. */
function query(over: Partial<Parameters<typeof resolveLoadState<string>>[0]>) {
  return { data: undefined, isLoading: false, isLoadingError: false, isRefetchError: false, error: null, ...over };
}

// ## A refresh that fails keeps the body, and says it is out of date
//
// The reported bug, in one example: the card loaded, the box restarted, the
// refetch got 502s until its retries ran out. `data` is still in the cache — it
// must still be on screen.
void test("The reported bug, in one example:", async (t) => {
  const gateway = new BoxUnreachableError({ status: 502 });
  const state = resolveLoadState(query({ data: "the card body", isRefetchError: true, error: gateway }));

  t.check(state.value, "the card body");

  t.check(state.error, null);

  t.check(state.stale?.headline, "The box did not answer — it may be restarting.");

  // The transport fact is kept as supporting detail under the headline.

  t.check(state.stale?.detail, "HTTP 502 from the gateway");
});

// ## A first load that fails is still an error
//
// Nothing is cached, so there is nothing to protect.
void test("Nothing is cached, so there is nothing to protect.", async (t) => {
  const state = resolveLoadState(query({ isLoadingError: true, error: { message: "Card not found: Foo.card" } }));

  t.check(state.value, null);

  t.check(state.error?.headline, "Card not found: Foo.card");

  // A caller that matches on the underlying message — `FileView`'s missing-card
  // branch — reads `detail`, which is the message verbatim.

  t.check(state.error?.detail, "Card not found: Foo.card");
});

// ## A successful load, and a refresh that succeeds after failing
void test("A successful load, and a refresh that succeeds after failing", async (t) => {
  const loaded = resolveLoadState(query({ data: "body" }));
  t.check(loaded, {
    value: "body",
    loading: false,
    error: null,
    stale: null,
  });

  // React Query clears `isRefetchError` on the next success, so recovery needs no
  // handling of its own — the stale marker simply stops being returned.

  t.check(resolveLoadState(query({ data: "newer body", isRefetchError: false, error: null })).stale, null);
});

// ## Loading, and the genuinely-empty result
void test("Loading, and the genuinely-empty result", async (t) => {
  t.check(resolveLoadState(query({ isLoading: true })).loading, true);

  t.check(resolveLoadState(query({})), {
    value: null,
    loading: false,
    error: null,
    stale: null,
  });
});

// ## Describing a failure
//
// Which failures are retried, and for how long, is decided in the transport
// (`src/frontend/test/lib/trpc/transient.trpc-transient.test.ts`); by the time a failure reaches this function the
// retries are over. It recognizes the unreachable box by its class, whether it
// arrives bare (the text loader) or as the `cause` of a tRPC client error. A
// network failure reports that nothing answered at all.
void test("Which failures are retried, and for how long, is decided in the transport (tr...", async (t) => {
  t.check(describeQueryFailure(new BoxUnreachableError({ status: null, cause: new TypeError("Failed to fetch") })), {
    headline: "The box did not answer — it may be restarting.",
    detail: "Failed to fetch",
  });

  t.check(describeQueryFailure(new Error("wrapped by the link", { cause: new BoxUnreachableError({ status: 503 }) })).detail, "HTTP 503 from the gateway");
});

// Every other failure is an answer from the box, and keeps its own message. That
// includes a parse complaint: once gateways are classified by status, a malformed
// body can only come from our own API, and is a bug to look at.
void test("Every other failure is an answer from the box, and keeps its own message.", async (t) => {
  t.check(describeQueryFailure({ message: "Unexpected token 'x' at position 4" }).headline, "Unexpected token 'x' at position 4");
});
