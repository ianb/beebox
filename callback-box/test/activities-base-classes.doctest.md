# Activities: Base Classes

An **activity** is a reusable container for one shape of chat experience
(language learning, notebook, journaling, …). An **instance** is one
running experience of that activity, bound to a directory on disk. A
**mode** is a framing of the instance — `setup`, `main`, `parent-review`,
etc. — and modes of the same instance share state files but have their
own system prompts and tools.

This doctest walks you through building a minimal activity with the
three base classes. Read `docs/activities-design.md` first for the full
design rationale.

```ts setup
import { Activity, ActivityInstance, ActivityMode } from "../src/activities/index.js";
import type { ActivityMcpConfig } from "../src/activities/index.js";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Step 1 — define a mode

A mode is a subclass of `ActivityMode`. You must implement `systemPrompt()`
and `available()`. `mcpServer()` is optional — the base class returns
`null` (no tools) by default. `isDefault = true` marks this mode as the
one the framework picks when the user hasn't asked for a specific mode.

```ts setup
class GreeterMain extends ActivityMode {
  readonly isDefault = true;

  systemPrompt() {
    return "You are a greeter. Call the `greet` tool when the user says hello.";
  }

  available() {
    return true;
  }
}
```

## Step 2 — define the activity

The `Activity` subclass describes the *type*: its name, metadata for the
UI, and the map of modes. The base class provides default
`listInstances` and `createInstance` methods that scan and initialize
`store/activities/<type>/` — so a minimal activity only declares type +
metadata + modes. See `activities-lifecycle.doctest.md` for details on
those methods and the `seedInstance` hook for writing per-instance
state.

```ts setup
class Greeter extends Activity {
  readonly type = "greeter";
  readonly metadata = {
    title: "Greeter",
    description: "Practice saying hello",
    iconDescription: "Waving hand",
    singleton: true,
  };
  readonly modes = { main: GreeterMain };
}

const greeter = new Greeter();
```

Check the activity's shape. (Each non-`setup` block in a doctest gets a
fresh scope, so share values either by declaring them in a `ts setup`
block as we did here, or by chaining with ` ``` continue ` blocks.)

```
greeter.type
=> greeter

greeter.metadata.title
=> Greeter

JSON.stringify(Object.keys(greeter.modes))
=> ["main"]
```

## Step 3 — bind a mode to an instance

An instance is a directory; `ActivityInstance` wraps it. The framework
constructs modes by calling `new ModeClass(instance)`.

```
const box = await makeTmpBox();
const instance = new ActivityInstance(box.path("store/activities/greeter/the-one"));
const ModeClass = greeter.modes.main;
const mode = new ModeClass(instance);

mode.systemPrompt()
=> You are a greeter. Call the `greet` tool when the user says hello.

mode.available()
=> true

mode.isDefault
=> true

mode.mcpServer()
=> null
```

```cleanup
await box.cleanup();
```

## Step 4 — use the instance state helpers

`ActivityInstance` ships with helpers for reading and writing files in
the instance directory. The layout of those files is entirely up to
the activity — the framework has no opinions about it.

```
const box = await makeTmpBox();
const instance = new ActivityInstance(box.path("instance"));
instance.name
=> instance

await instance.writeJson("state.json", { greetings: 0 });
const state = await instance.readJson("state.json");
JSON.stringify(state)
=> {"greetings":0}

await instance.writeJson("state.json", { greetings: 3 });
const updated = await instance.readJson("state.json");
JSON.stringify(updated)
=> {"greetings":3}
```

Append-only event logs use `appendJsonl`:

``` continue
await instance.appendJsonl("events.jsonl", { type: "hello", at: "2026-04-18" });
await instance.appendJsonl("events.jsonl", { type: "hello", at: "2026-04-19" });
const events = await instance.readJsonl("events.jsonl");
events.length
=> 2
```

Parent directories are created automatically, so activities can write
into subdirectories without `mkdir` ceremony:

``` continue
await instance.writeText("notes/first.md", "hello world");
await instance.readText("notes/first.md")
=> hello world
```

```cleanup
await box.cleanup();
```

## Step 5 — availability that depends on state

The handoff from `setup` to `main` is driven by dynamic availability, not
by a marker file. A `main` mode reads state and returns `false` until
the state is sufficient to run. When setup has written the needed
fields, `available()` flips to `true` and the UI surfaces the new mode.

```ts setup
interface GreeterState { name: string | null }

class GreeterMainStrict extends ActivityMode {
  systemPrompt() { return "Greet the user by name."; }
  async available() {
    const state = await this.instance.readJson<GreeterState>("state.json");
    return state.name !== null;
  }
}
```

```
const box = await makeTmpBox();
const instance = new ActivityInstance(box.path("instance"));
await instance.writeJson("state.json", { name: null });

const mode = new GreeterMainStrict(instance);
await mode.available()
=> false

await instance.writeJson("state.json", { name: "Priya" });
await mode.available()
=> true
```

```cleanup
await box.cleanup();
```

## Step 6 — MCP tools per mode

Modes that need tools return an `ActivityMcpConfig` from `mcpServer()`.
The framework registers the in-process MCP server with the SDK and the
tool handlers run in the box server process — no subprocess hop, no
env-var passing. Handlers close over `this.instance` directly.

```ts setup
class GreeterWithTools extends ActivityMode {
  systemPrompt() { return "Use the greet tool."; }
  available() { return true; }
  mcpServer(): ActivityMcpConfig {
    return createSdkMcpServer({ name: "greeter-main", version: "0.1.0", tools: [] });
  }
}
```

```
const box = await makeTmpBox();
const instance = new ActivityInstance(box.path("instance"));
const mode = new GreeterWithTools(instance);
const cfg = mode.mcpServer();
cfg !== null && cfg.name
=> greeter-main
```

```cleanup
await box.cleanup();
```

## Summary

You've built a complete activity from the base classes. To ship a real one:

1. Pick a location: `src/activities/<type>/` for built-in, `<box>/activities/<type>/src/` for box-local.
2. One `ActivityMode` subclass per mode. Required: `systemPrompt()`, `available()`. Optional: `mcpServer()`, `isDefault`.
3. One `Activity` subclass: `type`, `metadata`, `modes`, `listInstances()`, `createInstance()`.
4. Inside `createInstance`, seed any files the activity needs and write an instance `CLAUDE.md` so non-chat agents have context.
5. Access instance state from any mode method via `this.instance.readJson / writeJson / …`.
6. The framework registers the in-process MCP server with the SDK, resolves the system prompt once per session, and evaluates availability.

See `src/activities/polyglot/` for a worked example.
