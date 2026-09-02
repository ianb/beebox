# Renderer display labels (view-tab copy)

`rendererDisplayLabel` (`lib/renderer-display-label.ts`) maps a registered
renderer's `name` — the `?view=` identity, unchanged — to the text
`RendererToggle` shows on the tab: the generic "Card" renderer shows the
card's own type when nothing more specific claims the file, or "Details"
when a type-specific renderer already does; "Source" reads as "Original
text" for card files. Everything else passes through.

```ts setup
import { rendererDisplayLabel } from "../../../src/frontend/src/lib/renderer-display-label.js";
```

## "Card" shows the humanized card type when nothing more specific exists

```ts
rendererDisplayLabel({ registeredName: "Card", filePath: "Bread.recipe.card", hasTypeSpecificRenderer: false })
=> Recipe

rendererDisplayLabel({ registeredName: "Card", filePath: "store/plate.concept-map.card", hasTypeSpecificRenderer: false })
=> Concept map
```

## "Card" reads as "Details" once a type-specific renderer claims the file

```ts
rendererDisplayLabel({ registeredName: "Card", filePath: "Bread.recipe.card", hasTypeSpecificRenderer: true })
=> Details
```

## An unrecognizable path falls back to the registered name, never breaks

```ts
rendererDisplayLabel({ registeredName: "Card", filePath: "no-type-here.card", hasTypeSpecificRenderer: false })
=> Card

rendererDisplayLabel({ registeredName: "Card", filePath: "", hasTypeSpecificRenderer: false })
=> Card
```

## "Source" reads as "Original text" for card files only

```ts
rendererDisplayLabel({ registeredName: "Source", filePath: "Bread.recipe.card", hasTypeSpecificRenderer: false })
=> Original text

rendererDisplayLabel({ registeredName: "Source", filePath: "notes.md", hasTypeSpecificRenderer: false })
=> Source
```

## Every other renderer name is unchanged

```ts
rendererDisplayLabel({ registeredName: "Recipe", filePath: "Bread.recipe.card", hasTypeSpecificRenderer: true })
=> Recipe

rendererDisplayLabel({ registeredName: "Download", filePath: "photo.jpg", hasTypeSpecificRenderer: false })
=> Download
```
