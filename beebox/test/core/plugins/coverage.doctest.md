# Plugin type coverage

`pluginTypeCoverage` (`src/core/plugins/coverage.ts`) is the pure function
behind the `plugin-type-unprovided` and `plugin-declared-missing` health
checks. It reads three things: the card types on disk, the effective schema
map's type names, and the registry with the active list. The active list alone
decides nothing (`docs/implemented-plans/plugins.md`, Track 3). A declared schema type is
missing when the effective map lacks it; the stub file's presence only sets the
`reason`, `no-file` or `no-schema`.

```ts setup
import { pluginTypeCoverage } from "../../../src/core/plugins/coverage.js";

const courseware = { name: "courseware", schemaTypes: ["course", "concept-map"], viewNames: ["concept-map"] };
const BUILTINS = new Set(["note", "todo"]);
const NO_STUBS = { schemaTypes: new Set(), viewNames: new Set() };

function coverage(overrides) {
  return pluginTypeCoverage({
    typesOnDisk: new Map(),
    effectiveSchemaTypes: BUILTINS,
    plugins: [courseware],
    active: new Set(),
    stubs: NO_STUBS,
    ...overrides,
  });
}
```

## Inactive plugin with cards on disk

The cards have no schema; the plugin that provides it is named with the count.
Nothing is "declared missing" because the plugin is not active.

```ts
coverage({ typesOnDisk: new Map([["course", 3], ["note", 10]]) })
=> { unprovided: [{ plugin: "courseware", type: "course", cards: 3 }], declaredMissing: [] }
```

## Active plugin, no stub, cards on disk

Both signals fire: the cards are unprovided, and the active plugin's
declarations (two types, one view) have no stubs.

```ts
coverage({ typesOnDisk: new Map([["course", 2]]), active: new Set(["courseware"]) })
=> {
  unprovided: [{ plugin: "courseware", type: "course", cards: 2 }],
  declaredMissing: [
    { plugin: "courseware", kind: "schema", name: "course", reason: "no-file" },
    { plugin: "courseware", kind: "schema", name: "concept-map", reason: "no-file" },
    { plugin: "courseware", kind: "view", name: "concept-map", reason: "no-file" },
  ],
}
```

## Active plugin, no stub, no cards

Only the declarations are missing; no card is at risk.

```ts
coverage({ active: new Set(["courseware"]) })
=> {
  unprovided: [],
  declaredMissing: [
    { plugin: "courseware", kind: "schema", name: "course", reason: "no-file" },
    { plugin: "courseware", kind: "schema", name: "concept-map", reason: "no-file" },
    { plugin: "courseware", kind: "view", name: "concept-map", reason: "no-file" },
  ],
}
```

## Stubs present and loaded

The stubs put the types in the effective schema map and the view file on disk,
so nothing is reported, with or without cards.

```ts
coverage({
  typesOnDisk: new Map([["course", 2], ["concept-map", 1]]),
  effectiveSchemaTypes: new Set([...BUILTINS, "course", "concept-map"]),
  active: new Set(["courseware"]),
  stubs: { schemaTypes: new Set(["course", "concept-map"]), viewNames: new Set(["concept-map"]) },
})
=> { unprovided: [], declaredMissing: [] }
```

## A stub file that exists but puts no schema of its type in the map

The type is absent from the effective map, so its cards are unprovided and the
declaration is missing with reason `no-schema`: the file is there, but it
defines some other type, or failed to load (then `plugin-stub-missing` also
reports the failure). File presence never passes a declaration on its own.

```ts
coverage({
  typesOnDisk: new Map([["course", 1]]),
  active: new Set(["courseware"]),
  stubs: { schemaTypes: new Set(["course", "concept-map"]), viewNames: new Set(["concept-map"]) },
})
=> {
  unprovided: [{ plugin: "courseware", type: "course", cards: 1 }],
  declaredMissing: [
    { plugin: "courseware", kind: "schema", name: "course", reason: "no-schema" },
    { plugin: "courseware", kind: "schema", name: "concept-map", reason: "no-schema" },
  ],
}
```

## A type two plugins both declare

Each plugin is named for the same unprovided type; only the active one has a
missing declaration.

```ts
const other = { name: "syllabus", schemaTypes: ["course"], viewNames: [] };
coverage({
  typesOnDisk: new Map([["course", 4]]),
  plugins: [courseware, other],
  active: new Set(["syllabus"]),
})
=> {
  unprovided: [
    { plugin: "courseware", type: "course", cards: 4 },
    { plugin: "syllabus", type: "course", cards: 4 },
  ],
  declaredMissing: [{ plugin: "syllabus", kind: "schema", name: "course", reason: "no-file" }],
}
```
