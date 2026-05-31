# Selection position formatting

`formatPosition(parts)` renders the `SelectionParts` extracted from a
document selection into the freeform `position` string carried by a
`<user-selection>` tag. The agent reads it as a rough locator, not an exact
offset. Clauses are omitted when their part is null.

The DOM-walking half (`extractSelection`) is verified in the browser, since
it depends on the live rendered document; this covers the pure formatter.

```ts setup
import { formatPosition } from "../src/frontend/src/lib/selection-position.js";
```

## All parts present

```
formatPosition({
  section: "body",
  heading: { text: "Proofing the dough", id: "proofing-the-dough" },
  paragraph: 2,
  line: 42,
})
=>
body; heading: Proofing the dough (#proofing-the-dough); paragraph 2; ~line 42
```

## No heading above the selection — clause omitted

```
formatPosition({ section: "body", heading: null, paragraph: 3, line: null })
=>
body; paragraph 3
```

## Heading and line, no section or paragraph

```
formatPosition({
  section: null,
  heading: { text: "Notes", id: "notes" },
  paragraph: null,
  line: 5,
})
=>
heading: Notes (#notes); ~line 5
```

## Frontmatter selection

```
formatPosition({ section: "frontmatter", heading: null, paragraph: null, line: null })
=>
frontmatter
```

## Nothing determinable yields an empty string

```
JSON.stringify(formatPosition({ section: null, heading: null, paragraph: null, line: null }))
=>
""
```
