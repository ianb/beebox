# Activities: Registry

The `ActivityRegistry` is where activity types are registered and
looked up. The framework exposes one global built-in registry
(populated by `createBuiltinRegistry`) that the CLI, tRPC routes, and
chat session all consult. Tests can create their own registry in
isolation.

See `activities-base-classes.doctest.md` for what an `Activity`
subclass looks like.

```ts setup
import { Activity, ActivityMode } from "../src/activities/index.js";
import {
  ActivityRegistry,
  ActivityTypeAlreadyRegisteredError,
  UnknownActivityTypeError,
} from "../src/activities/registry.js";

async function caught(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

class FooMode extends ActivityMode {
  systemPrompt() { return ""; }
  available() { return true; }
}

class Foo extends Activity {
  readonly type = "foo";
  readonly metadata = {
    title: "Foo",
    description: "",
    iconDescription: "",
    singleton: false,
  };
  readonly modes = { main: FooMode };
}

class Bar extends Activity {
  readonly type = "bar";
  readonly metadata = {
    title: "Bar",
    description: "",
    iconDescription: "",
    singleton: true,
  };
  readonly modes = { main: FooMode };
}
```

## Register and look up

```
const reg = new ActivityRegistry();
reg.register(new Foo());
reg.register(new Bar());

reg.has("foo")
=> true

reg.has("baz")
=> false

const foo = reg.get("foo");
foo && foo.metadata.title
=> Foo

reg.list().map((a) => a.type).sort().join(",")
=> bar,foo
```

## Duplicate registration throws

Registering two activities with the same `type` is a programming error
— activities are identified by type, so a duplicate would mean two
class definitions competing for the same slot.

```
const reg = new ActivityRegistry();
reg.register(new Foo());
const thrown = await caught(() => reg.register(new Foo()));
thrown instanceof ActivityTypeAlreadyRegisteredError
=> true

thrown && thrown.message
=> Activity type already registered: foo
```

## Unknown type

`get` returns `undefined` for unknown types; `getOrThrow` throws
`UnknownActivityTypeError`. Use `getOrThrow` in contexts where a
missing activity is a bug (the caller already checked `has`); use
`get` when handling user input that might reference a nonexistent type.

```
const reg = new ActivityRegistry();

reg.get("nope")
=> undefined

const thrown = await caught(() => reg.getOrThrow("nope"));
thrown instanceof UnknownActivityTypeError
=> true

thrown && thrown.message
=> Unknown activity type: nope
```

## Built-in registry

`createBuiltinRegistry()` returns the framework's hand-maintained set
of built-in activities. V1 ships empty — activities are added here as
they're ported. Box-local discovery is a separate (deferred) feature.

```ts setup
import { createBuiltinRegistry } from "../src/activities/registry.js";
```

```
const builtin = createBuiltinRegistry();
builtin.list().length
=> 0
```
