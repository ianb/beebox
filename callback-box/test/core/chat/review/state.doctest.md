# Chat Review: journal state

`.callback-box/chat-review/state.json` records, per session, which transcript
spans have been folded into the account and who owns the husk's title.

Unlike the retrospective walker's state — a terminal "done, never look again"
flag — this is a journal: a session is re-read every time it grows, so what is
stored is a boundary, not a finished marker.

Losing this file is cheap by design: the worst case is one redundant pass per
session, and the applied-span id on the husk turns even that into a no-op.

```ts setup
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import {
  emptyReviewState,
  loadReviewState,
  MAX_REVIEW_ATTEMPTS,
  saveReviewState,
  sessionState,
} from "../../../../src/core/chat/review/state.js";
```

## An unseen session reads as a bootstrap, with no journal entry

```ts
const state = emptyReviewState();
JSON.stringify(sessionState(state, "never-seen"))
=> {"applied":{},"titleOwner":"unmanaged","titleHash":null,"attempts":0}
```

## Giving up is scoped to one span, not the whole session

A session whose reviewer keeps failing stops being retried — but only for the
span that failed. `failedSpanId` records which one, so new conversation always
gets a fresh attempt and a couple of nights of provider trouble can't retire a
session for good.

```ts
MAX_REVIEW_ATTEMPTS
=> 2

const state = emptyReviewState();
state.sessions["flaky"] = {
  applied: {}, titleOwner: "unmanaged", titleHash: null,
  attempts: MAX_REVIEW_ATTEMPTS, failedSpanId: "span-abc",
};
// The run gives up only when both the count AND the span match.
const s = sessionState(state, "flaky");
JSON.stringify({
  sameSpan: s.attempts >= MAX_REVIEW_ATTEMPTS && s.failedSpanId === "span-abc",
  newSpan: s.attempts >= MAX_REVIEW_ATTEMPTS && s.failedSpanId === "span-xyz",
})
=> {"sameSpan":true,"newSpan":false}
```

## Round-trips through disk

```ts
const box = await makeTmpBox();
const state = emptyReviewState();
state.lastRunAt = "2026-07-28T04:00:00Z";
state.sessions["s1"] = {
  applied: {
    metadata: {
      spanId: "abc123", endUuid: "u-9", endIndex: 8,
      prefixHash: "def456", at: "2026-07-28T04:00:00Z",
    },
  },
  titleOwner: "generated",
  titleHash: "hash-of-title",
  attempts: 0,
};
await saveReviewState(box.root, state);

const reloaded = await loadReviewState(box.root);
JSON.stringify(reloaded.sessions["s1"].applied.metadata.endUuid)
=> "u-9"
```

```ts continue
reloaded.sessions["s1"].titleOwner
=> generated
```

## Missing, corrupt, and mis-shaped files all start fresh

A malformed state file must not stop the night's run — re-reviewing is
recoverable, refusing to run is not.

```ts continue
await box.write(".callback-box/chat-review/state.json", "{not json at all");
JSON.stringify(await loadReviewState(box.root))
=> {"lastRunAt":null,"sessions":{}}
```

```ts continue
await box.write(".callback-box/chat-review/state.json", JSON.stringify({ sessions: "wrong shape" }));
JSON.stringify(await loadReviewState(box.root))
=> {"lastRunAt":null,"sessions":{}}
```

```ts continue
const fresh = await makeTmpBox();
JSON.stringify(await loadReviewState(fresh.root))
=> {"lastRunAt":null,"sessions":{}}

await fresh.cleanup();
```

```ts cleanup
await box.cleanup();
```
