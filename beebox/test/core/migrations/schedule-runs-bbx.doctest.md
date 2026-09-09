# schedule-runs-bbx — scheduled scripts stop calling the retired `cb`

The rename left every box's own `runs:` lines pointing at `cb`, and once the
`cb` tombstone landed those jobs failed loudly. The migration rewrites exactly
the command word.

```ts setup
import { rewriteRuns } from "../../../scripts/migrate/schedule-runs-bbx.js";
```

Top-level and nested `runs:` both move; arguments and everything else stay:

```ts
rewriteRuns([
  "---",
  "title: Check RSS",
  "runs: cb wakeup --connector rss",
  "then:",
  "  - when: new-items",
  "    runs: cb process-news",
  "---",
].join("\n"))
=> ---
title: Check RSS
runs: bbx wakeup --connector rss
then:
  - when: new-items
    runs: bbx process-news
---
```

Only the command word `cb` matches — a command that merely starts with those
letters, an argument that mentions `cb`, or a card already on `bbx` is left
alone, so a second run is a no-op:

```ts
const already = "runs: bbx procedure run x\nruns: cbx --flag\nnote: use cb here\nruns: bbx tick cb\n";
JSON.stringify([rewriteRuns(already) === already, rewriteRuns(rewriteRuns("runs: cb tick")) === "runs: bbx tick"])
=> [true,true]
```
