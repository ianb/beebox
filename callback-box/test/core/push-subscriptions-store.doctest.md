# push-subscriptions: corrupt-store handling (Track D.3)

`loadStore` used to share one catch between "no store yet" (ENOENT) and
"store failed to parse" — both fell through to an empty store, and the next
write then silently overwrote the corruption with a fresh, empty file,
destroying every subscription. Missing and corrupt are now distinguished:
missing is a normal empty store; corrupt throws `PushStoreCorruptError` and
aborts the read-modify-write instead of writing over it. See
`src/core/push-subscriptions.ts`.

```ts setup
import { addSubscription, endpointsForBox, PushStoreCorruptError } from "../../src/core/push-subscriptions.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const storeDir = path.join(os.tmpdir(), `cb-push-store-corrupt-${process.pid}-${Date.now()}`);
process.env.CALLBACK_PUSH_STORE_DIR = storeDir;
const storeFile = path.join(storeDir, "push-subscriptions.json");

const SUB = { endpoint: "https://push.example/store-test", keys: { p256dh: "p", auth: "a" } };
const NOW = new Date("2026-07-01T00:00:00Z");

async function tryCall(fn) {
  try {
    return await fn();
  } catch (e) {
    return e;
  }
}
```

## No store file yet: reads succeed as empty, no throw

```ts
const beforeAny = await endpointsForBox("some-box");
beforeAny.length
=> 0
```

## A valid store round-trips through addSubscription / endpointsForBox

```ts continue
await addSubscription({ boxSlug: "boxa", subscription: SUB, now: NOW });
const forBoxA = await endpointsForBox("boxa");
forBoxA.length
=> 1
```

## A corrupt (invalid JSON) store throws PushStoreCorruptError on read

```ts continue
await fs.writeFile(storeFile, "{ not valid json");
const readResult = await tryCall(() => endpointsForBox("boxa"));
readResult instanceof PushStoreCorruptError
=> true

readResult.storePath === storeFile
=> true
```

## A corrupt store also aborts a write attempt — the file is left untouched

```ts continue
const beforeContent = await fs.readFile(storeFile, "utf-8");
const writeResult = await tryCall(() => addSubscription({ boxSlug: "boxb", subscription: SUB, now: NOW }));
writeResult instanceof PushStoreCorruptError
=> true

const afterContent = await fs.readFile(storeFile, "utf-8");
afterContent === beforeContent
=> true
```

## A store that parses as JSON but fails the shape schema also throws

```ts continue
await fs.writeFile(storeFile, JSON.stringify({ "https://push.example/x": { keys: { p256dh: "p" } } }));
(await tryCall(() => endpointsForBox("boxa"))) instanceof PushStoreCorruptError
=> true
```

```ts cleanup
await fs.rm(storeDir, { recursive: true, force: true });
```
