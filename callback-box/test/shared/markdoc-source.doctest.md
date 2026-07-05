# Markdoc `{% source %}` — ref/href validation

The `source` tag carries provenance. It takes **at most one** of `ref` (an
in-box, `cb mv`-tracked target) or `href` (an external full URL), plus optional
anchoring metadata (`pos`, `version`, `placement`). A bare anchor with neither
targets the **containing document** — the ref-free default for commentary
attached to the page it annotates. The tag's `validate` rule rejects only
*both* at once.

Markdoc does not run `validate` during normal `parse`/`transform` rendering —
`card-lint` invokes `Markdoc.validate` on commentary card bodies so the rule
actually fires (see the commentary card schema). This doctest exercises the
rule directly.

```ts setup
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config.js";

const { parse, validate } = Markdoc;

// "valid" when the body has no validation errors, else the error ids joined.
function check(src: string): string {
  const errors = validate(parse(src), markdocConfig);
  if (errors.length === 0) return "valid";
  return errors.map((e) => e.error.id).join(", ");
}
```

## An external anchor (href + pos + version + placement) validates

```ts
check('{% source href="file:/Users/x/doc.md" pos="body; ~line 4" version="git:7ffeae4 sha256:9f3a1c2b" placement="estimated, ~50% through the message" %}\nthe selected span\n{% /source %}')
=>
valid
```

## An in-box anchor (ref only) still validates — backward compatible

```ts
check('{% source ref="/store/notes/Bread.doc.card" usage="summary" %}\nshe went back and forth on the kitchen\n{% /source %}')
=>
valid
```

## Neither ref nor href is valid — targets the containing document

```ts
check('{% source pos="body" %}\nthe span, anchored to this page\n{% /source %}')
=>
valid
```

## Both ref and href fails

```ts
check('{% source ref="/a.card" href="file:/Users/x/doc.md" %}\nambiguous\n{% /source %}')
=>
source-ref-xor-href
```
