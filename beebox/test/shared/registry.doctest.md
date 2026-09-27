# Registries

`defineRegistry` is the one way a set directory's members are enumerated.
The call declares the set for the layout check and keys the members at
construction, so a duplicate key fails on the first import.

Every call below writes `<M>` explicitly. Omitting it is a compile error
(`defineRegistry({...})` with no type argument fails to typecheck, since `M`
defaults to `never`), which a doctest cannot express — verified by hand with
`pnpm exec tsc --noEmit -p tsconfig.json` in `beebox/`.

```ts setup
import { defineRegistry } from "../../src/shared/registry.js";

interface Verb { name(): string; }
const verb = (name: string): Verb => ({ name: () => name });
```

## A list with a key function

Unordered registries sort by key, so a reorder in the file is not a
behaviour change.

```ts
const verbs = defineRegistry<Verb>({
  directory: "./commands",
  entry: "command",
  ordered: false,
  key: (v) => v.name(),
  members: [verb("wakeup"), verb("init"), verb("migrate")],
});
JSON.stringify(verbs.keys())
=> ["init","migrate","wakeup"]

verbs.get("init")?.name()
=> init

verbs.get("nope")
=> undefined

JSON.stringify(verbs.list.map((v) => v.name()))
=> ["init","migrate","wakeup"]

Object.isFrozen(verbs) && Object.isFrozen(verbs.list)
=> true
```

## Order as semantics

```ts
const steps = defineRegistry<string>({
  directory: "./migrations",
  ordered: true,
  key: (s) => s,
  members: ["b", "a"],
});
JSON.stringify(steps.keys())
=> ["b","a"]
```

## A record gives keys literally

The layout check verifies each literal key is the member's file or directory
name; the helper only enforces uniqueness (a record cannot repeat a key, so
the check is the only guard for this form).

```ts
const surfaces = defineRegistry<string>({
  directory: "./exports",
  ordered: false,
  members: { schema: "schema.ts", cards: "cards.ts" },
});
JSON.stringify(surfaces.keys())
=> ["cards","schema"]
```

## Duplicate keys throw at construction

```ts
defineRegistry<Verb>({
  directory: "./commands",
  ordered: false,
  key: (v) => v.name(),
  members: [verb("init"), verb("init")],
})
=> throws DuplicateRegistryKeyError: registry ./commands: duplicate key "init"
```
