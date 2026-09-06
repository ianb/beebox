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

```ts cleanup
await fs.rm(dir, { recursive: true, force: true });
```
