# Audio Cache

`AudioCache` is the optimistic in-memory store for generated TTS audio, used so
replaying speech doesn't re-hit the TTS backend. It is byte-bounded with LRU
eviction so it can never grow without limit.

```ts setup
import { AudioCache, cacheKey } from "../src/frontend/src/lib/audio-cache.js";
```

## Cache keys

A key is derived from voice + instructions + text (joined with a NUL separator
that can't appear in any input, so distinct triples can't collide). It is
deterministic and contains each part:

```
const k = cacheKey({ text: "hello", voice: "marin", instructions: "calm" });
[k.includes("marin"), k.includes("calm"), k.includes("hello")].join(",")
=> true,true,true
```

``` continue
cacheKey({ text: "hi", voice: "marin", instructions: "x" }) === cacheKey({ text: "hi", voice: "marin", instructions: "x" })
=> true
```

Distinct inputs produce distinct keys (so a re-voiced generation is its own
entry):

```
const a = cacheKey({ text: "hi", voice: "marin", instructions: "calm" });
const b = cacheKey({ text: "hi", voice: "coral", instructions: "calm" });
a === b
=> false
```

## Store and retrieve

```
const cache = new AudioCache({ maxBytes: 100 });
cache.set("a", new ArrayBuffer(40));
cache.count
=> 1

cache.byteLength
=> 40
```

A hit returns the buffer; a miss returns undefined:

``` continue
cache.get("a")?.byteLength
=> 40

cache.get("missing")
=> undefined
```

## Byte-budget eviction (LRU)

Adding past the budget evicts the least-recently-used entry:

```
const cache = new AudioCache({ maxBytes: 100 });
cache.set("a", new ArrayBuffer(40));
cache.set("b", new ArrayBuffer(40));
cache.set("c", new ArrayBuffer(40));
cache.has("a")
=> false

cache.has("c")
=> true

cache.byteLength
=> 80
```

## A `get` bumps recency

Reading an entry makes it most-recently-used, so a later insertion evicts a
different (now-oldest) entry instead:

```
const cache = new AudioCache({ maxBytes: 100 });
cache.set("a", new ArrayBuffer(40));
cache.set("b", new ArrayBuffer(40));
cache.get("a");
cache.set("c", new ArrayBuffer(40));
cache.has("a")
=> true

cache.has("b")
=> false
```

## Oversized buffers are not cached

A single buffer larger than the whole budget is dropped rather than cached
(caching it would immediately blow the budget):

```
const cache = new AudioCache({ maxBytes: 100 });
cache.set("big", new ArrayBuffer(200));
cache.has("big")
=> false

cache.count
=> 0
```
