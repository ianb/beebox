# View refs

Card refs inside box-authored views (`views/*.tsx`). The card-aware widgets
(`callback-box/view-widgets`) point at cards with a `cardRef="…"` attribute
(`ref` is React-reserved). `extractViewRefs` finds them, `lintViewRefs` flags
broken ones (the `cb validate` half), and `rewriteViewRefs` rewrites them when a
target moves (the `cb mv` half). This is the JSX-view analogue of the Markdoc
body-ref machinery — a different surface, the same `{path, ref}` shape.

```ts setup
import { extractViewRefs, lintViewRefs } from "../../src/core/view-refs.js";
import { rewriteViewRefs } from "../../src/core/rewrite-card-refs.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## extractViewRefs finds literal `cardRef` attributes

The ref value and a `view:<line>:<index>` path are returned.

```ts
JSON.stringify(
  extractViewRefs('<CardLink cardRef="/store/Foo.memo.card">Foo</CardLink>'),
  null,
  2,
)
=>
[
  {
    "path": "view:1:0",
    "ref": "/store/Foo.memo.card"
  }
]
```

Single quotes work too.

```ts
extractViewRefs("<CardRef cardRef='/store/Bar.card' />").length
=> 1
```

## Line and index across multiple refs

Lines are 1-indexed; the index increments per match.

```ts
const src = [
  'import { CardLink, CardRef } from "callback-box/view-widgets";',
  "",
  '<CardLink cardRef="/store/a.memo.card" />',
  '<CardRef cardRef="/store/b.record.card" />',
].join("\n");
JSON.stringify(extractViewRefs(src), null, 2)
=>
[
  {
    "path": "view:3:0",
    "ref": "/store/a.memo.card"
  },
  {
    "path": "view:4:1",
    "ref": "/store/b.record.card"
  }
]
```

## Expression refs and DOM refs are not matched

Only literal quoted `cardRef` attributes are tracked. An expression form
(`cardRef={expr}`) is unresolvable statically, and a bare DOM `ref=` is not a
card ref.

```ts
extractViewRefs("<CardLink cardRef={someVar} />").length
=> 0

extractViewRefs('<input ref="x" />').length
=> 0

extractViewRefs("plain source, no widgets").length
=> 0
```

## lintViewRefs flags broken refs, passes existing ones

```ts
const box = await makeTmpBox();
await box.write("store/Real.memo.card", "---\ntype: memo\n---\nhi");
await box.write(
  "views/v.tsx",
  '<CardLink cardRef="/store/Real.memo.card" /><CardRef cardRef="/store/Missing.memo.card" />',
);
const warnings = await lintViewRefs(`${box.root}/views/v.tsx`, box.root);
warnings.join("\n")
=> Broken reference at view:1:1: /store/Missing.memo.card does not exist
```

## rewriteViewRefs rewrites a moved target, leaves others alone

`remap` maps a resolved absolute path to its new home (or null). Only the
`cardRef` whose target moved is rewritten; the count reflects real changes.

```ts
const boxRoot = "/box";
const text = '<CardLink cardRef="/store/Foo.memo.card" /><CardRef cardRef="/store/Stay.card" />';
const remap = (abs: string) =>
  abs === "/box/store/Foo.memo.card" ? "/box/store/archive/Foo.memo.card" : null;
const result = rewriteViewRefs({ boxRoot, viewAbsPath: "/box/views/v.tsx", text, remap });
JSON.stringify({ count: result.count, text: result.text }, null, 2)
=>
{
  "count": 1,
  "text": "<CardLink cardRef=\"/store/archive/Foo.memo.card\" /><CardRef cardRef=\"/store/Stay.card\" />"
}
```
