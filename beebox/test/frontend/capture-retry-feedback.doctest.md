# Retry feedback in the capture overlay

Tapping Retry on failed uploads used to produce nothing visible: the failure
line disappeared while the replay ran, so the only way to learn whether the tap
had registered was to wait and see whether the failures came back. This reducer
is the missing half — the banner states that a retry started, and reports how
the batch ended.

```ts setup
import { nextRetryFeedback } from "../../src/frontend/src/pages/capture/retry-feedback.js";

const idle = { phase: "idle" };
// Fold a sequence of events, showing the phase after each.
const trace = (events) => {
  let state = idle;
  return events.map((e) => (state = nextRetryFeedback(state, e))).map((s) => s.phase).join(" → ");
};
```

## A retry that works

```ts
trace([
  { type: "retry-tapped", count: 3 },
  { type: "settled", failed: 0 },
  { type: "expire" },
])
=> retrying → recovered → idle
```

The count is carried so the banner can say what it is retrying, rather than
just that something is happening:

```ts
JSON.stringify(nextRetryFeedback(idle, { type: "retry-tapped", count: 3 }))
=> {"phase":"retrying","count":3}
```

## A retry that doesn't

The link is still down; the banner has to say the transfers failed *again*,
which is the difference between "you did nothing" and "it didn't work":

```ts
trace([
  { type: "retry-tapped", count: 3 },
  { type: "settled", failed: 2 },
  { type: "retry-tapped", count: 2 },
  { type: "settled", failed: 0 },
])
=> retrying → failed-again → retrying → recovered
```

## What it refuses to claim

A tap with nothing to replay changes nothing — "retrying 0 uploads" is the same
kind of lie as showing no reaction at all:

```ts
nextRetryFeedback(idle, { type: "retry-tapped", count: 0 }).phase
=> idle
```

Transfers settling when no retry is in flight is the ordinary first-attempt
path, and says nothing about a retry:

```ts
nextRetryFeedback(idle, { type: "settled", failed: 4 }).phase
=> idle
```

And the recovered notice only expires from `recovered` — a stray timer can't
wipe an in-flight retry or a live failure off the banner:

```ts
[
  nextRetryFeedback({ phase: "retrying", count: 2 }, { type: "expire" }).phase,
  nextRetryFeedback({ phase: "failed-again", count: 2 }, { type: "expire" }).phase,
].join(" / ")
=> retrying / failed-again
```
