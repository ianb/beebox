# Comment anchors round-trip (src/frontend/lib/selection-anchor.ts)

A comment carries `quoted` — the selected text, verbatim — plus an optional
serialized text fragment. The quoted text is the payload, because the reader
that matters is an agent running `cat` on a YAML file; the fragment only buys
in-page highlighting while the boxholder is still on the page.

These two functions must be exact inverses, because one runs at capture and the
other at render, hours apart. Everything else in the module needs a live
`Selection` or the CSS Custom Highlight API, so it is exercised in a browser
rather than here.

```ts setup
import { parseFragment, serializeFragment } from "../src/frontend/lib/selection-anchor.js";

// Key ORDER is an artifact of how the parser builds its object; the contract is
// the values. Normalize so a reordering does not read as a regression.
function roundTrip(fragment: Record<string, string>) {
  const parsed = parseFragment(serializeFragment(fragment));
  if (parsed === null) return "null";
  const ordered: Record<string, string> = {};
  if (parsed.prefix !== undefined) ordered.prefix = parsed.prefix;
  if (parsed.textStart !== undefined) ordered.textStart = parsed.textStart;
  if (parsed.textEnd !== undefined) ordered.textEnd = parsed.textEnd;
  if (parsed.suffix !== undefined) ordered.suffix = parsed.suffix;
  return JSON.stringify(ordered);
}
```

## The four directive shapes survive a round trip

`textStart` alone, a range, and either context word — the shapes Chrome's
generator actually emits.

```ts
const shapes = [
  { textStart: "the router restarts" },
  { textStart: "the router", textEnd: "restarts" },
  { prefix: "so", textStart: "the router restarts" },
  { textStart: "the router restarts", suffix: "on reload" },
];
JSON.stringify(shapes.map((shape) => JSON.parse(roundTrip(shape))))
=> [{"textStart":"the router restarts"},{"textStart":"the router","textEnd":"restarts"},{"prefix":"so","textStart":"the router restarts"},{"textStart":"the router restarts","suffix":"on reload"}]
```

A lone quoted string ending in `-` is the text itself, not a prefix with nothing
to prefix. Getting this wrong parsed the whole fragment to null, so a comment on
a hyphen-final selection silently stopped highlighting.

```ts
JSON.stringify([roundTrip({ textStart: "foo-" }), roundTrip({ prefix: "so", textStart: "bar" })])
=> ["{\"textStart\":\"foo-\"}","{\"prefix\":\"so\",\"textStart\":\"bar\"}"]
```

## Text that would break the encoding survives it

Commas and dashes are the fragment syntax's own separators, so a quote
containing them is exactly what a naive serializer mangles.

```ts
const awkward = { prefix: "a, b", textStart: "one, two - three", suffix: "-x-" };
roundTrip(awkward)
=> {"prefix":"a, b","textStart":"one, two - three","suffix":"-x-"}
```

Percent signs and spaces round-trip too, since the payload is URI-encoded.

```ts
roundTrip({ textStart: "100% of the time & then some" })
=> {"textStart":"100% of the time & then some"}
```

## A stored fragment parses with or without its prefix

Stored records carry the `:~:text=` marker; a bare payload is accepted too, so a
hand-written value in the YAML still resolves.

```ts
JSON.stringify([
  parseFragment(":~:text=hello"),
  parseFragment("hello"),
])
=> [{"textStart":"hello"},{"textStart":"hello"}]
```

## Nonsense is refused rather than half-parsed

A fragment that decodes to nothing usable returns null, so the caller falls back
to listing the comment with its quoted text.

An EMPTY `textStart` counts as nothing usable: it would ask the matcher to find
the empty string and take whatever it answered.

```ts
JSON.stringify([parseFragment(":~:text="), parseFragment("")])
=> [null,null]
```
