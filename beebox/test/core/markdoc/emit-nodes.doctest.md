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

## `{% todo %}` emits a checklist-style status marker, not just the text

`todo` (`markdoc/emit-tags.ts`'s universal group) is a *handled* tag, unlike
the degrading groups above — this section pins its markdown shape since no
other doctest exercises the backend emitter's tag dispatch for it. Absence
of `status` is `open` (`☐`); `done`/`dropped` also strike the text.

```ts
JSON.stringify(emitBodyAsMarkdown("{% todo %}\n\nCall the vet\n\n{% /todo %}"))
=> "☐ Call the vet\n\n"

JSON.stringify(emitBodyAsMarkdown('{% todo status="done" %}\n\nCall the vet\n\n{% /todo %}'))
=> "✔ ~~Call the vet~~\n\n"

JSON.stringify(emitBodyAsMarkdown('{% todo status="dropped" %}\n\nCall the vet\n\n{% /todo %}'))
=> "✘ ~~Call the vet~~ (dropped)\n\n"

JSON.stringify(emitBodyAsMarkdown('{% todo status="parked" %}\n\nCall the vet\n\n{% /todo %}'))
=> "⏸ Call the vet (parked)\n\n"
```

Inline form emits with no trailing blank line, same as `quote`/`source`:

```ts
JSON.stringify(emitBodyAsMarkdown("Remember to {% todo %}call the vet{% /todo %} today."))
=> "Remember to ☐ call the vet today.\n\n"
```

## `{% see-also %}` emits its text plus a `[→ ref]`-style citation

Same bracketed-citation shape `source` already uses for `ref`/`href` — no
inline/block split (`see-also` always transforms to one `SeeAlso` tag).

```ts
JSON.stringify(emitBodyAsMarkdown('{% see-also ref="people/dana.person.card" %}Dana offered to pick it up{% /see-also %}'))
=> "Dana offered to pick it up [→ dana]\n\n"

JSON.stringify(emitBodyAsMarkdown('{% see-also href="https://example.com/thread" %}the original request{% /see-also %}'))
=> "the original request [→ thread]\n\n"
```

A `todo` with a nested `see-also` emits both, the marker prefixing the
whole accumulated block:

```ts
const nested = '{% todo id="vet-refill" %}\n\nCall the vet\n\n{% see-also ref="people/dana.person.card" %}Dana offered to pick it up{% /see-also %}\n\n{% /todo %}';
JSON.stringify(emitBodyAsMarkdown(nested))
=> "☐ Call the vet\n\nDana offered to pick it up [→ dana]\n\n"
```

## `{% source %}` carries its `usage` text into the bracket citation

The schema's attribute is `usage` (`shared/markdoc-config.ts`); the emitter
read the pre-rename `as` spelling for months, silently dropping every modern
tag's usage text from compiled output. Both spellings emit now — `usage`
preferred, `as` kept for cards written before the rename.

```ts
JSON.stringify(emitBodyAsMarkdown('{% source ref="_content/recipes/stew.recipe.card" usage="verbatim" %}Browning first is the whole trick.{% /source %}'))
=> "Browning first is the whole trick. [→ stew: verbatim]\n\n"

JSON.stringify(emitBodyAsMarkdown('{% source ref="_content/recipes/stew.recipe.card" %}Browning first is the whole trick.{% /source %}'))
=> "Browning first is the whole trick. [→ stew]\n\n"
```
