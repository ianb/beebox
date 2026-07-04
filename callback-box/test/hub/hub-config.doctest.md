# `cb hub` config: `hub.json` validation (Track D, chunk D1)

`hub.json` is the fleet's routing table, so it's validated fail-closed:
unknown top-level keys, an unknown per-box key, a malformed or reserved
slug, and two slugs claiming the same box path are all load errors, not
warnings. See `src/hub/hub-config.ts`.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadHubConfig, HubConfigError, RESERVED_SLUGS } from "../../src/hub/hub-config.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function writeConfig(dir, obj) {
  const configPath = path.join(dir, "hub.json");
  await fs.writeFile(configPath, JSON.stringify(obj, null, 2));
  return configPath;
}

async function tryLoad(configPath) {
  try {
    return await loadHubConfig(configPath);
  } catch (e) {
    return e;
  }
}
```

## A minimal valid config loads, with the box path resolved to absolute

```ts
const box = await makeTmpBox();
await box.write("boxes/test1/.cb-box", "");
const configPath = await writeConfig(box.root, { boxes: { test1: { path: "./boxes/test1" } } });
const config = await tryLoad(configPath);
config instanceof HubConfigError
=> false

config.boxes.test1.path === path.join(box.root, "boxes/test1")
=> true

config.port
=> undefined
```

## An unknown top-level key is rejected (fail-closed, `z.strictObject`)

```ts continue
const badConfig = await writeConfig(box.root, { boxes: {}, extraKey: true });
const err = await tryLoad(badConfig);
err instanceof HubConfigError
=> true

err.message.includes("extraKey")
=> true
```

## An unknown key inside a box entry is rejected

```ts continue
const badEntry = await writeConfig(box.root, { boxes: { test1: { path: "./boxes/test1", port: 1234 } } });
(await tryLoad(badEntry)) instanceof HubConfigError
=> true
```

## A reserved slug is rejected

`healthz`, `auth`, `webhook`, and `api` are prefixes the box server itself
claims at the root level (or, for `webhook`, as a SEPARATE top-level prefix
from a box's own `/<slug>` — see `RESERVED_SLUGS`'s doc comment) — a box
slugged the same would make some of its own routes unreachable through the
hub.

```ts continue
JSON.stringify(Array.from(RESERVED_SLUGS).sort())
=> ["api","auth","healthz","webhook"]
```

```ts continue
const reservedConfig = await writeConfig(box.root, { boxes: { webhook: { path: "./boxes/test1" } } });
const err2 = await tryLoad(reservedConfig);
err2 instanceof HubConfigError
=> true

err2.message.includes("reserved")
=> true
```

## A malformed slug (uppercase, leading hyphen, empty) is rejected

```ts continue
const badSlug = await writeConfig(box.root, { boxes: { "Test-1": { path: "./boxes/test1" } } });
(await tryLoad(badSlug)) instanceof HubConfigError
=> true
```

## Two slugs claiming the same resolved box path is rejected

Two engine processes serving one box's on-disk state at once is the exact
"critical gap" the plan's Failure modes section warns about (two engines on
one `events.db`) — the hub must never be configured to do this on purpose.

```ts continue
const dupeConfig = await writeConfig(box.root, {
  boxes: {
    test1: { path: "./boxes/test1" },
    "test1-again": { path: "./boxes/test1" },
  },
});
const dupeErr = await tryLoad(dupeConfig);
dupeErr instanceof HubConfigError
=> true

dupeErr.message.includes("test1-again")
=> true
```

```ts cleanup
await box.cleanup();
```

## Missing config file, invalid JSON

```ts
const missing = await tryLoad("/nonexistent/hub.json");
missing instanceof HubConfigError
=> true
```

```ts continue
const box2 = await makeTmpBox();
const notJson = path.join(box2.root, "hub.json");
await fs.writeFile(notJson, "{ not json");
(await tryLoad(notJson)) instanceof HubConfigError
=> true
```

```ts cleanup
await box2.cleanup();
```
