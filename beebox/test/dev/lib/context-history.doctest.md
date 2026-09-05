# Context-size history ledger

`appendRun` folds one audit run's context measurements into the history,
keyed by box → audit id → entries (oldest first). It's pure: the prior
history object is never mutated, so successive runs accumulate.

```ts setup
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRun, loadHistory, recordRun } from "../../../src/dev/lib/context-history.js";

const stats = (initialTokens, peakTokens, turnCount) => ({
  initialTokens, peakTokens, addedTokens: peakTokens - initialTokens, turnCount,
});
const run = (box, date, measurements) => ({
  box, date, boxCommit: "boxsha", repoCommit: "reposha", measurements,
});

async function captureWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const value = await fn();
    return { value, warnings };
  } finally {
    console.warn = original;
  }
}
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

## A malformed entry is warned about and skipped, not fatal to the whole ledger

`loadHistory` parses the outer box → audit id → entries shape strictly, but
validates each entry individually — a single row missing required fields
(the 2026-08-23 `points-at-ui-path-vs-control` merge-conflict incident, where
a resolution silently dropped an entry's `added`/`turns` lines) is warned
about and dropped, while every other entry — in the same audit id or a
different one — still loads.

```ts
const dir = await mkdtemp(join(tmpdir(), "context-history-"));
const historyPath = join(dir, "context-history.yaml");
await writeFile(
  historyPath,
  [
    "test1:",
    "  broken-audit:",
    "    - date: 2026-08-23T17:03:41.065Z",
    "      boxCommit: boxsha",
    "      repoCommit: reposha",
    "      initial: 52302",
    "      peak: 52302",
    "  fine-audit:",
    "    - date: 2026-08-23T17:03:41.065Z",
    "      boxCommit: boxsha",
    "      repoCommit: reposha",
    "      initial: 41000",
    "      peak: 41000",
    "      added: 0",
    "      turns: 1",
    "",
  ].join("\n"),
  "utf-8",
);
const { value: loaded, warnings } = await captureWarnings(() => loadHistory(historyPath));
JSON.stringify({
  broken: loaded.test1["broken-audit"],
  fineCount: loaded.test1["fine-audit"].length,
  warned: warnings.some((w) => w.includes("broken-audit") && w.includes("index 0")),
})
=> {"broken":[],"fineCount":1,"warned":true}
```

## `recordRun` still records a new measurement past a malformed neighbor

The knowledge-audit harness calls `recordRun` after every run, so the row
that blocked recording on 2026-08-23 must not block a later, unrelated
audit's measurement from being appended and written back.

```ts continue
await recordRun({
  historyPath,
  box: "test1",
  date: "2026-08-24T00:00:00Z",
  boxCommit: "boxsha2",
  repoCommit: "reposha2",
  measurements: [{ auditId: "new-audit", stats: stats(30000, 31000, 2) }],
});
const after = await loadHistory(historyPath);
JSON.stringify({
  broken: after.test1["broken-audit"],
  newAuditRecorded: after.test1["new-audit"][0].initial,
})
=> {"broken":[],"newAuditRecorded":30000}
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
