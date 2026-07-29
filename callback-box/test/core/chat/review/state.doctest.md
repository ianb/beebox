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
  isSessionExhausted,
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

## Failures accumulate until the session is left alone

A session whose reviewer keeps failing eventually stops being retried, so one
broken transcript can't burn a model call every night forever.

```ts
const state = emptyReviewState();
state.sessions["flaky"] = { applied: {}, titleOwner: "unmanaged", titleHash: null, attempts: 1 };
isSessionExhausted(state, "flaky")
=> false

state.sessions["flaky"].attempts = MAX_REVIEW_ATTEMPTS;
isSessionExhausted(state, "flaky")
=> true
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
