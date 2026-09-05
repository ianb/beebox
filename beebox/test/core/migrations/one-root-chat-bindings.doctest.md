# one-root chat-binding rewrite: original bytes are captured before the write

`rewriteChatBindings` (`src/core/migrations/one-root-chat-bindings.ts`)
rewrites `.beebox/chat-session-history.json`'s per-session `contextDir`
through the v2→v3 mapping. Finding 3 (round 4 hardening): the pre-write bytes
used to come back only in the function's RETURN value, so a caller that
assigns `originalHistoryBytes = result.originalRaw` after the `await` never
runs that assignment when the write itself throws — leaving rollback's
restore slot at its initial `null` even though the true original bytes were
sitting in local scope the whole time. `originalBytesOut` is now a
caller-owned box the function writes into the MOMENT it reads the file,
before any write is attempted.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { rewriteChatBindings } from "../../../src/core/migrations/one-root-chat-bindings.js";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-chat-bindings-"));
  const contentRoot = path.join(root, "content");
  await fs.mkdir(contentRoot, { recursive: true });
  const beeboxDir = path.join(root, ".beebox");
  await fs.mkdir(beeboxDir, { recursive: true });
  const historyPath = path.join(beeboxDir, "chat-session-history.json");
  const raw = JSON.stringify({ sessions: [{ contextDir: "store/recipes" }] });
  await fs.writeFile(historyPath, raw);
  return { root, contentRoot, beeboxDir, historyPath, raw };
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
```

## The happy path captures the bytes into the caller's box before writing

```ts
const { root, contentRoot, raw } = await makeFixture();
const box = { value: null };
const result = await rewriteChatBindings({ packageRoot: root, contentRoot, originalBytesOut: box });
JSON.stringify({ captured: box.value === raw, cwdPairs: result.cwdPairs.length, mappedDir: result.cwdPairs[1]?.newCwd === path.join(root, "_content", "recipes") })
=> {"captured":true,"cwdPairs":2,"mappedDir":true}
```

```ts cleanup
await cleanup(root);
```

## A write failure still leaves the pre-write bytes in the caller's box

Removing write permission on `.beebox/` makes `writeFileAtomic`'s temp-file
create fail — a controlled stand-in for "the write throws for any reason"
(disk full, a truncating crash, EACCES). The read (and so the capture into
`originalBytesOut`) already succeeded by the time that happens.

```ts
const { root, contentRoot, beeboxDir, raw } = await makeFixture();
await fs.chmod(beeboxDir, 0o500);
const box = { value: null };
const err = await rewriteChatBindings({ packageRoot: root, contentRoot, originalBytesOut: box }).catch((e) => e);
JSON.stringify({ threw: err instanceof Error, capturedBeforeThrow: box.value === raw })
=> {"threw":true,"capturedBeforeThrow":true}
```

```ts cleanup
await fs.chmod(beeboxDir, 0o700).catch(() => {});
await cleanup(root);
```

## No history file at all: the box stays `null`, nothing throws

```ts
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-chat-bindings-empty-"));
const contentRoot = path.join(root, "content");
await fs.mkdir(contentRoot, { recursive: true });
const box = { value: null };
const result = await rewriteChatBindings({ packageRoot: root, contentRoot, originalBytesOut: box });
JSON.stringify({ captured: box.value, cwdPairs: result.cwdPairs.length })
=> {"captured":null,"cwdPairs":1}
```

```ts cleanup
await cleanup(root);
```
