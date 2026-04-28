# Activities: tRPC Router

The `activities` tRPC router exposes the same operations as the CLI
over HTTP for the frontend to consume. It's a thin wrapper over the
registry + `Activity` base class methods.

Procedures:

- `activities.listTypes` (query) → `ActivityTypeInfo[]`
- `activities.listInstances` (query) `{ type }` → `InstanceSummary[]`
- `activities.create` (mutation) `{ type, name, displayName }` → `InstanceSummary`

Errors from the base class are translated into tRPC error codes:
`UnknownActivityTypeError` → `NOT_FOUND`, `ActivityInstanceExistsError`
→ `CONFLICT`.

```ts setup
import { Activity, ActivityChatSessionPool, ActivityMode, ActivityRegistry } from "../src/activities/index.js";
import type { ActivityInstance, InstanceSummary } from "../src/activities/index.js";
import { appRouter } from "../src/webapp/trpc/router.js";
import { createFakeClaudeChatSpawner } from "../src/services/claude-chat.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

class HelloSetup extends ActivityMode {
  systemPrompt() { return "Set me up"; }
  available() { return true; }
}

class HelloMain extends ActivityMode {
  readonly isDefault = true;
  systemPrompt() { return "Hi"; }
  async available() {
    const state = await this.instance.readJson("state.json");
    return state.ready === true;
  }
}

class Hello extends Activity {
  readonly type = "hello";
  readonly metadata = {
    title: "Hello",
    description: "Say hello",
    iconDescription: "Wave",
    singleton: false,
  };
  readonly modes = { setup: HelloSetup, main: HelloMain };

  async seedInstance(instance: ActivityInstance, _ctx: { displayName: string }) {
    await instance.writeJson("state.json", { ready: false, count: 0 });
  }
}

async function constantBase() { return "BASE"; }

function makeCtx(boxRoot: string) {
  const activityRegistry = new ActivityRegistry();
  activityRegistry.register(new Hello());
  const spawner = createFakeClaudeChatSpawner();
  const activityChatPool = new ActivityChatSessionPool(activityRegistry, { basePrompt: constantBase, chatOptions: { spawner, skipBootstrap: true } });
  return {
    boxRoot,
    boxSlug: "test",
    activityRegistry,
    activityChatPool,
    _testSpawner: spawner,
    // Fields below are required by TrpcContext but not used by the activities router.
    // Tests in this file don't touch them.
    eventBus: null,
    services: {},
  };
}

async function caught(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
```

## listTypes returns registered activities

```
const box = await makeTmpBox();
const caller = appRouter.createCaller(makeCtx(box.root));
const types = await caller.activities.listTypes();
types.length
=> 1

const hello = types[0];
hello.type
=> hello

hello.title
=> Hello
```

```cleanup
await box.cleanup();
```

## listInstances + create round-trip

Creating an instance and then listing it returns the expected summary:

```
const box = await makeTmpBox();
const caller = appRouter.createCaller(makeCtx(box.root));

const before = await caller.activities.listInstances({ type: "hello" });
before.length
=> 0

const created = await caller.activities.create({
  type: "hello",
  name: "priya",
  displayName: "Priya's hello",
});
created.name
=> priya

created.displayName
=> Priya's hello

const after = await caller.activities.listInstances({ type: "hello" });
after.length
=> 1
```

```cleanup
await box.cleanup();
```

## Unknown type → NOT_FOUND

Requesting a type that isn't in the registry raises a tRPC error with
code `NOT_FOUND`. The frontend can surface this as a 404.

```
const box = await makeTmpBox();
const caller = appRouter.createCaller(makeCtx(box.root));
const err = await caught(() => caller.activities.listInstances({ type: "nope" }));
err && err.code
=> NOT_FOUND

err && err.message
=> Unknown activity type: nope
```

```cleanup
await box.cleanup();
```

## Duplicate create → CONFLICT

Creating an instance with a name that already exists raises a tRPC
error with code `CONFLICT`.

```
const box = await makeTmpBox();
const caller = appRouter.createCaller(makeCtx(box.root));
await caller.activities.create({ type: "hello", name: "priya", displayName: "First" });
const err = await caught(() =>
  caller.activities.create({ type: "hello", name: "priya", displayName: "Second" }),
);
err && err.code
=> CONFLICT
```

```cleanup
await box.cleanup();
```

## Input validation

Instance names are validated: they must be alphanumeric with hyphens
or underscores. Invalid names fail with code `BAD_REQUEST` before any
filesystem work happens.

```
const box = await makeTmpBox();
const caller = appRouter.createCaller(makeCtx(box.root));
const err = await caught(() =>
  caller.activities.create({ type: "hello", name: "bad name!", displayName: "X" }),
);
err && err.code
=> BAD_REQUEST
```

```cleanup
await box.cleanup();
```

## getModes reflects dynamic availability

`activities.getModes` returns the list of modes whose `available()` is
currently true, plus the framework-chosen default entry mode. A
freshly-seeded Hello instance only has `setup` available — the `main`
mode flips on only once state marks the instance ready.

```
const box = await makeTmpBox();
const ctx = makeCtx(box.root);
const caller = appRouter.createCaller(ctx);
await caller.activities.create({ type: "hello", name: "priya", displayName: "Priya" });

const before = await caller.activities.getModes({ type: "hello", instance: "priya" });
before.modes.map((m) => m.name).sort().join(",")
=> setup

before.defaultMode
=> setup
```

Flip the readiness flag on disk and main becomes available — and
because main is marked `isDefault`, it now wins as the default entry:

``` continue
const activity = ctx.activityRegistry.getOrThrow("hello");
const instance = activity.getInstance(activity.instanceRoot(box.root, "priya"));
await instance.writeJson("state.json", { ready: true, count: 0 });

const after = await caller.activities.getModes({ type: "hello", instance: "priya" });
after.modes.map((m) => m.name).sort().join(",")
=> main,setup

after.defaultMode
=> main
```

`getModes` on an unknown activity type returns `NOT_FOUND`:

``` continue
const err = await caught(() => caller.activities.getModes({ type: "nope", instance: "x" }));
err && err.code
=> NOT_FOUND
```

```cleanup
ctx.activityChatPool.closeAll();
await box.cleanup();
```

## send routes to the chat pool

`activities.send` accepts a message for `(type, instance, mode)`. The
pool creates a ChatSession on first send (with the fake spawner in
tests) and reuses it thereafter. `send` returns immediately with the
session id (null until Claude assigns one) — responses stream over
SSE, not through this mutation.

```
const box = await makeTmpBox();
const ctx = makeCtx(box.root);
const caller = appRouter.createCaller(ctx);
await caller.activities.create({ type: "hello", name: "priya", displayName: "Priya" });

const first = await caller.activities.send({ type: "hello", instance: "priya", mode: "setup", text: "hi" });
first.accepted
=> true

first.sessionId
=> null
```

The pool now holds one session, and the fake spawner received the right
env vars + system prompt (composed from basePrompt + mode prompt):

``` continue
ctx.activityChatPool.size()
=> 1

const proc = ctx._testSpawner.lastProcess();
proc.spawnOptions.env.CB_ACTIVITY_NAME
=> hello

proc.spawnOptions.env.CB_ACTIVITY_MODE
=> setup

proc.spawnOptions.systemPrompt.includes("Set me up")
=> true
```

```cleanup
ctx.activityChatPool.closeAll();
await box.cleanup();
```

## send → unknown type / mode → NOT_FOUND

```
const box = await makeTmpBox();
const ctx = makeCtx(box.root);
const caller = appRouter.createCaller(ctx);
await caller.activities.create({ type: "hello", name: "priya", displayName: "Priya" });

const errType = await caught(() => caller.activities.send({ type: "nope", instance: "priya", mode: "setup", text: "hi" }));
errType && errType.code
=> NOT_FOUND

const errMode = await caught(() => caller.activities.send({ type: "hello", instance: "priya", mode: "nope", text: "hi" }));
errMode && errMode.code
=> NOT_FOUND
```

```cleanup
ctx.activityChatPool.closeAll();
await box.cleanup();
```

## resetSession clears pool entry

`activities.resetSession` stops the current chat subprocess, deletes
the saved session-id pointer, and evicts the pool entry. The next
`send` starts fresh.

```
const box = await makeTmpBox();
const ctx = makeCtx(box.root);
const caller = appRouter.createCaller(ctx);
await caller.activities.create({ type: "hello", name: "priya", displayName: "Priya" });

await caller.activities.send({ type: "hello", instance: "priya", mode: "setup", text: "hi" });
ctx.activityChatPool.size()
=> 1

const r = await caller.activities.resetSession({ type: "hello", instance: "priya", mode: "setup" });
r.ok
=> true

ctx.activityChatPool.size()
=> 0
```

```cleanup
ctx.activityChatPool.closeAll();
await box.cleanup();
```

## Notes

- This router takes its registry from `ctx.activityRegistry` and its
  chat pool from `ctx.activityChatPool`. In production both are
  created once per `createServer` call. In tests, construct them
  manually with the fake spawner as shown in `makeCtx`.
- Prefer `appRouter.createCaller` over injecting HTTP requests when you
  don't need to exercise the transport layer — it's faster and the
  error surface is easier to assert on.
- `send` doesn't return assistant text. Clients consume responses via
  the existing SSE event bus — wiring that to the activity chat
  sessions is the next layer.
