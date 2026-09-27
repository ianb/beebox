# Schedule memory: the cursor, the carry, and the defer file

A scheduled `runs:` command sees its own previous run through five
environment variables (`src/core/schedule/memory.ts`): `BBX_SINCE_COMMIT` (the
box HEAD at the previous run), `BBX_SINCE_TIME`, `BBX_CARRY_IN`, and two temp
paths, `BBX_CARRY_OUT` and `BBX_DEFER_FILE`. A sixth, `BBX_SCHEDULE_NAME`,
names the schedule. The cursor and the carry live in
the schedule's machine-local state. See docs/implemented-plans/notifications.md (Track D).

```ts setup
import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { runTick } from "../../src/cli/commands/tick.js";
import { loadScriptState } from "../../src/core/schedule/state.js";
import { cursorAdvances } from "../../src/core/schedule/memory.js";
import { runShell } from "../../src/core/procedure/shell.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";

const head = (box) => execSync("git rev-parse HEAD", { cwd: box.root }).toString().trim();

/** Force one run of `watch`, capturing the tick's warnings. */
async function tick(box) {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const result = await runTick(box.root, { quiet: true, script: "watch", force: true });
    return { status: result.scripts[0]?.status, warnings };
  } finally {
    console.warn = origWarn;
  }
}

// The script records what it saw: the cursor as a commit subject, the time,
// the carry, the cards added since the cursor, and the defer path. It writes
// the carry named in the box's `_tmp/next-carry`, when there is one, and fails
// when `_tmp/fail` exists.
const WATCH = `---
cron: "0 0 1 1 *"
runs: >-
  mkdir -p _tmp &&
  { echo "since: $(git log -1 --format=%s "$BBX_SINCE_COMMIT")";
    echo "time: \${BBX_SINCE_TIME:-(none)}";
    echo "carry: \${BBX_CARRY_IN:-(none)}";
    echo "added: [$(git diff --name-only --diff-filter=A "$BBX_SINCE_COMMIT" HEAD | paste -sd, -)]";
  } > _tmp/seen.txt &&
  echo "$BBX_DEFER_FILE" > _tmp/defer-path.txt &&
  echo "$BBX_SCHEDULE_NAME" > _tmp/schedule-name.txt &&
  { [ ! -f _tmp/next-carry ] || cp _tmp/next-carry "$BBX_CARRY_OUT"; } &&
  [ ! -f _tmp/fail ]
---
`;
```

## The first run sees nothing; later runs see what came since

Before the first run the cursor is set to HEAD and saved, so the first run
sees no changes: a schedule is about the future. The carry it writes is read
back on the next run.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/notes/old.memo.card", "---\ntitle: Old\n---\n");
await box.write("_config/schedules/watch.scheduled-script.card", WATCH);
box.commitAll("setup");
await box.write("_tmp/next-carry", "told them about old");

(await tick(box)).status
=> ran

await box.read("_tmp/seen.txt")
=> since: setup
time: (none)
carry: (none)
added: []
```

`BBX_SCHEDULE_NAME` is the card's stem, so a `bbx notify` in the pipeline
names the schedule as its source (`schedule:watch`).

```ts continue
(await box.read("_tmp/schedule-name.txt")).trim()
=> watch
```

The run succeeded, so the cursor moved to HEAD, and the carry is in state:

```ts continue
const first = await loadScriptState(box.root, "watch");
[first.lastCommit === head(box), first.carry].join(" ")
=> true told them about old
```

A card arrives. The second run sees it, the first run's time, and the carry.
It writes no carry file, so the carry is kept.

```ts continue
await fs.rm(box.path("_tmp/next-carry"));
await box.write("_content/notes/new.memo.card", "---\ntitle: New\n---\n");
box.commitAll("add new");
(await tick(box)).status
=> ran

(await box.read("_tmp/seen.txt")).replace(first.lastRun, "<first run>")
=> since: setup
time: <first run>
carry: told them about old
added: [_content/notes/new.memo.card]

(await loadScriptState(box.root, "watch")).carry
=> told them about old
```

The defer file is a fresh path each run, gone after it:

```ts continue
const deferPath = (await box.read("_tmp/defer-path.txt")).trim();
await fs.access(deferPath).then(() => "present", () => "gone")
=> gone
```

## A failed run holds the cursor

A failure keeps `lastCommit`, so the next run sees the same cards again and
nothing is dropped.

```ts continue
const beforeFailure = (await loadScriptState(box.root, "watch")).lastCommit;
await box.write("_content/notes/third.memo.card", "---\ntitle: Third\n---\n");
box.commitAll("add third");
await box.write("_tmp/fail", "");
(await tick(box)).status
=> error

const failed = await loadScriptState(box.root, "watch");
`${failed.lastResult} ${failed.lastCommit === beforeFailure}`
=> failure true

await fs.rm(box.path("_tmp/fail"));
(await tick(box)).status
=> ran

(await box.read("_tmp/seen.txt")).split("\n").find((l) => l.startsWith("added:"))
=> added: [_content/notes/third.memo.card]
```

## A carry over 4 KB is truncated, with a warning

```ts continue
await box.write("_tmp/next-carry", "x".repeat(5000));
const big = await tick(box);
big.warnings
=> [
  "  watch: carry of 5000 bytes truncated to 4096"
]

(await loadScriptState(box.root, "watch")).carry.length
=> 4096
```

```ts cleanup
await box.cleanup();
```

## When the cursor advances

`success` advances, and so does a deferral whose items were seen (`no-change`,
`no-pass`). A failure, an inconclusive run, and a deferral for budget, an
unavailable judge, or missing configuration hold it. The tick records the
reason from an exit-75 marker (`test/cli/commands/tick-defer.doctest.md`); a
`deferred` with no reason (an engine outage) holds it too.

```ts
[
  cursorAdvances("success", null),
  cursorAdvances("deferred", "no-change"),
  cursorAdvances("deferred", "no-pass"),
  cursorAdvances("deferred", "budget"),
  cursorAdvances("deferred", "jev-unavailable"),
  cursorAdvances("deferred", null),
  cursorAdvances("failure", "no-change"),
  cursorAdvances("inconclusive", null),
].join(" ")
=> true true true false false false false false
```

## A procedure's shells see the variables

`bbx procedure run` inside a schedule inherits the tick's environment, and its
shell steps rebuild their environment through the script-env allowlist
(`src/core/procedure/shell.ts`), which lists the six names.

```ts
const box = await makeTmpBox();
const names = ["BBX_SINCE_COMMIT", "BBX_SINCE_TIME", "BBX_CARRY_IN", "BBX_CARRY_OUT", "BBX_DEFER_FILE", "BBX_SCHEDULE_NAME"];
for (const name of names) process.env[name] = `value-of-${name}`;
const shell = await runShell(box.root, names.map((n) => `echo "$${n}"`).join("\n"));
for (const name of names) delete process.env[name];
shell.stdout
=> value-of-BBX_SINCE_COMMIT
value-of-BBX_SINCE_TIME
value-of-BBX_CARRY_IN
value-of-BBX_CARRY_OUT
value-of-BBX_DEFER_FILE
value-of-BBX_SCHEDULE_NAME
```

```ts cleanup
await box.cleanup();
```
