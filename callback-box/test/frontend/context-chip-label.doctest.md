# Context chip face label

`contextChipLabel` (`components/chat/context-chip-label.ts`) chooses the
context chip's face text from the landmark query result plus the chat's
bound directory. `dir` is a tri-state: `null` (no context at all) and `""`
(context IS the box root) are distinct and must not collapse to the same
label.

```ts setup
import { contextChipLabel } from "../../src/frontend/src/components/chat/context-chip-label.js";
```

## Landmark label wins when present

```ts
contextChipLabel({ landmarkLabel: "Recipes", dir: "store/recipes" })
=> Recipes
```

A landmark label wins even over a root dir — it's a more specific name than
"Box root".

```ts
contextChipLabel({ landmarkLabel: "Home", dir: "" })
=> Home
```

## No landmark label: basename of a nested dir

```ts
contextChipLabel({ landmarkLabel: null, dir: "store/recipes" })
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

## Landmark query still pending: falls back to the basename immediately

A slow or failed landmark query reports `landmarkLabel: null` until it
resolves; the face still renders the dir's basename rather than waiting.

```ts
contextChipLabel({ landmarkLabel: null, dir: "projects/2026-q3" })
=> 2026-q3
```
