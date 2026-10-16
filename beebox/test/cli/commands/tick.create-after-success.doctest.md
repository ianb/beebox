# `create-after-success` chains are contained to the box

A scheduled script can declare `create-after-success: [{ path, args }]` — after
a successful run, each entry is created from its card type's default template.
That `path` is card-authored data (an agent writes scheduled-script cards), and
this is a *write* path, so it goes through the shared ref algebra as a
`write-target`: leading `/` means the box root, and a `..` that climbs out of
the box resolves to nothing. An escaping entry is a logged error that skips only
that entry — the rest of the chain still runs.

```ts setup
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedScheduledScript } from "../../../src/schemas/scheduled-script/schema.js";
import { handleCreateAfterSuccess } from "../../../src/cli/tick-utils.js";
import { makeTmpBox, type TmpBox } from "../../helpers/doctest-helpers.js";

function makeScript(overrides: Partial<ParsedScheduledScript>): ParsedScheduledScript {
  return {
    cron: undefined, at: undefined, rrule: undefined, until: undefined,
    notBefore: undefined, onWakeup: false, once: false, enabled: true,
    action: { kind: "runs", command: "true" }, requestedBy: undefined,
    description: undefined, reason: undefined,
    createAfterSuccess: [], budget: undefined, lockGroup: undefined,
    timeoutMs: undefined, requires: undefined,
    ...overrides,
  };
}

/** Run the chain handler with console output captured instead of printed. */
async function runChain(box: TmpBox, createAfterSuccess: ParsedScheduledScript["createAfterSuccess"]) {
  const errors: unknown[] = [];
  const logs: unknown[] = [];
  const realError = console.error;
  const realLog = console.log;
  console.error = (msg: unknown) => { errors.push(msg); };
  console.log = (msg: unknown) => { logs.push(msg); };
  try {
    await handleCreateAfterSuccess({
      boxRoot: box.root,
      scriptName: "nightly-notes",
      parsed: makeScript({ createAfterSuccess }),
    });
  } finally {
    console.error = realError;
    console.log = realLog;
  }
  return { errors, logs };
}
```

## A `../` chain path is refused and writes nothing outside the box

The escaping entry is skipped with an error naming the script and the path; the
ordinary entry after it is still created.

```ts
const box = await makeTmpBox();
const { errors } = await runChain(box, [
  { path: "../outside/Evil.doc.card", args: { title: "Evil", body: "escaped" } },
  { path: "_content/notes/Daily.doc.card", args: { title: "Daily", body: "ok" } },
]);
JSON.stringify(errors, null, 2)
=> [
  "  Chain: nightly-notes: path \"../outside/Evil.doc.card\" escapes the box — skipping"
]
```

Nothing was written above the box root:

```ts continue
existsSync(join(box.root, "outside"))
=> false
```

The normal entry created its card from the `doc` default template:

```ts continue
await box.list("_content/notes")
=>
_content/notes/Daily.doc.card

(await box.read("_content/notes/Daily.doc.card")).includes("ok")
=> true
```

## A leading `/` addresses the box root, not the OS root

`/_content/kept/Weekly.doc.card` is the canonical box-root form, so it lands
inside the box like any other in-box path.

```ts continue
const second = await runChain(box, [
  { path: "/_content/kept/Weekly.doc.card", args: { title: "Weekly", body: "weekly" } },
]);
second.errors.length
=> 0

await box.list("_content/kept")
=>
_content/kept/Weekly.doc.card
```

Re-running the same chain is idempotent — an existing target is left alone:

```ts continue
const third = await runChain(box, [
  { path: "/_content/kept/Weekly.doc.card", args: { title: "Weekly", body: "changed" } },
]);
JSON.stringify(third.logs, null, 2)
=> [
  "  Chain: /_content/kept/Weekly.doc.card already exists, skipping"
]
```

```ts cleanup
await box.cleanup();
```
