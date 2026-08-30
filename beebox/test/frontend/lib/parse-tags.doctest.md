# Tag Parser

`parseTags()` is a permissive XML-like tag parser for assistant responses. It handles nested tags, attributes, self-closing tags, and treats unmatched text as comment nodes.

```ts setup
import { parseTags } from "../../../src/frontend/src/lib/parseTags.js";

// Some assertions feed malformed/mismatched closing tags to exercise the
// permissive recovery path. Silence the warning so it doesn't pollute output.
console.warn = () => {};
```

## Simple tags

A single tag with content:

```ts
const tags = parseTags('<greeting>Hello world</greeting>');
tags.length
=> 1
```

```ts continue
tags[0].type
=> greeting

tags[0].content
=> Hello world
```

## Attributes

Attributes are extracted as key-value pairs:

```ts
const tags = parseTags('<task status="open" priority="high">Do thing</task>');
tags[0].attrs.status
=> open

tags[0].attrs.priority
=> high
```

## Self-closing tags

```ts
const tags = parseTags('<item ref="test.card" />');
tags[0].type
=> item

tags[0].attrs.ref
=> test.card

tags[0].content
=>
```

## Nested tags

Inner tags appear as subTags:

```ts
const tags = parseTags('<outer><inner>nested</inner></outer>');
tags[0].type
=> outer
```

```ts continue
tags[0].subTags[0].type
=> inner

tags[0].subTags[0].content
=> nested
```

## Filtering with allowTags

Only specified tags are parsed — others are ignored:

```ts
const tags = parseTags('<speech>Hello <b>world</b></speech>', ["speech"]);
tags.length
=> 1

tags[0].type
=> speech
```

## Text between tags becomes comments

```ts
const tags = parseTags('Some text <tag>inside</tag> more text');
tags.filter(t => t.type === "comment").length > 0
=> true
```

## Strips surrounding backticks

Backticks wrapping the input are removed (common in LLM output):

```ts
const tags = parseTags('`<tag>content</tag>`');
tags[0].type
=> tag

tags[0].content
=> content
```

## Empty input

```ts
parseTags("").length
=> 0

parseTags("   ").length
=> 0
```

## Paired non-allowed tags don't warn (their closers are skipped like their openers)

With an `allowTags` filter active, an opener outside the allowlist is
skipped without being pushed on the stack — so its CLOSER must be skipped
the same way, not reported as "Unexpected closing tag". The documented
paired ack form (`<ack kind="…">note</ack>`) hits exactly this.

```ts
let warned = 0;
const origWarn = console.warn;
console.warn = () => { warned += 1; };
const tags = parseTags('<speech>hi</speech> <ack kind="appended" ref="x.card">a note</ack>', ["speech"]);
console.warn = origWarn;

warned
=> 0

tags.filter(t => t.type === "speech").length
=> 1
```

An unmatched closer of an ALLOWED tag still warns — that's real
malformation worth surfacing:

```ts
let warned2 = 0;
const origWarn2 = console.warn;
console.warn = () => { warned2 += 1; };
parseTags('text </speech> more', ["speech"]);
console.warn = origWarn2;

warned2
=> 1
```
