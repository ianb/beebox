# Connector transient-state locking

`updateTransientState` serializes read-modify-write on a connector's
gitignored `<name>.state.json`. The eight RMW spans over these files used to
run unlocked, so two overlapping spans both read the pre-mutation bytes and the
last writer silently dropped the other's change. The helper funnels every RMW
through two layered locks: `withCardLock` (in-process, OUTER) keyed on the
state-file path, and the cross-process file lock (INNER) on a SIBLING
`<state-file>.lock` path.

```ts setup
import {
  updateTransientState,
  loadTransientState,
  transientStatePath,
  TransientStateCorruptError,
} from "../../src/connectors/transient-state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

/** Run `fn`, returning whatever it throws instead of propagating. */
async function tryCall(fn) {
  try {
    return await fn();
  } catch (e) {
    return e;
  }
}

// A yield inside the critical section widens the window a lost-update bug would
// exploit — serialization must still hold across it. Kept in setup because the
// doctest tracker splits multi-line `;`-terminated bodies in example blocks.
function bumpCount(boxRoot: string, connectorName: string): Promise<{ count: number }> {
  return updateTransientState<{ count: number }>({
    boxRoot,
    connectorName,
    defaultValue: { count: 0 },
    update: async (state) => {
      await new Promise((r) => setImmediate(r));
      return { count: state.count + 1 };
    },
  });
}

async function lockFileExists(boxRoot: string, connectorName: string): Promise<boolean> {
  try {
    await readFile(`${transientStatePath(boxRoot, connectorName)}.lock`, "utf-8");
    return true;
  } catch (_e) {
    return false;
  }
}
```

## A single update loads default, mutates, and persists

On first run the state file is absent, so `update` receives `defaultValue`.
The return is both persisted and handed back.

```ts
const box = await makeTmpBox();
const result = await updateTransientState<{ lastUpdateId: number }>({
  boxRoot: box.root,
  connectorName: "telegram",
  defaultValue: { lastUpdateId: 0 },
  update: (state) => ({ lastUpdateId: state.lastUpdateId + 5 }),
});
JSON.stringify(result)
=> {"lastUpdateId":5}
```

```ts continue
// Persisted to _bookkeeping/connectors/telegram.state.json, not just returned.
const onDisk = await loadTransientState({
  boxRoot: box.root,
  connectorName: "telegram",
  defaultValue: { lastUpdateId: -1 },
});
JSON.stringify(onDisk)
=> {"lastUpdateId":5}
```

```ts continue
// State lives at the connector's .state.json; the cross-process lock uses a
// SIBLING .lock path (never the state file itself — acquireLock would
// unlink/overwrite malformed lock content and destroy real state).
transientStatePath(box.root, "telegram").endsWith("_bookkeeping/connectors/telegram.state.json")
=> true
```

```ts cleanup
await box.cleanup();
```

## Concurrent updates both land — no lost write

Two overlapping updates each express their change as a delta against
*freshly-loaded* state (loaded inside the lock), so serialization makes both
increments compose. Unlocked, one would clobber the other and the count would
land at 1 instead of 2. We launch both before awaiting either, so they race.

```ts
const box = await makeTmpBox();
const [a, b] = await Promise.all([bumpCount(box.root, "gmail"), bumpCount(box.root, "gmail")]);
// Both increments landed: results are 1 and 2 in some order, final state is 2.
[Math.min(a.count, b.count), Math.max(a.count, b.count)]
=> [
  1,
  2
]
```

```ts continue
const onDisk = await loadTransientState({
  boxRoot: box.root,
  connectorName: "gmail",
  defaultValue: { count: -1 },
});
onDisk.count
=> 2
```

```ts continue
// The sibling lock file is released, not left behind.
await lockFileExists(box.root, "gmail")
=> false
```

```ts cleanup
await box.cleanup();
```

## Many concurrent updates all compose

Ten overlapping increments over the same file all land — the strongest proof
that no write is dropped under contention.

```ts
const box = await makeTmpBox();
await Promise.all(Array.from({ length: 10 }, () => bumpCount(box.root, "drive")));
const onDisk = await loadTransientState({
  boxRoot: box.root,
  connectorName: "drive",
  defaultValue: { count: -1 },
});
onDisk.count
=> 10
```

```ts cleanup
await box.cleanup();
```

## A corrupt state file fails closed — it is not "missing"

Missing and corrupt mean opposite things here. Missing is first run, and
`defaultValue` is the correct answer. Corrupt is a damaged file, and resolving it
to `defaultValue` would silently discard sync tokens and Telegram thread
mappings — then the very next `updateTransientState` would write that loss back
over the file.

```ts
const box = await makeTmpBox();
const gmailState = transientStatePath(box.root, "gmail");
await mkdir(path.dirname(gmailState), { recursive: true });
await writeFile(gmailState, '{"historyId": "trunca');

const readBack = await tryCall(() => loadTransientState({
  boxRoot: box.root, connectorName: "gmail", defaultValue: { historyId: null },
}));
readBack instanceof TransientStateCorruptError
=> true
```

The RMW aborts too, so the damaged bytes are still on disk for a human to look
at rather than replaced by a one-field default.

```ts continue
const updated = await tryCall(() => updateTransientState({
  boxRoot: box.root,
  connectorName: "gmail",
  defaultValue: { historyId: null },
  update: (state) => ({ ...state, historyId: "999" }),
}));
JSON.stringify({
  threw: updated instanceof TransientStateCorruptError,
  onDisk: await readFile(transientStatePath(box.root, "gmail"), "utf-8"),
})
=> {"threw":true,"onDisk":"{\"historyId\": \"trunca"}
```

A genuinely absent file still takes the default — first run is not an error.

```ts continue
JSON.stringify(await loadTransientState({
  boxRoot: box.root, connectorName: "never-synced", defaultValue: { historyId: null },
}))
=> {"historyId":null}
```

```ts cleanup
await box.cleanup();
```

## Saves are crash-safe

`saveTransientState` replaces the file by temp-write + fsync + atomic rename, so
a kill mid-write can never leave the truncated file that `loadTransientState`
now refuses to read. Nothing but the state file itself is left behind.

```ts
const box = await makeTmpBox();
await updateTransientState({
  boxRoot: box.root,
  connectorName: "drive",
  defaultValue: { count: 0 },
  update: (state) => ({ count: state.count + 1 }),
});
const dir = path.dirname(transientStatePath(box.root, "drive"));
(await readdir(dir)).filter((f) => f.includes(".tmp-")).length
=> 0
```

```ts cleanup
await box.cleanup();
```
