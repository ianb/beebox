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
} from "../../src/connectors/transient-state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { readFile } from "node:fs/promises";

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
// Persisted to config/connectors/telegram.state.json, not just returned.
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
transientStatePath(box.root, "telegram").endsWith("config/connectors/telegram.state.json")
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
