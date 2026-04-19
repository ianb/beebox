# Activities: Instance Lifecycle

The `Activity` base class ships with default implementations of
`createInstance` and `listInstances` that handle the filesystem
bookkeeping. Activities override a small `seedInstance` hook to write
their own state files (and an instance `CLAUDE.md`). This doctest shows
what happens on disk when you create and list instances, and how the
hook fits in.

See `activities-base-classes.doctest.md` first for the object model.

```ts setup
import { Activity, ActivityInstance, ActivityMode } from "../src/activities/index.js";
import { ActivityInstanceExistsError } from "../src/activities/Activity.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

async function caught(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

class GreeterMain extends ActivityMode {
  systemPrompt() { return "Greeter"; }
  available() { return true; }
}

class Greeter extends Activity {
  readonly type = "greeter";
  readonly metadata = {
    title: "Greeter",
    description: "Practice saying hello",
    iconDescription: "Waving hand",
    singleton: false,
  };
  readonly modes = { main: GreeterMain };

  async seedInstance(instance: ActivityInstance, { displayName }: { displayName: string }) {
    await instance.writeJson("state.json", { greetedBy: displayName, count: 0 });
    await instance.writeText("CLAUDE.md", `# ${displayName}\n\nA greeter instance.\n`);
  }
}

const greeter = new Greeter();
```

## Creating an instance

`createInstance` creates the instance directory, writes framework
metadata under `.callback-box/`, and then calls `seedInstance` so the
activity can lay down whatever state files it wants.

```
const box = await makeTmpBox();
await greeter.createInstance({ boxRoot: box.root, name: "priya", displayName: "Priya's greeter" });

await box.list("store/activities/greeter/priya")
=>
store/activities/greeter/priya/.callback-box
store/activities/greeter/priya/.callback-box/instance.json
store/activities/greeter/priya/CLAUDE.md
store/activities/greeter/priya/state.json
```

`.callback-box/instance.json` is owned by the framework. It holds the
display name, creation timestamp, and activity type — enough for the
gallery to render a list tile without asking the activity:

``` continue
const meta = JSON.parse(await box.read("store/activities/greeter/priya/.callback-box/instance.json"));
meta.displayName
=> Priya's greeter

meta.type
=> greeter

typeof meta.createdAt
=> string
```

The activity-owned files — written by the `seedInstance` hook — live
alongside and are free to be whatever the activity needs:

``` continue
const state = JSON.parse(await box.read("store/activities/greeter/priya/state.json"));
state.count
=> 0

state.greetedBy
=> Priya's greeter

JSON.stringify(await box.read("store/activities/greeter/priya/CLAUDE.md"))
=> "# Priya's greeter\n\nA greeter instance.\n"
```

```cleanup
await box.cleanup();
```

## Creating a duplicate throws

Attempting to create an instance that already exists throws
`ActivityInstanceExistsError`. This is how the framework stops a user
from clobbering an existing instance by name.

```
const box = await makeTmpBox();
const ctx = { boxRoot: box.root, name: "priya", displayName: "First" };
await greeter.createInstance(ctx);
const thrown = await caught(() => greeter.createInstance(ctx));
thrown instanceof ActivityInstanceExistsError
=> true

thrown && thrown.message
=> Activity instance already exists: greeter/priya
```

```cleanup
await box.cleanup();
```

## Listing instances

`listInstances` returns one `InstanceSummary` per directory it finds
under `store/activities/<type>/`, reading the `.callback-box/instance.json`
metadata from each. Entries without that file (e.g. a stray directory)
are skipped.

```
const box = await makeTmpBox();
await greeter.createInstance({ boxRoot: box.root, name: "priya", displayName: "Priya's greeter" });
await greeter.createInstance({ boxRoot: box.root, name: "bea", displayName: "Bea's greeter" });

const instances = await greeter.listInstances({ boxRoot: box.root });
instances.length
=> 2

instances.map((i) => i.name).sort().join(",")
=> priya,bea

instances.map((i) => i.displayName).sort().join(" | ")
=> Priya's greeter | Bea's greeter
```

Listing a box with no instances returns an empty array — not an error,
even if `store/activities/<type>/` doesn't exist:

``` continue
const empty = await makeTmpBox();
const result = await greeter.listInstances({ boxRoot: empty.root });
result.length
=> 0
```

```cleanup
await box.cleanup();
await empty.cleanup();
```

## Overriding listInstances for richer summaries

The default summary is just `{ name, displayName, createdAt }`. If your
activity wants to surface more (e.g. Polyglot showing the language in
the gallery tile), override `listInstances` or build on top of it. For
most activities the default is enough — the heavy per-instance detail
lives in the sidecar view, not in the summary.

## Writing the seedInstance hook

Activities write their initial state plus an instance `CLAUDE.md` in
`seedInstance`. The `CLAUDE.md` lets non-chat agents (wakeups, manual
edits) understand the instance without reading the activity source. A
common pattern is a short header plus an `@`-include of a generic doc
from the activity source directory:

    # Spanish practice for Priya
    
    Language learning instance. See the generic activity docs:
    
    @../../../../src/activities/polyglot/docs/guide.md

`seedInstance` only runs once, at creation time. For ongoing state
mutations — flashcards added, lessons completed, etc. — activities use
MCP tools during a chat session, not `seedInstance`.
