# Engine version surfacing (Track E, chunk E2)

A box pins its own `beebox` dependency in `package.json`, resolved
into `node_modules/beebox/`. That pinned version can drift from
whatever engine process is actually serving the box (future-normal once the
hub serves per-box engines — for now, just flagged). `getEngineVersionReport`
is the single place `bbx status` and `/healthz` both read this comparison
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

## A box with no installed engine reports `installed: null`

`getInstalledEngineVersion` reads `<box.root>/node_modules/beebox/package.json`.
A fresh fixture has no such install, so it's `null` — and the report shows no
mismatch (a null side never mismatches).

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

## A box whose installed engine differs from the serving engine reports a mismatch

The pinned/installed engine lives at `<box.root>/node_modules/beebox/`.
Install a fake one at version `0.0.1`; the serving engine (this build) is a
different version, so `mismatch` is true.

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, "node_modules/beebox"), { recursive: true });
await fs.writeFile(path.join(box.root, "node_modules/beebox/package.json"), JSON.stringify({ version: "0.0.1" }));

await getInstalledEngineVersion(box.root)
=> 0.0.1

const report = await getEngineVersionReport(box.root);
JSON.stringify({ installed: report.installed, mismatch: report.mismatch })
=> {"installed":"0.0.1","mismatch":true}
```

```ts cleanup
await box.cleanup();
```

## A box whose installed engine matches the serving engine reports no mismatch

```ts
const box = await makeTmpBox();
const engineVersion = await realEngineVersion();
await fs.mkdir(path.join(box.root, "node_modules/beebox"), { recursive: true });
await fs.writeFile(path.join(box.root, "node_modules/beebox/package.json"), JSON.stringify({ version: engineVersion }));

const report = await getEngineVersionReport(box.root);
report.mismatch
=> false
```

```ts cleanup
await box.cleanup();
```
