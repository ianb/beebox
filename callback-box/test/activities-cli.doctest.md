# Activities: CLI

The `cb activity` command is the programmatic surface for listing and
creating activity instances. Agents and scripts use it to manage
activities without going through the web UI.

Available subcommands:

    cb activity list                               # all registered activity types
    cb activity new <type> <name> [-d <display>]   # create an instance
    cb activity instances <type>                   # list instances of a type in the current box

Both `list` and `instances` accept `--json` for machine-readable output.

The underlying logic is exposed as plain async functions so tests (and
callers that aren't going through the CLI) can use the same code paths.

```ts setup
import { Activity, ActivityMode, ActivityRegistry } from "../src/activities/index.js";
import type { ActivityInstance } from "../src/activities/index.js";
import {
  listActivityTypes,
  listInstancesOfType,
  createInstance,
} from "../src/cli/commands/activity.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

class HelloMode extends ActivityMode {
  systemPrompt() { return "Hi"; }
  available() { return true; }
}

class Hello extends Activity {
  readonly type = "hello";
  readonly metadata = {
    title: "Hello",
    description: "Say hello",
    iconDescription: "Waving hand",
    singleton: false,
  };
  readonly modes = { main: HelloMode };

  async seedInstance(instance: ActivityInstance, _ctx: { displayName: string }) {
    await instance.writeJson("state.json", { hellos: 0 });
  }
}

class JournalMode extends ActivityMode {
  systemPrompt() { return "Reflect"; }
  available() { return true; }
}

class Journal extends Activity {
  readonly type = "journal";
  readonly metadata = {
    title: "Journal",
    description: "Daily reflection",
    iconDescription: "Notebook",
    singleton: true,
  };
  readonly modes = { main: JournalMode };
}

function makeRegistry() {
  const reg = new ActivityRegistry();
  reg.register(new Hello());
  reg.register(new Journal());
  return reg;
}
```

## Listing registered types

`listActivityTypes` returns a summary row per registered activity.
Agents use `cb activity list --json` to enumerate what's available
before asking the user which activity to start.

```
const registry = makeRegistry();
const types = listActivityTypes(registry);
types.length
=> 2

const hello = types.find((t) => t.type === "hello");
hello && hello.title
=> Hello

hello && hello.singleton
=> false

const journal = types.find((t) => t.type === "journal");
journal && journal.singleton
=> true
```

## Creating an instance

`createInstance` is a thin wrapper over `Activity.createInstance` that
looks up the type in the registry first. A missing type raises
`UnknownActivityTypeError`.

```
const registry = makeRegistry();
const box = await makeTmpBox();

await createInstance(registry, {
  boxRoot: box.root,
  type: "hello",
  name: "priya",
  displayName: "Priya says hi",
});

await box.list("store/activities/hello/priya")
=>
store/activities/hello/priya/.callback-box
store/activities/hello/priya/.callback-box/instance.json
store/activities/hello/priya/state.json
```

```cleanup
await box.cleanup();
```

## Listing instances

`listInstancesOfType` is `Activity.listInstances` with registry lookup:

```
const registry = makeRegistry();
const box = await makeTmpBox();

await createInstance(registry, { boxRoot: box.root, type: "hello", name: "priya", displayName: "Priya" });
await createInstance(registry, { boxRoot: box.root, type: "hello", name: "bea", displayName: "Bea" });

const instances = await listInstancesOfType(registry, { boxRoot: box.root, type: "hello" });
instances.map((i) => i.name).sort().join(",")
=> priya,bea

instances.map((i) => i.displayName).sort().join(" | ")
=> Priya | Bea
```

Listing a type with no instances returns an empty array, not an error:

``` continue
const empty = await listInstancesOfType(registry, { boxRoot: box.root, type: "journal" });
empty.length
=> 0
```

```cleanup
await box.cleanup();
```

## Notes for agents

- The CLI action handlers (`cb activity list`, `new`, `instances`) call
  `createBuiltinRegistry()` internally. In v1 this is a hand-maintained
  set of built-in activities; box-local activity loading is deferred.
- For machine-readable output, use `--json` on `list` and `instances`.
  `new` doesn't need a `--json` flag — it either succeeds silently or
  exits non-zero on error.
- `cb activity new` requires a current box (via `requireBoxRoot()`), so
  run it from inside a box directory or set `CB_BOX_ROOT`.
