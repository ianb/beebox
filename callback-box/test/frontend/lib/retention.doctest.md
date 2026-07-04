# RetentionStore — emission-keyed audio retention

`createRetentionStore` (docs/plans/input-extraction.md, chunk 5) replaces
the old single-slot "last message audio" cache with one keyed by emission
id, so a send never has to clear anything — `latest()` is well-defined by
construction. v1 policy: memory-only, oldest evicted first once past
capacity.

```ts setup
import { createRetentionStore } from "../../../src/frontend/src/input/retention.js";
```

## Keying: retain and get by emission id

```ts
const store = createRetentionStore<string>({ capacity: 5 });
store.retain("msg-1", "audio-for-1");
store.retain("msg-2", "audio-for-2");
store.get("msg-1")
=> audio-for-1

store.get("msg-2")
=> audio-for-2

store.size()
=> 2
```

## Unknown id

```ts continue
store.get("msg-never-retained")
=> undefined
```

## `latest()` returns the most recently retained entry

```ts continue
JSON.stringify(store.latest())
=> {"emissionId":"msg-2","audio":"audio-for-2"}
```

Re-retaining an id already present moves it to "most recent" too — it
doesn't just overwrite in place at its old position:

```ts continue
store.retain("msg-1", "audio-for-1-updated");
JSON.stringify(store.latest())
=> {"emissionId":"msg-1","audio":"audio-for-1-updated"}

store.size()
=> 2
```

## Eviction at capacity: oldest drops first

```ts
const small = createRetentionStore<string>({ capacity: 2 });
small.retain("a", "A");
small.retain("b", "B");
small.retain("c", "C");
small.size()
=> 2

small.get("a")
=> undefined

small.get("b")
=> B

small.get("c")
=> C

JSON.stringify(small.latest())
=> {"emissionId":"c","audio":"C"}
```

## Empty store

```ts
const empty = createRetentionStore<string>({ capacity: 5 });
empty.latest()
=> undefined

empty.size()
=> 0
```
