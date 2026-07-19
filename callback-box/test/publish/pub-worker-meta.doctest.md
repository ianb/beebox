# pub-worker introspection: wrangler.jsonc + the version hash

`cb pub setup`/`status` (Track E of `docs/plans/publish-pages.md`) read the
committed `pub-worker/wrangler.jsonc` as the single source of truth for the
Worker name and R2 binding, and hash the committed Worker source into the
version stamp the deploy bakes in (`--var PUB_WORKER_VERSION:<hash>`) and the
drift probe compares against.

```ts setup
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  CROSS_PACKAGE_SOURCES,
  computePubWorkerVersion,
  PUB_WORKER_DIR,
  readPubWorkerConfig,
  readPubWorkerSourceFiles,
  stripJsoncComments,
} from "../../src/publish/pub-worker-meta.js";

// Scan the Worker source for `../../src/publish/<name>` imports (the guard
// example below compares this against CROSS_PACKAGE_SOURCES).
async function scanCrossImports() {
  const srcDir = path.join(PUB_WORKER_DIR, "src");
  const imported = new Set();
  for (const entry of await readdir(srcDir, { recursive: true })) {
    if (!entry.endsWith(".ts")) continue;
    const text = await readFile(path.join(srcDir, entry), "utf-8");
    for (const m of text.matchAll(/from "\.\.\/\.\.\/src\/publish\/([\w-]+)"/g)) {
      imported.add(m[1]);
    }
  }
  return [...imported].toSorted();
}
```

## JSONC comment stripping (only what our own config uses)

```ts
JSON.parse(stripJsoncComments('{\n  // a comment\n  "a": 1, /* inline */ "b": "x // not a comment"\n}')).b
=> x // not a comment

JSON.parse(stripJsoncComments('{ "url": "https://example.com/*glob*/" }')).url
=> https://example.com/*glob*/
```

## The committed wrangler.jsonc parses to the shape setup deploys

The real committed config — not a fixture — so a drive-by edit that breaks
provisioning (renamed Worker, dropped binding, re-enabled preview URLs) fails
here first.

```ts
const config = await readPubWorkerConfig();
[config.workerName, config.bucketBinding, config.bucketName].join(" ")
=> pub-worker PUB_STORE pub-store

// Version-preview URLs MUST stay disabled (old Worker versions are a leak
// surface — plan Prior-art); setup refuses to deploy otherwise.
config.previewUrlsDisabled
=> true
```

## The version hash is deterministic and content-sensitive

```ts
const files = new Map([["b.ts", "bee"], ["a.ts", "aye"]]);
const v1 = computePubWorkerVersion(files);
// Insertion order is irrelevant (entries are hashed path-sorted)…
const v2 = computePubWorkerVersion(new Map([["a.ts", "aye"], ["b.ts", "bee"]]));
v1 === v2
=> true

// …but any content change moves the hash.
v1 === computePubWorkerVersion(new Map([["a.ts", "aye!"], ["b.ts", "bee"]]))
=> false

v1.length
=> 64
```

## The hash input covers the real Worker source, config, and cross-package imports

```ts
const sources = await readPubWorkerSourceFiles();
sources.has("pub-worker/src/index.ts") && sources.has("pub-worker/wrangler.jsonc")
=> true

CROSS_PACKAGE_SOURCES.every((name) => sources.has(`src/publish/${name}.ts`))
=> true
```

## Guard: every `../../src/publish/` import in the Worker is in the hash input

If the Worker grows a new cross-package import that `CROSS_PACKAGE_SOURCES`
doesn't list, the deployed bundle could change without the version hash moving
— silent drift. This scan keeps the list honest.

```ts
const imported = await scanCrossImports();
JSON.stringify(imported) === JSON.stringify([...CROSS_PACKAGE_SOURCES].toSorted())
=> true
```
