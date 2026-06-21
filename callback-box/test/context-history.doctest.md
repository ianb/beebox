# Context-size history ledger

`appendRun` folds one audit run's context measurements into the history,
keyed by box → audit id → entries (oldest first). It's pure: the prior
history object is never mutated, so successive runs accumulate.

```ts setup
import { appendRun } from "../src/dev/lib/context-history.js";

const stats = (initialTokens, peakTokens, turnCount) => ({
  initialTokens, peakTokens, addedTokens: peakTokens - initialTokens, turnCount,
});
const run = (box, date, measurements) => ({
  box, date, boxCommit: "boxsha", repoCommit: "reposha", measurements,
});
```

## A first run seeds the box and audit

```ts
const h1 = appendRun({}, run("test1", "2026-06-20T00:00:00Z", [
  { auditId: "box-structure-inbox", stats: stats(41000, 41000, 1) },
]));
JSON.stringify(h1.test1["box-structure-inbox"])
=> [{"date":"2026-06-20T00:00:00Z","boxCommit":"boxsha","repoCommit":"reposha","initial":41000,"peak":41000,"added":0,"turns":1}]
```

## A later run appends to the same audit's series

The earlier entry is preserved; the new one lands after it. Watching `initial`
drop across this series is the whole point — trim, re-run, compare.

```ts continue
const h2 = appendRun(h1, run("test1", "2026-06-21T00:00:00Z", [
  { auditId: "box-structure-inbox", stats: stats(38000, 39000, 3) },
]));
h2.test1["box-structure-inbox"].map((e) => e.initial).join(" -> ")
=> 41000 -> 38000
```

## appendRun does not mutate the input history

```ts continue
h1.test1["box-structure-inbox"].length
=> 1
```

## Different boxes stay isolated

```ts continue
const h3 = appendRun(h2, run("ledger", "2026-06-21T00:00:00Z", [
  { auditId: "box-structure-inbox", stats: stats(52000, 52000, 1) },
]));
[Object.keys(h3).sort().join(","), h3.ledger["box-structure-inbox"][0].initial].join(" ")
=> ledger,test1 52000
```
