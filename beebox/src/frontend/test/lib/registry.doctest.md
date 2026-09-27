# Registries (frontend copy)

Package-local copy of `beebox/src/lib/registry.ts`'s `defineRegistry` (see
that module's header for why it is duplicated rather than shared). Backs
`src/renderers.ts`'s renderer registry.

```ts setup
import { defineRegistry } from "../../src/lib/registry.js";

interface Verb { name(): string; }
const verb = (name: string): Verb => ({ name: () => name });
```

## A list with a key function

```ts
const verbs = defineRegistry<Verb>({
  directory: "./renderers",
  ordered: false,
  key: (v) => v.name(),
  members: [verb("markdown"), verb("image"), verb("binary")],
});
JSON.stringify(verbs.keys())
=> ["binary","image","markdown"]

verbs.get("image")?.name()
=> image

Object.isFrozen(verbs) && Object.isFrozen(verbs.list)
=> true
```

## Order as semantics

```ts
const ordered = defineRegistry<string>({
  directory: "./renderers",
  ordered: true,
  key: (s) => s,
  members: ["b", "a"],
});
JSON.stringify(ordered.keys())
=> ["b","a"]
```

## Duplicate keys throw at construction

```ts
defineRegistry<Verb>({
  directory: "./renderers",
  ordered: false,
  key: (v) => v.name(),
  members: [verb("image"), verb("image")],
})
=> throws DuplicateRegistryKeyError: registry ./renderers: duplicate key "image"
```
