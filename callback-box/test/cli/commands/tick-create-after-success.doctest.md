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
import { handleCreateAfterSuccess } from "../../../src/cli/commands/tick-utils.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** Run the chain handler with console output captured instead of printed. */
async function runChain(box, createAfterSuccess) {
  const errors = [];
  const logs = [];
  const realError = console.error;
  const realLog = console.log;
  console.error = (msg) => errors.push(msg);
  console.log = (msg) => logs.push(msg);
  try {
    await handleCreateAfterSuccess({
      boxRoot: box.root,
      scriptName: "nightly-notes",
      parsed: { createAfterSuccess },
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
  { path: "../outside/Evil.memo.card", args: { content: "escaped" } },
  { path: "store/notes/Daily.memo.card", args: { content: "ok" } },
]);
JSON.stringify(errors, null, 2)
=> [
  "  Chain: nightly-notes: path \"../outside/Evil.memo.card\" escapes the box — skipping"
]
```

Nothing was written above the box root (the box's content dir sits inside its
package root, so `../outside` would have landed in the package):

```ts continue
existsSync(join(box.packageRoot, "outside"))
=> false
```

The normal entry created its card from the `memo` default template:

```ts continue
await box.list("store")
=>
store/notes
store/notes/Daily.memo.card

(await box.read("store/notes/Daily.memo.card")).includes("ok")
=> true
```

## A leading `/` addresses the box root, not the OS root

`/store/kept/Weekly.memo.card` is the canonical box-root form, so it lands
inside the box like any other in-box path.

```ts continue
const second = await runChain(box, [
  { path: "/store/kept/Weekly.memo.card", args: { content: "weekly" } },
]);
second.errors.length
=> 0

await box.list("store/kept")
=>
store/kept/Weekly.memo.card
```

Re-running the same chain is idempotent — an existing target is left alone:

```ts continue
const third = await runChain(box, [
  { path: "/store/kept/Weekly.memo.card", args: { content: "changed" } },
]);
JSON.stringify(third.logs, null, 2)
=> [
  "  Chain: /store/kept/Weekly.memo.card already exists, skipping"
]
```

```ts cleanup
await box.cleanup();
```
