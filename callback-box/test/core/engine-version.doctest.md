# Engine version surfacing (Track E, chunk E2)

A v2 box pins its own `callback-box` dependency in `package.json`, resolved
into `node_modules/callback-box/`. That pinned version can drift from
whatever engine process is actually serving the box (future-normal once the
hub serves per-box engines — for now, just flagged). `getEngineVersionReport`
is the single place `cb status` and `/healthz` both read this comparison
from, so the two surfaces can't disagree.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  getServingEngineVersion,
  getInstalledEngineVersion,
  getEngineVersionReport,
} from "../../src/core/engine-version.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function realEngineVersion() {
  const raw = await fs.readFile(path.join(PACKAGE_ROOT, "package.json"), "utf-8");
  return JSON.parse(raw).version;
}
```

## `getServingEngineVersion` reads the running engine's own package.json

```ts
const engineVersion = await realEngineVersion();
(await getServingEngineVersion()) === engineVersion
=> true
```

## A legacy (shapeVersion 1) box has no separate installed engine

```ts
const box = await makeTmpBox();
await getInstalledEngineVersion(box.root)
=> null
```

```ts continue
const report = await getEngineVersionReport(box.root);
JSON.stringify({ installed: report.installed, mismatch: report.mismatch })
=> {"installed":null,"mismatch":false}
```

```ts cleanup
await box.cleanup();
```

## A v2 box pinned to a different version than the serving engine reports a mismatch

```ts
const box = await makeTmpBox();
await box.write("content/.cb-box", JSON.stringify({ shapeVersion: 2 }));
await box.write("package.json", JSON.stringify({ name: "my-box", dependencies: { "callback-box": "0.0.1" } }));
await box.write("node_modules/callback-box/package.json", JSON.stringify({ version: "0.0.1" }));

await getInstalledEngineVersion(box.path("content"))
=> 0.0.1

const report = await getEngineVersionReport(box.path("content"));
JSON.stringify({ installed: report.installed, mismatch: report.mismatch })
=> {"installed":"0.0.1","mismatch":true}
```

```ts cleanup
await box.cleanup();
```

## A v2 box pinned to the SAME version as the serving engine reports no mismatch

```ts
const box = await makeTmpBox();
const engineVersion = await realEngineVersion();
await box.write("content/.cb-box", JSON.stringify({ shapeVersion: 2 }));
await box.write("package.json", JSON.stringify({ name: "my-box", dependencies: { "callback-box": engineVersion } }));
await box.write("node_modules/callback-box/package.json", JSON.stringify({ version: engineVersion }));

const report = await getEngineVersionReport(box.path("content"));
report.mismatch
=> false
```

```ts cleanup
await box.cleanup();
```
