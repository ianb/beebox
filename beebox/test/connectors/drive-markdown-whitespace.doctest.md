# Drive push guard — stripped trailing whitespace

`stripsUpstreamTrailingWhitespace` decides whether a local markdown body removed
trailing whitespace from a line it otherwise kept. Google's Docs export uses
that whitespace as a line break inside nested list items, so a push that removes
it collapses checklists into paragraphs upstream.

```ts setup
import { stripsUpstreamTrailingWhitespace } from "../../src/connectors/drive-markdown-whitespace.js";

const remote = "- [ ] Parent  \n      - [ ] Child  \n";
```

An unchanged file, and an edit that leaves the whitespace alone, both pass:

```ts
stripsUpstreamTrailingWhitespace(remote, remote)
=> false

stripsUpstreamTrailingWhitespace("- [ ] Parent  \n      - [x] Child  \n", remote)
=> false
```

A whitespace sweep is caught — whether it is the only change, or bundled with a
real content edit:

```ts
stripsUpstreamTrailingWhitespace("- [ ] Parent\n      - [ ] Child\n", remote)
=> true

stripsUpstreamTrailingWhitespace("- [ ] Parent\n      - [x] Child\n", remote)
=> true
```

Rewriting or deleting the line outright is a real edit, not a strip: the line
did not survive, so there is no preserved line to have lost its break.

```ts
stripsUpstreamTrailingWhitespace("- [ ] Parent  \n", remote)
=> false

stripsUpstreamTrailingWhitespace("- [ ] Parent  \n      - [ ] Rewritten child\n", remote)
=> false
```

Adding content around the mirrored lines is fine, and whitespace on an
otherwise-blank line counts the same as any other — MD009 flags those too, so
they are exactly what a sweep removes:

```ts
stripsUpstreamTrailingWhitespace(`${remote}\nA new paragraph.\n`, remote)
=> false

stripsUpstreamTrailingWhitespace("Para\n\nNext\n", "Para\n   \nNext\n")
=> true
```
