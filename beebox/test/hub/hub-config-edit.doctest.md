# Registering a box with the hub: `bbx hub add-box`'s edit to `hub.json`

`hub.json` used to be hand-edited on the live server to add a box, which meant
a bad slug was discovered by the hub refusing to boot — after the file had
already been replaced. `src/hub/hub-config-edit.ts` turns the edit into a plan
that is validated through the hub's own loader first, so every rejection
happens with the live file untouched.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  planAddBoxToHubConfig,
  applyAddBoxPlan,
  describeAddBoxPlan,
  HubConfigEditError,
} from "../../src/hub/hub-config-edit.js";
import { HubConfigError, loadHubConfig } from "../../src/hub/hub-config.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

/** A fixture hub with one already-registered box, plus a second box on disk
 *  that no slug claims yet. Both are v2 package-layout boxes (`.beebox/box.json` lives
 *  in `content/`, and the config names the package root, which is what the
 *  real server does). Invented slugs only — see docs/example-names.md. */
async function makeFixture() {
  const tmp = await makeTmpBox();
  await tmp.write("boxes/hearth/content/.beebox/box.json", "");
  await tmp.write("boxes/lighthouse/content/.beebox/box.json", "");
  const configPath = path.join(tmp.root, "hub.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        port: 4310,
        host: "127.0.0.1",
        lazy: true,
        idleMs: 1_800_000,
        keepRecent: 1,
        boxes: { hearth: { path: "./boxes/hearth" } },
      },
      null,
      2,
    ) + "\n",
  );
  return { tmp, configPath };
}

async function tryApply(plan) {
  try {
    await applyAddBoxPlan(plan);
    return null;
  } catch (e) {
    return e;
  }
}

async function tryPlan(configPath, slug, boxPath) {
  try {
    return await planAddBoxToHubConfig({ configPath, slug, boxPath });
  } catch (e) {
    return e;
  }
}
```

## Adding a new box produces a plan, and applying it writes a config the hub loads

The unrelated top-level settings (`port`, `lazy`, `keepRecent`) survive the
edit — the whole reason the command refuses to invent a config from scratch.

```ts
const { tmp, configPath } = await makeFixture();
const plan = await tryPlan(configPath, "lighthouse", path.join(tmp.root, "boxes/lighthouse"));
plan.action
=> added

await applyAddBoxPlan(plan);
const config = await loadHubConfig(configPath);
Object.keys(config.boxes).sort().join(",")
=> hearth,lighthouse

config.boxes.lighthouse.path === path.join(tmp.root, "boxes/lighthouse")
=> true

[config.port, config.host, config.lazy, config.idleMs, config.keepRecent].join(",")
=> 4310,127.0.0.1,true,1800000,1
```

## Re-running is a no-op, not a conflict

`deploy/add-box.sh` claims idempotence, so the hub step has to have it too.
The already-registered entry uses a relative path and the caller passes an
absolute one; the comparison canonicalizes both, so they match.

```ts continue
const again = await tryPlan(configPath, "lighthouse", path.join(tmp.root, "boxes/lighthouse"));
again.action
=> unchanged

describeAddBoxPlan(again).includes("Already registered")
=> true
```

A package root and that box's own `content/` directory are the same box, so
registering one when the other is already registered is also unchanged rather
than a second engine against one `events.db`.

```ts continue
const viaContent = await tryPlan(configPath, "hearth", path.join(tmp.root, "boxes/hearth/content"));
viaContent.action
=> unchanged
```

## A reserved slug fails before anything is written

`healthz`, `auth`, `webhook`, and `api` are the hub's own prefixes. The plan
runs the candidate config through `parseHubConfig`, so this is the same
rejection the hub would make at startup — reported now instead.

```ts continue
const reserved = await tryPlan(configPath, "webhook", path.join(tmp.root, "boxes/lighthouse"));
reserved instanceof HubConfigError
=> true

reserved.message.includes("reserved")
=> true

// The live file still holds exactly the two boxes from before.
Object.keys((await loadHubConfig(configPath)).boxes).sort().join(",")
=> hearth,lighthouse
```

A malformed slug is rejected the same way.

```ts continue
const malformed = await tryPlan(configPath, "Lighthouse_2", path.join(tmp.root, "boxes/lighthouse"));
malformed instanceof HubConfigError
=> true
```

## A second slug for an already-registered box is refused

Two slugs resolving to one box would start two engine processes against one
`events.db`. The hub refuses such a config at load; the editor refuses to
create it.

```ts continue
const dupe = await tryPlan(configPath, "beacon", path.join(tmp.root, "boxes/lighthouse"));
dupe instanceof HubConfigError
=> true

dupe.message.includes("more than one")
=> true
```

## Reusing a slug for a different box is refused

Repointing a live slug is an operator decision, not something a provisioning
script should do silently.

```ts continue
const repoint = await tryPlan(configPath, "hearth", path.join(tmp.root, "boxes/lighthouse"));
repoint instanceof HubConfigEditError
=> true

repoint.message.includes("already routes to")
=> true
```

## A missing config file is an error, not an invented one

A config written from scratch would drop the port/host/lazy settings the
running hub depends on, so the command names the problem instead.

```ts continue
const missing = await tryPlan(path.join(tmp.root, "nope.json"), "lighthouse", tmp.root);
missing instanceof HubConfigEditError
=> true

missing.message.includes("No hub config at")
=> true
```

## A config the hub would refuse is caught on EVERY path, including the no-op one

The caller restarts the hub after this command succeeds, so "already
registered, nothing to do" against a config the hub cannot load would take the
fleet down at the restart. The current config is validated before the addition
is even considered.

```ts continue
const brokenConfigPath = path.join(tmp.root, "hand-broken.json");
await fs.writeFile(
  brokenConfigPath,
  JSON.stringify({ boxes: { hearth: { path: "./boxes/hearth" }, api: { path: "./boxes/lighthouse" } } }),
);
// "hearth" is already registered there at the same path — the idempotent path.
const onBroken = await tryPlan(brokenConfigPath, "hearth", path.join(tmp.root, "boxes/hearth"));
onBroken instanceof HubConfigError
=> true

onBroken.message.includes("reserved")
=> true
```

## Applying a plan refuses if the file changed underneath it

```ts continue
const racePath = path.join(tmp.root, "race.json");
await fs.writeFile(racePath, JSON.stringify({ boxes: {} }, null, 2) + "\n");
const racePlan = await tryPlan(racePath, "lighthouse", path.join(tmp.root, "boxes/lighthouse"));
racePlan.action
=> added

// Someone else edits the file between the plan and the write.
await fs.writeFile(racePath, JSON.stringify({ boxes: { beacon: { path: "./boxes/hearth" } } }, null, 2) + "\n");
(await tryApply(racePlan)) instanceof HubConfigEditError
=> true

// The other writer's version survives.
Object.keys((await loadHubConfig(racePath)).boxes).join(",")
=> beacon
```

## An unparseable config is an error, not a clobber

```ts continue
const brokenPath = path.join(tmp.root, "broken.json");
await fs.writeFile(brokenPath, "{ this is not json");
const broken = await tryPlan(brokenPath, "lighthouse", path.join(tmp.root, "boxes/lighthouse"));
broken instanceof HubConfigEditError
=> true

broken.message.includes("not valid JSON")
=> true

// Untouched.
await fs.readFile(brokenPath, "utf-8")
=> { this is not json
```
