# Per-agent model carry

A session's provider must not change mid-life: re-invocations that omit a
model (the commit-nudge retry) resume the same session, so they must reuse
the model of the invocation that created it.

```ts setup
import { createModelCarrier } from "../../../src/core/agent/model-carry.js";
```

## Omitted models ride the first explicit one

```ts
const carrier = createModelCarrier();
carrier.resolve("glm-5.3");
carrier.resolve(undefined)
=> glm-5.3

carrier.resolve(undefined)
=> glm-5.3
```

## An explicit model replaces the carried one

A caller naming a model still wins — the carry only fills absences.

```ts continue
carrier.resolve("glm-5.3-flash");
carrier.resolve(undefined)
=> glm-5.3-flash
```

## Never-carried instances pass undefined through

An agent whose callers never named a model keeps the harness default — the
carry must not invent one.

```ts
const bare = createModelCarrier();
bare.resolve(undefined)
=> undefined
```
