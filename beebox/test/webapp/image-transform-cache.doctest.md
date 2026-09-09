# Image transform cache concurrency

The cache shares identical misses and admits no more than two distinct transforms at once.

```ts setup
import { mkdir, mkdtemp, readdir, rm, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageTransformCache } from "../../src/webapp/image-transform-cache.js";

const root = await mkdtemp(join(tmpdir(), "bbx-image-cache-"));
const cache = new ImageTransformCache(root);
let active = 0;
let maximum = 0;
let generated = 0;
const releases: Array<() => void> = [];

function generate(): () => Promise<Buffer> {
  return async () => {
    generated++;
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return Buffer.from("generated");
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not reached");
}
```

```ts
const first = cache.getOrCreate({ key: "first", extension: "webp", generate: generate() });
const duplicate = cache.getOrCreate({ key: "first", extension: "webp", generate: generate() });
const second = cache.getOrCreate({ key: "second", extension: "webp", generate: generate() });
const third = cache.getOrCreate({ key: "third", extension: "webp", generate: generate() });
await until(() => generated === 2);
`${generated} ${active} ${maximum}`
=> 2 2 2
```

Releasing one slot starts the queued transform; the duplicate still shares the first result.

```ts continue
releases.shift()?.();
await until(() => generated === 3);
`${generated} ${active} ${maximum}`
=> 3 2 2
```

```ts continue
releases.shift()?.();
releases.shift()?.();
const results = await Promise.all([first, duplicate, second, third]);
JSON.stringify(results.map((result) => result.toString()))
=> ["generated","generated","generated","generated"]
```

A later request reads the stored representation without another generation.

```ts continue
(await cache.getOrCreate({ key: "first", extension: "webp", generate: generate() })).toString()
=> generated
```

An overdue write purges stale temporary files and trims the oldest variants to the 512 MiB bound.

```ts continue
const purgeRoot = join(root, "purge-box");
const purgeDir = join(purgeRoot, ".beebox/image-cache/v1");
await mkdir(purgeDir, { recursive: true });
const old = join(purgeDir, "old.webp");
const recent = join(purgeDir, "recent.webp");
const staleTemp = join(purgeDir, "orphan.webp.tmp-1-old");
await Promise.all([writeFile(old, ""), writeFile(recent, ""), writeFile(staleTemp, "partial")]);
await Promise.all([truncate(old, 300 * 1024 * 1024), truncate(recent, 300 * 1024 * 1024)]);
const now = Date.now();
await utimes(old, new Date(now - 30_000), new Date(now - 30_000));
await utimes(recent, new Date(now - 20_000), new Date(now - 20_000));
await utimes(staleTemp, new Date(now - 2 * 3600_000), new Date(now - 2 * 3600_000));
const purgeCache = new ImageTransformCache(purgeRoot);
await purgeCache.getOrCreate({ key: "fresh", extension: "webp", generate: async () => Buffer.from("fresh") });
(await readdir(purgeDir)).sort()
=>
[
  "fresh.webp",
  "recent.webp"
]
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
