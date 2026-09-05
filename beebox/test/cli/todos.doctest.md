# `bbx todos` — read/query CLI

`src/cli/commands/todos.ts` is a thin presentation layer over the collector
(`core/todo/collect.ts`): filters (`--status`, `--assigned`, `--glob`,
`--on-plate`), a human listing grouped by plate-state, and `--json` for the
full structured records. `runTodosForBox(boxRoot, options)` is exercised
directly (same approach as `test/cli/auth-command.doctest.md`) rather than
spawning the CLI as a subprocess.

```ts setup
import { runTodosForBox } from "../../src/cli/commands/todos.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

const box = await makeTmpBox();
await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));

async function run(options) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => { logs.push(args.join(" ")); };
  try {
    await runTodosForBox(box.root, options ?? {});
  } finally {
    console.log = origLog;
  }
  return logs.join("\n");
}

function memo(frontmatterExtra, body) {
  return `---\nstatus: new\ncreated: 2026-07-01T10:00:00Z\n${frontmatterExtra}---\n${body}`;
}

await box.write(
  "_content/plate.memo.card",
  memo(
    "",
    [
      '{% todo id="escalated-one" due="2026-07-27" assigned="Dana" %}Overdue vet call{% /todo %}',
      "",
      '{% todo id="on-plate-one" %}Undated, on the plate now{% /todo %}',
      "",
      '{% todo id="quiet-one" due="2026-08-01" start="2026-07-30" %}Not yet{% /todo %}',
      "",
      '{% todo id="parked-one" status="parked" %}Parked{% /todo %}',
      "",
      '{% todo id="done-one" status="done" %}Already handled{% /todo %}',
      "",
    ].join("\n")
  )
);
```

## Default filter is `--status open` (escalated, on-plate, and quiet all show — not just on-plate)

```ts
await run()
=>
ESCALATED (1)
  _content/plate.memo.card:5  [escalated-one] Overdue vet call  (assigned=Dana due=2026-07-27)
ON PLATE (1)
  _content/plate.memo.card:7  [on-plate-one] Undated, on the plate now
QUIET (1)
  _content/plate.memo.card:9  [quiet-one] Not yet  (due=2026-08-01 start=2026-07-30)
```

## `--status done`

```ts continue
await run({ status: "done" })
=>
DONE (1)
  _content/plate.memo.card:13  [done-one] Already handled
```

## `--status parked`

```ts continue
await run({ status: "parked" })
=>
PARKED (1)
  _content/plate.memo.card:11  [parked-one] Parked
```

## `--on-plate` narrows the default (open) filter further, excluding quiet

```ts continue
await run({ onPlate: true })
=>
ESCALATED (1)
  _content/plate.memo.card:5  [escalated-one] Overdue vet call  (assigned=Dana due=2026-07-27)
ON PLATE (1)
  _content/plate.memo.card:7  [on-plate-one] Undated, on the plate now
```

## `--assigned`

```ts continue
await run({ assigned: "Dana" })
=>
ESCALATED (1)
  _content/plate.memo.card:5  [escalated-one] Overdue vet call  (assigned=Dana due=2026-07-27)
```

## No match

```ts continue
await run({ assigned: "Nobody" })
=> No todos match.
```

## Routine success (no issues) prints no trailing section

```ts continue
await run({ status: "parked" })
=>
PARKED (1)
  _content/plate.memo.card:11  [parked-one] Parked
```

## A card that fails to load prints a trailing "could not be read" section — never silently dropped

```ts continue
await box.write(
  "_content/bad.memo.card",
  '---\nstatus: new\ncreated: not-a-date\n---\n{% todo %}Never collected{% /todo %}\n'
);
await run({ status: "parked" })
=>
PARKED (1)
  _content/plate.memo.card:11  [parked-one] Parked
«blankline»
1 cards could not be read for todos:
  [load] _content/bad.memo.card: /«*»_content/bad.memo.card: invalid memo frontmatter:
  - created: Invalid ISO datetime
```

## `--json` carries the full structured records, plus `issues` alongside

```ts continue
const jsonOut = await run({ status: "parked", json: true });
const parsed = JSON.parse(jsonOut);
parsed.todos.map((t) => t.id).join(", ")
=> parked-one

parsed.issues.map((i) => i.kind).join(", ")
=> load
```

## An invalid `--status` value is a clean error, not a crash

```ts continue
async function runCaptured(options) {
  const errors = [];
  const origError = console.error;
  const origExit = process.exit;
  let exitCode;
  console.error = (...args) => { errors.push(args.join(" ")); };
  process.exit = (code) => {
    exitCode = code ?? 0;
    throw new Error("__doctest_process_exit__");
  };
  try {
    await runTodosForBox(box.root, options);
  } catch (e) {
    if (e.message !== "__doctest_process_exit__") throw e;
  } finally {
    console.error = origError;
    process.exit = origExit;
  }
  return { errors, exitCode };
}

const badStatus = await runCaptured({ status: "wontfix" });
badStatus.errors.join("\n")
=> Error: --status must be one of open, done, dropped, parked (got "wontfix")

badStatus.exitCode
=> 1
```

```ts cleanup
await box.cleanup();
```
