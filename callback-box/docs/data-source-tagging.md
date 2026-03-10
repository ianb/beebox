# Data Source Tagging Convention

UI elements that display data from a known source should be tagged with `data-cb-source` attributes. This enables tooling, debugging, and future features (like "view source" overlays or context-aware interactions) to trace what's on screen back to its origin.

## Attributes

### `data-cb-source`

Space-separated list of `type:identifier` pairs indicating where the displayed data comes from.

**Types:**

| Type | Identifier | Example |
|------|-----------|---------|
| `card` | Relative path to the card file | `card:store/todos/Shopping.todo-list.card` |
| `commit` | Git commit hash | `commit:abc1234` |
| `api` | API endpoint or tRPC procedure name | `api:status.questions` |
| `dir` | Directory path being browsed | `dir:store/recipes` |
| `session` | Chat session ID | `session:abc-123-def` |
| `schedule` | Schedule name | `schedule:daily-wakeup` |

Multiple sources on one element are space-separated:

```tsx
<div data-cb-source="card:store/news/brief.card card:store/news/source.card">
```

### `data-cb-source-item`

Optional natural-language description of which part of the source this element represents. Use when multiple sibling elements reference the same source but show different parts of it.

```tsx
<div data-cb-source="card:store/todos/Shopping.todo-list.card" data-cb-source-item="item: Buy milk">
  <span>Buy milk</span>
</div>
```

This is free-form text — not a structured identifier. It should be human-readable and describe what sub-element within the source card/data this UI element represents.

## Where to Apply

Tag the **outermost container** that corresponds to a single data source. Don't tag every inner element — just the meaningful boundary.

**Good** — tag the card-level container:
```tsx
<div data-cb-source={`card:${list.relativePath}`}>
  <h2>{list.name}</h2>
  {list.items.map(item => (
    <div key={item.name} data-cb-source-item={`item: ${item.name}`}>
      ...
    </div>
  ))}
</div>
```

**Bad** — redundant tagging on every inner element:
```tsx
<div data-cb-source={`card:${path}`}>
  <h2 data-cb-source={`card:${path}`}>{name}</h2>  {/* redundant */}
  <p data-cb-source={`card:${path}`}>{details}</p>  {/* redundant */}
</div>
```

## Utility

Use the `cbSource` helper from `src/frontend/src/lib/source-tag.ts`:

```tsx
import { cbSource, cbSourceItem } from "../lib/source-tag";

// Single source
<div {...cbSource("card", list.relativePath)}>

// Multiple sources
<div {...cbSource(["card", path1], ["card", path2])}>

// With item description
<div {...cbSource("card", path)} {...cbSourceItem(`item: ${item.name}`)}>
```

## Guidelines

1. **Tag data boundaries, not layout.** A card container gets tagged, not its wrapper div or grid cell.
2. **Prefer card paths when available.** If the data came from a card file, use `card:relative/path`.
3. **Use `api:` for aggregated data.** Dashboard widgets that pull from tRPC endpoints use `api:procedure.name`.
4. **Don't tag static UI.** Navigation, headers, buttons, and chrome don't need source tags.
5. **Inherit, don't repeat.** If a parent has `data-cb-source`, children within that boundary don't need it again unless they have a *different* or more specific source.
6. **`data-cb-source-item` is always a child.** It only makes sense on an element whose parent (or self) has `data-cb-source`.
