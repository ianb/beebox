# Context chip face label

`contextChipLabel` (`components/chat/context-chip-label.ts`) chooses the
context chip's face text from the landmark query result plus the chat's
bound directory. `dir` is a tri-state: `null` (no context at all) and `""`
(context IS the box root) are distinct and must not collapse to the same
label.

```ts setup
import { contextChipLabel } from "../../../../../src/components/chat/everywhere/InteractiveChat/context-chip-label.js";
```

## Landmark label wins when present

A landmark label wins even over a root dir — it's a more specific name than
"Box root".

```ts
contextChipLabel({ landmarkLabel: "Home", dir: "" })
=> Home
```

## No landmark label: basename of a nested dir

```ts
contextChipLabel({ landmarkLabel: null, dir: "_content/recipes" })
=> recipes
```

## Empty landmark label: treated as absent, not returned

A label-less landmark card (e.g. a destinations-only landmark) must not
blank the face — `""` falls through the same way `null` does.

```ts
contextChipLabel({ landmarkLabel: "", dir: "_content/recipes" })
=> recipes
```

## No landmark label, root dir: "Box root", not "Files"

The empty string is a real value meaning box root — it must not fall
through to the no-context label.

```ts
contextChipLabel({ landmarkLabel: null, dir: "" })
=> Box root
```

## No context at all: "Files"

```ts
contextChipLabel({ landmarkLabel: null, dir: null })
=> Files
```
