# Markdoc emit-nodes: graceful degradation

`emitNode`'s dispatch table (`src/core/markdoc/emit-nodes.ts`) enumerates all
28 members of Markdoc's vendor `NodeType` union. Most of this module's
coverage comes indirectly through the other `markdoc-*.doctest.md` files and
`briefing-compile.doctest.md`, which exercise the handled types (headings,
lists, tags, …). This file targets the *degrading* groups specifically —
node types the emitter doesn't have bespoke handling for, where the
contract is "emit the children, never crash."

```ts setup
import { emitBodyAsMarkdown } from "../../../src/core/markdoc/emit.js";
```

## A GFM table degrades to its flattened cell text

Tables aren't part of the briefing/recipe vocabulary. `table`, `thead`,
`tbody`, `tr`, `th`, and `td` all fall through to the shared "emit children"
handler — no grid, no cell separators, just the concatenated text runs.

```ts
const withTable = "| a | b |\n| - | - |\n| 1 | 2 |\n\nfoo\n";
JSON.stringify(emitBodyAsMarkdown(withTable))
=> "ab12foo\n\n"
```

## A parse error node degrades to nothing, not a crash

Markdoc's `{% /* ... */ %}` comment syntax is off by default in the config
this emitter parses with (no `Config` is passed to `parse`), so a stray
`{% /* ... */ %}` in a body becomes an `error` node instead of a `comment`
node. Either way the emitter degrades the same way — emit the node's
children (there are none) and move on; the surrounding paragraphs still
render.

```ts
const withBadTag = "foo\n\n{% /* a comment */ %}\n\nbar\n";
JSON.stringify(emitBodyAsMarkdown(withBadTag))
=> "foo\n\nbar\n\n"
```
