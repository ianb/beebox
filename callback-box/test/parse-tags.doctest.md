# Tag Parser

`parseTags()` is a permissive XML-like tag parser for assistant responses. It handles nested tags, attributes, self-closing tags, and treats unmatched text as comment nodes.

```ts setup
import { parseTags } from "../src/frontend/src/lib/parseTags.js";

// Some assertions feed malformed/mismatched closing tags to exercise the
// permissive recovery path. Silence the warning so it doesn't pollute output.
console.warn = () => {};
```

## Simple tags

A single tag with content:

```
const tags = parseTags('<greeting>Hello world</greeting>');
tags.length
=> 1
```

``` continue
tags[0].type
=> greeting

tags[0].content
=> Hello world
```

## Attributes

Attributes are extracted as key-value pairs:

```
const tags = parseTags('<task status="open" priority="high">Do thing</task>');
tags[0].attrs.status
=> open

tags[0].attrs.priority
=> high
```

## Self-closing tags

```
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

```
const tags = parseTags('<outer><inner>nested</inner></outer>');
tags[0].type
=> outer
```

``` continue
tags[0].subTags[0].type
=> inner

tags[0].subTags[0].content
=> nested
```

## Filtering with allowTags

Only specified tags are parsed — others are ignored:

```
const tags = parseTags('<speech>Hello <b>world</b></speech>', ["speech"]);
tags.length
=> 1

tags[0].type
=> speech
```

## Text between tags becomes comments

```
const tags = parseTags('Some text <tag>inside</tag> more text');
tags.filter(t => t.type === "comment").length > 0
=> true
```

## Strips surrounding backticks

Backticks wrapping the input are removed (common in LLM output):

```
const tags = parseTags('`<tag>content</tag>`');
tags[0].type
=> tag

tags[0].content
=> content
```

## Empty input

```
parseTags("").length
=> 0

parseTags("   ").length
=> 0
```
