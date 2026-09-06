# What `bbx init` says

`bbx init` is a step every scripted path runs — `deploy/add-box.sh` runs it
twice to provision one box — so its output is read for the parts that matter,
not admired. The monorepo's rule is that routine success prints nothing and
anomalies print, and a re-init that changed nothing is routine success.

A FRESH init is the exception, and keeps its full report: the list of what you
got is the whole point the first time.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runInit } from "../../../src/cli/commands/init.js";

/** Run `fn` with console.log captured; returns the lines it printed. */
async function withOutput(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n").split("\n");
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-init-output-"));
const boxRoot = path.join(dir, "abox");
```

## A fresh init reports what it created

```ts
const fresh = await withOutput(() => runInit(boxRoot, { branch: "main" }));
JSON.stringify({
  banner: fresh[0].startsWith("Initialized Bee Box at "),
  structure: fresh.includes("Directory structure created:"),
  procedures: fresh.some((l) => l.startsWith("Installed 4 procedure(s)")),
  schedules: fresh.some((l) => l.startsWith("Installed 6 schedule(s)")),
  personality: fresh.includes("Installed _config/main.personality.card"),
  nextStep: fresh.some((l) => l.includes("Next: run 'bbx serve'")),
})
=> {"banner":true,"structure":true,"procedures":true,"schedules":true,"personality":true,"nextStep":true}
```

## A re-init that changed nothing says nothing

Not one line — no "ensured the directories exist", no "generated the docs", no
"built the search index". Those name the steps that ran, which is not news.

```ts continue
const quiet = await withOutput(() => runInit(boxRoot, { branch: "main" }));
quiet.join("")
=> 
```

## A re-init that DID change something says only that

The header earns its line by having a list under it — a bare "Installed
main.personality.card" would not say which box.

```ts continue
await fs.rm(path.join(boxRoot, "_config/main.personality.card"));
const refilled = await withOutput(() => runInit(boxRoot, { branch: "main" }));
JSON.stringify({
  header: refilled[0].startsWith("Updated Bee Box at "),
  refilled: refilled.includes("Installed _config/main.personality.card"),
  lines: refilled.length,
})
=> {"header":true,"refilled":true,"lines":2}
```

## A fresh init never says "Updated"

The two headers are mutually exclusive, and the flag that reaches furthest into
the run — `--docid-debug`, whose marker is written after the fresh flush — is
the one that used to produce both.

```ts continue
const freshBox = path.join(dir, "bbox");
const both = await withOutput(() => runInit(freshBox, { branch: "main", docidDebug: true }));
JSON.stringify({
  initialized: both.filter((l) => l.startsWith("Initialized Bee Box at ")).length,
  updated: both.filter((l) => l.startsWith("Updated Bee Box at ")).length,
  docid: both.some((l) => l.startsWith("DOCID markers enabled")),
})
=> {"initialized":1,"updated":0,"docid":true}
```

## Clearing the DOCID marker is reported too

The marker persists across runs, so turning it off is as much a change as
turning it on. `--no-docid-debug` had to be declared for this to be reachable
from the CLI at all — the help text promised it, and commander does not derive
it from `--docid-debug`.

```ts continue
const cleared = await withOutput(() => runInit(freshBox, { branch: "main", docidDebug: false }));
JSON.stringify({ header: cleared[0].startsWith("Updated Bee Box at "), lines: cleared })
=> {"header":true,"lines":["Updated Bee Box at «*»","DOCID markers disabled"]}
```

## A rebuilt search index is a change, not just progress

`.beebox/` is gitignored, so an index can be absent on a box that is otherwise
untouched. The build announces itself live because it is slow enough that
silence would read as a hang, and it is also recorded — otherwise that progress
line would be the entire output of the run, naming no box.

```ts continue
await fs.rm(path.join(freshBox, ".beebox/search-index-manifest.json"));
await fs.rm(path.join(freshBox, ".beebox/search-index.json"));
const rebuilt = await withOutput(() => runInit(freshBox, { branch: "main" }));
JSON.stringify({
  progress: rebuilt.some((l) => l.startsWith("Building the search index over ")),
  header: rebuilt.some((l) => l.startsWith("Updated Bee Box at ")),
  recorded: rebuilt.includes("Built the search index in .beebox/"),
})
=> {"progress":true,"header":true,"recorded":true}
```

```ts cleanup
await fs.rm(dir, { recursive: true, force: true });
```
