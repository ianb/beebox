# `bbx hub` config: `hub.json` validation (Track D, chunk D1)

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
await box.write("boxes/test1/.beebox/box.json", "");
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

## A v2 package root and its own `content/` dir are the same box (canonicalized before comparing)

Without canonicalizing to the actual box root first, `./boxes/pkg` (the
package root) and `./boxes/pkg/content` (its own content dir) compare as
different strings and both pass the check -- exactly the "two engines on
one `events.db`" hazard above, just reached through the v2 bilingual layout
instead of a literal duplicate path. `resolveBoxRoot` (the same resolution
`src/hub/supervisor.ts` uses at boot) resolves both to one root before the
duplicate check runs.

```ts continue
await box.write("boxes/pkg/content/.beebox/box.json", "");
const aliasConfig = await writeConfig(box.root, {
  boxes: {
    "pkg-root": { path: "./boxes/pkg" },
    "pkg-content": { path: "./boxes/pkg/content" },
  },
});
const aliasErr = await tryLoad(aliasConfig);
aliasErr instanceof HubConfigError
=> true

aliasErr.message.includes("pkg-root") && aliasErr.message.includes("pkg-content")
=> true
```

## A symlinked alias to the same box is also caught

```ts continue
await fs.symlink(path.join(box.root, "boxes/test1"), path.join(box.root, "boxes/test1-link"));
const symlinkConfig = await writeConfig(box.root, {
  boxes: {
    test1: { path: "./boxes/test1" },
    "test1-symlink": { path: "./boxes/test1-link" },
  },
});
const symlinkErr = await tryLoad(symlinkConfig);
symlinkErr instanceof HubConfigError
=> true

symlinkErr.message.includes("test1-symlink")
=> true
```

## Legacy box state resolves, but config loading does not migrate it

The router and hub need to locate a box before `getBoxShape()` can run the
engine-owned migration. A legacy `content/.callback-box` therefore identifies
the operational root, but discovery itself must leave it in place so an older
worktree can still be served without the router rewriting its state.

```ts continue
const legacyState = path.join(box.root, "boxes/legacy/content/.callback-box");
await fs.mkdir(legacyState, { recursive: true });
await fs.writeFile(path.join(legacyState, "state.json"), "old\n");
const legacyConfigPath = await writeConfig(box.root, { boxes: { legacy: { path: "./boxes/legacy" } } });
const legacyConfig = await loadHubConfig(legacyConfigPath);
legacyConfig.boxes.legacy.path === path.join(box.root, "boxes/legacy")
=> true

await fs.access(legacyState).then(() => true)
=> true

await fs.access(path.join(box.root, "boxes/legacy/content/.beebox")).then(() => false, () => true)
=> true
```

A box path that doesn't resolve at all (no `.beebox/box.json` anywhere) still loads
successfully -- canonicalization failures don't block config load, only the
supervisor reports that box "unhealthy" once it actually tries to launch it
(see `cli/commands/hub.ts`'s best-effort `boxEntries` handling):

```ts continue
const unresolvableConfig = await writeConfig(box.root, { boxes: { broken: { path: "./boxes/does-not-exist" } } });
(await tryLoad(unresolvableConfig)) instanceof HubConfigError
=> false
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

## `lazy`/`idleMs` default off, and parse when set

Boxholder directive (2026-07-04): `lazy` defaults to `false` (production
hubs stay resident) and `idleMs` always resolves to a real number (the dev
router's own 5-minute default) even when the config omits it, so callers
never need a second fallback.

```ts
const box3 = await makeTmpBox();
await box3.write("boxes/test1/.beebox/box.json", "");
const plainConfigPath = await writeConfig(box3.root, { boxes: { test1: { path: "./boxes/test1" } } });
const plainConfig = await loadHubConfig(plainConfigPath);
JSON.stringify({ lazy: plainConfig.lazy, idleMs: plainConfig.idleMs })
=> {"lazy":false,"idleMs":300000}
```

```ts continue
const lazyConfigPath = await writeConfig(box3.root, {
  boxes: { test1: { path: "./boxes/test1" } },
  lazy: true,
  idleMs: 60000,
});
const lazyConfig = await loadHubConfig(lazyConfigPath);
JSON.stringify({ lazy: lazyConfig.lazy, idleMs: lazyConfig.idleMs })
=> {"lazy":true,"idleMs":60000}
```

## `keepRecent` defaults to 0, parses with `lazy`, and requires `lazy: true`

Boxholder directive (2026-07-11): `keepRecent` keeps the N most-recently-used
boxes alive in an otherwise idle-stopping lazy hub (and pre-starts them on a
hub restart). It defaults to 0 (pure idle-stop) and is only meaningful with
`lazy: true` — a positive value on a resident hub is a fail-closed config
error, since every box there already stays up.

```ts continue
const defaultKeep = await loadHubConfig(plainConfigPath);
defaultKeep.keepRecent
=> 0
```

```ts continue
const keepConfigPath = await writeConfig(box3.root, {
  boxes: { test1: { path: "./boxes/test1" } },
  lazy: true,
  keepRecent: 2,
});
(await loadHubConfig(keepConfigPath)).keepRecent
=> 2
```

`keepRecent > 0` without `lazy: true` is rejected, and the message names the
constraint:

```ts continue
const keepNoLazyPath = await writeConfig(box3.root, {
  boxes: { test1: { path: "./boxes/test1" } },
  keepRecent: 1,
});
const keepErr = await tryLoad(keepNoLazyPath);
keepErr instanceof HubConfigError
=> true

keepErr.message.includes("keepRecent") && keepErr.message.includes("lazy")
=> true
```

`keepRecent: 0` without `lazy` is fine (it's the default — nothing to keep):

```ts continue
const keepZeroPath = await writeConfig(box3.root, {
  boxes: { test1: { path: "./boxes/test1" } },
  keepRecent: 0,
});
(await tryLoad(keepZeroPath)) instanceof HubConfigError
=> false
```

A negative or non-integer `keepRecent` is a schema error:

```ts continue
const keepNegPath = await writeConfig(box3.root, {
  boxes: { test1: { path: "./boxes/test1" } },
  lazy: true,
  keepRecent: -1,
});
(await tryLoad(keepNegPath)) instanceof HubConfigError
=> true
```

```ts cleanup
await box3.cleanup();
```
