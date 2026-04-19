# Activities: Session Pool

`ActivityChatSessionPool` owns one `ChatSession` per
`(boxRoot, activityType, instanceName, modeName)`. The server (and
tRPC routes) ask the pool for a session when a chat request comes
in; the pool reuses an existing session or creates a new one via
`buildActivityChatSessionOptions`.

Tests inject a fake spawner + `skipBootstrap` via the pool's
`chatOptions` so no real subprocess is spawned.

```ts setup
import { Activity, ActivityMode, ActivityRegistry, ActivityChatSessionPool } from "../src/activities/index.js";
import type { ActivityInstance } from "../src/activities/index.js";
import { createFakeClaudeChatSpawner } from "../src/services/claude-chat.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

class PolyglotSetup extends ActivityMode {
  systemPrompt() { return "setup prompt"; }
  available() { return true; }
}

class PolyglotMain extends ActivityMode {
  systemPrompt() { return "main prompt"; }
  available() { return true; }
}

class Polyglot extends Activity {
  readonly type = "polyglot";
  readonly metadata = {
    title: "Polyglot",
    description: "Language learning",
    iconDescription: "Globe",
    singleton: false,
  };
  readonly modes = { setup: PolyglotSetup, main: PolyglotMain };

  async seedInstance(instance: ActivityInstance) {
    await instance.writeJson("state.json", {});
  }
}

async function constantBase() { return "BASE"; }

function makeRegistry() {
  const reg = new ActivityRegistry();
  reg.register(new Polyglot());
  return reg;
}
```

## getOrCreate returns the same session for the same key

The first call constructs a new `ChatSession`; subsequent calls with
the same key return the cached one.

```
const box = await makeTmpBox();
const registry = makeRegistry();
await registry.getOrThrow("polyglot").createInstance({ boxRoot: box.root, name: "es", displayName: "Spanish" });

const spawner = createFakeClaudeChatSpawner();
const pool = new ActivityChatSessionPool(registry, { basePrompt: constantBase, chatOptions: { spawner, skipBootstrap: true } });

const first = await pool.getOrCreate({ boxRoot: box.root, activityType: "polyglot", instanceName: "es", modeName: "setup" });
const second = await pool.getOrCreate({ boxRoot: box.root, activityType: "polyglot", instanceName: "es", modeName: "setup" });
first === second
=> true

pool.size()
=> 1
```

```cleanup
pool.closeAll();
await box.cleanup();
```

## Different modes get different sessions

Each `(activity, instance, mode)` tuple is its own session — the pool
holds them separately and they each get their own `sessionFile` from
`buildActivityChatSessionOptions`.

```
const box = await makeTmpBox();
const registry = makeRegistry();
await registry.getOrThrow("polyglot").createInstance({ boxRoot: box.root, name: "es", displayName: "Spanish" });

const spawner = createFakeClaudeChatSpawner();
const pool = new ActivityChatSessionPool(registry, { basePrompt: constantBase, chatOptions: { spawner, skipBootstrap: true } });

const setup = await pool.getOrCreate({ boxRoot: box.root, activityType: "polyglot", instanceName: "es", modeName: "setup" });
const main = await pool.getOrCreate({ boxRoot: box.root, activityType: "polyglot", instanceName: "es", modeName: "main" });
setup === main
=> false

pool.size()
=> 2
```

```cleanup
pool.closeAll();
await box.cleanup();
```

## Different instances get different sessions

```
const box = await makeTmpBox();
const registry = makeRegistry();
const polyglot = registry.getOrThrow("polyglot");
await polyglot.createInstance({ boxRoot: box.root, name: "es", displayName: "Spanish" });
await polyglot.createInstance({ boxRoot: box.root, name: "fr", displayName: "French" });

const spawner = createFakeClaudeChatSpawner();
const pool = new ActivityChatSessionPool(registry, { basePrompt: constantBase, chatOptions: { spawner, skipBootstrap: true } });

const es = await pool.getOrCreate({ boxRoot: box.root, activityType: "polyglot", instanceName: "es", modeName: "setup" });
const fr = await pool.getOrCreate({ boxRoot: box.root, activityType: "polyglot", instanceName: "fr", modeName: "setup" });
es === fr
=> false

pool.size()
=> 2
```

```cleanup
pool.closeAll();
await box.cleanup();
```

## close() removes a single session

```
const box = await makeTmpBox();
const registry = makeRegistry();
await registry.getOrThrow("polyglot").createInstance({ boxRoot: box.root, name: "es", displayName: "Spanish" });

const spawner = createFakeClaudeChatSpawner();
const pool = new ActivityChatSessionPool(registry, { basePrompt: constantBase, chatOptions: { spawner, skipBootstrap: true } });

const key = { boxRoot: box.root, activityType: "polyglot", instanceName: "es", modeName: "setup" };
await pool.getOrCreate(key);
pool.size()
=> 1

pool.close(key);
pool.size()
=> 0

pool.get(key)
=> null
```

Re-creating after close gives a fresh session (not the previously
closed one):

``` continue
const fresh = await pool.getOrCreate(key);
pool.size()
=> 1
```

```cleanup
pool.closeAll();
await box.cleanup();
```

## closeAll() clears the pool

```
const box = await makeTmpBox();
const registry = makeRegistry();
await registry.getOrThrow("polyglot").createInstance({ boxRoot: box.root, name: "es", displayName: "Spanish" });

const spawner = createFakeClaudeChatSpawner();
const pool = new ActivityChatSessionPool(registry, { basePrompt: constantBase, chatOptions: { spawner, skipBootstrap: true } });

await pool.getOrCreate({ boxRoot: box.root, activityType: "polyglot", instanceName: "es", modeName: "setup" });
await pool.getOrCreate({ boxRoot: box.root, activityType: "polyglot", instanceName: "es", modeName: "main" });
pool.size()
=> 2

pool.closeAll();
pool.size()
=> 0
```

```cleanup
await box.cleanup();
```

## Event bus forwarding

When the pool is constructed with an `eventBus`, it attaches listeners
to every session it creates and forwards `message`, `turn-text`,
`done`, and `close` events to the bus with activity-scoped event
names. Clients consume them via the existing `/api/events` SSE
endpoint.

Event names and payload keys:

- `activity-chat-message` — `{ activityType, instanceName, modeName, msg }`
- `activity-chat-turn-text` — `{ activityType, instanceName, modeName, text }`
- `activity-chat-done` — `{ activityType, instanceName, modeName, result }`
- `activity-chat-close` — `{ activityType, instanceName, modeName, code }`

```ts setup
import { createEventBus } from "../src/core/event-bus.js";
import { once } from "node:events";
import {
  runTurn,
  tick,
} from "./helpers/chat-session-spawner-helpers.js";
```

```
const box = await makeTmpBox();
const registry = makeRegistry();
await registry.getOrThrow("polyglot").createInstance({ boxRoot: box.root, name: "es", displayName: "Spanish" });

const spawner = createFakeClaudeChatSpawner();
const eventBus = createEventBus(box.root);
const pool = new ActivityChatSessionPool(registry, { basePrompt: constantBase, chatOptions: { spawner, skipBootstrap: true }, eventBus });

const received = [];
const sub = eventBus.subscribe({ listener: (e) => received.push(e) });

const session = await pool.getOrCreate({ boxRoot: box.root, activityType: "polyglot", instanceName: "es", modeName: "setup" });
await runTurn(session, { spawner, sessionIdToEmit: "sess-abc" });
await tick();
```

Multiple event types got emitted with the activity scope on each:

``` continue
const eventNames = received.map((e) => e.event);
eventNames.includes("activity-chat-message")
=> true

eventNames.includes("activity-chat-done")
=> true

const done = received.find((e) => e.event === "activity-chat-done");
done.data.activityType
=> polyglot

done.data.modeName
=> setup

done.data.instanceName
=> es
```

```cleanup
pool.closeAll();
await tick();
sub.unsubscribe();
eventBus.close();
await box.cleanup();
```

## Unknown activity type throws

If the activity isn't registered, getOrCreate throws
`UnknownActivityTypeError` — routes should translate that to 404.

```ts setup
import { UnknownActivityTypeError } from "../src/activities/index.js";
async function caught(fn) { try { await fn(); return null; } catch (e) { return e; } }
```

```
const box = await makeTmpBox();
const registry = makeRegistry();
const spawner = createFakeClaudeChatSpawner();
const pool = new ActivityChatSessionPool(registry, { basePrompt: constantBase, chatOptions: { spawner, skipBootstrap: true } });

const err = await caught(() => pool.getOrCreate({ boxRoot: box.root, activityType: "nope", instanceName: "x", modeName: "main" }));
err instanceof UnknownActivityTypeError
=> true
```

```cleanup
pool.closeAll();
await box.cleanup();
```
