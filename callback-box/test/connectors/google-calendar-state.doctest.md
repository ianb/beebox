# Calendar syncToken delta merge

`mergeSyncTokens` (`src/connectors/google-calendar-state.ts`) resolves one
save's per-calendar cursor changes against freshly-loaded transient state,
relative to a `snapshot` — the tokens as of this sync's LAST save (the baseline
is advanced after every save; see `SyncTokenSnapshot`). This keeps a concurrent
sync's advance of a calendar this save didn't touch, while still honoring this
save's own updates and deletions.

```ts setup
import { mergeSyncTokens } from "../../src/connectors/google-calendar-state.js";
```

## Per-key resolution: updated wins, untouched defers, deleted stays deleted

This save advanced `primary` and cleared `work` (410 → forced full resync);
meanwhile a concurrent sync advanced `family` in fresh. `primary` takes this
save's value, `family` survives from fresh, and `work` is removed — a plain
spread would have resurrected the stale token.

```ts
const merged = mergeSyncTokens({
  snapshot: { primary: "t0", work: "t0", family: "t0" },
  fresh: { primary: "t0", work: "t0", family: "t1-concurrent" },
  working: { primary: "t1-mine", family: "t0" },
});
JSON.stringify(merged)
=> {"primary":"t1-mine","family":"t1-concurrent"}
```

## Multi-save round-trip: a re-stored token is a delta against the LAST save

The 410 path saves twice: first with the token cleared, then (after the full
resync) with a fresh token. Because the baseline advances to each save, the
second save's re-stored token differs from its (cleared) baseline and wins —
against a fixed start-of-sync snapshot it would look "unchanged" and be lost.

```ts
// Save 1: token cleared. Baseline was {primary: t0}.
const afterClear = mergeSyncTokens({
  snapshot: { primary: "t0" },
  fresh: { primary: "t0" },
  working: {},
});
JSON.stringify(afterClear)
=> {}
```

```ts continue
// Save 2: full resync re-stored the same token value. Baseline is now {} (the
// last save), so the re-store is a visible delta and lands.
const afterResync = mergeSyncTokens({
  snapshot: {},
  fresh: {},
  working: { primary: "t0" },
});
JSON.stringify(afterResync)
=> {"primary":"t0"}
```
