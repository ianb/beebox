# Chat Review: the span journal

`src/core/chat/review/span.ts` decides which slice of a transcript has not yet
been folded into a session's account.

The journal records the **identity** of the last entry read (`endUuid`) plus a
hash of every uuid before it (`prefixHash`) — never a bare index. Transcripts
are SDK-owned and get rewritten (auto-compaction, `--resume` forks), and
`parseSessionLog` slices positionally, so an index alone silently shifts under
a rewrite that keeps the total the same.

```ts setup
import {
  appliedSpanFor,
  computeSpanId,
  prefixHash,
  resolveSpan,
  spanSize,
} from "../../../../src/core/chat/review/span.js";

const NOW = new Date("2026-07-28T04:00:00Z");

/** A minimal parsed entry — uuid is what the journal keys on. */
function entry(uuid: string, text: string) {
  return {
    uuid,
    type: "user" as const,
    timestamp: "2026-07-28T03:00:00Z",
    content: [{ type: "text" as const, text }],
  };
}

const a = entry("u-a", "first");
const b = entry("u-b", "second");
const c = entry("u-c", "third");
const d = entry("u-d", "fourth");
```

## No journal yet: bootstrap over the whole transcript

A session nobody has reviewed reads from the top. This is also how an existing
long session enters the system — one pass over everything, rather than replaying
its history span by span.

```ts
const fresh = resolveSpan([a, b, c], null);
fresh.bootstrap
=> no-journal

fresh.entries.map((e) => e.uuid).join(",")
=> u-a,u-b,u-c

fresh.endIndex
=> 2
```

## Normal advance: only what arrived since the boundary

With a journal pointing at `u-b`, the span is everything after it.

```ts
const applied = appliedSpanFor({ sessionId: "s1", entries: [a, b], endIndex: 1, now: NOW });
applied.endUuid
=> u-b

const next = resolveSpan([a, b, c, d], applied);
next.bootstrap
=> null

next.entries.map((e) => e.uuid).join(",")
=> u-c,u-d
```

A transcript that hasn't grown yields an empty span, which the size gate then
rejects — nothing is re-read and no model is called.

```ts continue
const unchanged = resolveSpan([a, b], applied);
JSON.stringify({ bootstrap: unchanged.bootstrap, entries: unchanged.entries.length })
=> {"bootstrap":null,"entries":0}
```

## The boundary entry is gone: history was rewritten wholesale

```ts
const applied = appliedSpanFor({ sessionId: "s1", entries: [a, b], endIndex: 1, now: NOW });

// The SDK replaced the transcript; `u-b` no longer exists.
const rewritten = resolveSpan([entry("u-x", "summary"), entry("u-y", "later")], applied);
rewritten.bootstrap
=> boundary-missing
```

## The boundary survives but its history changed — the case an index misses

This is the important one. The boundary uuid is still present at the same index
and the total is unchanged, so an index-based cursor would happily continue and
skip the rewritten material. The prefix hash catches it.

```ts
const applied = appliedSpanFor({ sessionId: "s1", entries: [a, b], endIndex: 1, now: NOW });

// `u-b` is still at index 1, total still 2 — but `u-a` was replaced.
const mutated = [entry("u-z", "replaced"), b, c];
mutated[1].uuid === applied.endUuid
=> true

resolveSpan(mutated, applied).bootstrap
=> prefix-rewritten
```

The whole transcript comes back as the span, so nothing is lost — the caller
keeps the existing account, which is now the only record of what was rewritten.

```ts continue
resolveSpan(mutated, applied).entries.map((e) => e.uuid).join(",")
=> u-z,u-b,u-c
```

## The content changed but every uuid stayed the same

The subtler rewrite. Identity is unchanged all the way through the boundary, so
a uuid-only hash would call this history untouched and skip the edited material
forever. The prefix hash covers rendered content, so it does not.

```ts
const applied = appliedSpanFor({ sessionId: "s1", entries: [a, b], endIndex: 1, now: NOW });

// Same uuids, same positions, same count — different words.
const edited = [entry("u-a", "first, REVISED"), b, c];
edited.map((e) => e.uuid).join(",")
=> u-a,u-b,u-c

resolveSpan(edited, applied).bootstrap
=> prefix-rewritten
```

## An entry with no uuid can't anchor a journal

`parseSessionLog` defaults a missing uuid to `""`, which is not an identity —
several entries could carry it. Rather than resolve to the wrong one, such a
boundary is refused at both ends: no journal entry is written, and one that
somehow exists forces a bootstrap.

```ts
appliedSpanFor({ sessionId: "s1", entries: [entry("", "anonymous")], endIndex: 0, now: NOW })
=> null

resolveSpan([a, b], {
  spanId: "x", endUuid: "", endIndex: 0, prefixHash: "y", at: "2026-07-28T04:00:00Z",
}).bootstrap
=> boundary-missing
```

## Span ids are stable, and distinguish what they should

The id is the idempotency key written to the husk, so identical inputs must
produce an identical id across runs — and a different boundary or a different
history must not collide.

```ts
const p = prefixHash([a, b], 1);
computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: p })
  === computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: p })
=> true

// Different session, same boundary.
computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: p })
  === computeSpanId({ sessionId: "s2", endUuid: "u-b", prefixHash: p })
=> false

// Same boundary, rewritten history.
computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: p })
  === computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: prefixHash([entry("u-z", "x"), b], 1) })
=> false
```

`appliedSpanFor` returns null for an empty transcript rather than inventing a
boundary.

```ts continue
appliedSpanFor({ sessionId: "s1", entries: [], endIndex: -1, now: NOW })
=> null
```

## Span size is measured pre-elision

The gate cannot use `renderSessionCompact`'s output: that is clamped at 40k
chars, so a long session's rendered length stops growing and it would never
qualify again. `spanSize` renders uncapped.

```ts
const long = Array.from({ length: 500 }, (_, i) => entry(`u-${i}`, "x".repeat(200)));
const size = spanSize(resolveSpan(long, null));
size > 40_000
=> true
```
