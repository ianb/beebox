# View refs

Card refs inside box-authored views (`views/*.tsx`). The card-aware widgets
(`beebox/view-widgets`) point at cards with a `cardRef="…"` attribute
(`ref` is React-reserved). `extractViewRefs` finds them, `lintViewRefs` flags
broken ones (the `bbx validate` half), and `rewriteViewRefs` rewrites them when a
target moves (the `bbx mv` half). This is the JSX-view analogue of the Markdoc
body-ref machinery — a different surface, the same `{path, ref}` shape.

```ts setup
import { extractViewRefs, lintViewRefs } from "../../src/core/views/refs.js";
import { collectViewCanonicalWarnings } from "../../src/core/canonical-refs.js";
import { canonicalizeBox } from "../../src/core/canonicalize-refs.js";
import { rewriteViewRefs } from "../../src/core/rewrite-card-refs.js";
import { listBoxViewFiles } from "../../src/core/list-cards.js";
import { loadValidationIgnore } from "../../src/core/validation-ignore.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
```

## extractViewRefs finds literal `cardRef` attributes

The ref value and a `view:<line>:<index>` path are returned.

```ts
JSON.stringify(
  extractViewRefs('<CardLink cardRef="/_content/Foo.memo.card">Foo</CardLink>'),
  null,
  2,
)
=>
[
  {
    "path": "view:1:0",
    "ref": "/_content/Foo.memo.card"
  }
]
```

Single quotes work too.

```ts
extractViewRefs("<CardRef cardRef='/_content/Bar.card' />").length
=> 1
```

## Line and index across multiple refs

Lines are 1-indexed; the index increments per match.

```ts
const src = [
  'import { CardLink, CardRef } from "beebox/view-widgets";',
  "",
  '<CardLink cardRef="/_content/a.memo.card" />',
  '<CardRef cardRef="/_content/b.record.card" />',
].join("\n");
JSON.stringify(extractViewRefs(src), null, 2)
=>
[
  {
    "path": "view:3:0",
    "ref": "/_content/a.memo.card"
  },
  {
    "path": "view:4:1",
    "ref": "/_content/b.record.card"
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
await box.write("_content/Real.memo.card", "---\ntype: memo\n---\nhi");
await box.write(
  "views/v.tsx",
  '<CardLink cardRef="/_content/Real.memo.card" /><CardRef cardRef="/_content/Missing.memo.card" />',
);
const warnings = await lintViewRefs(`${box.root}/views/v.tsx`, box.root);
warnings.join("\n")
=> Broken reference at view:1:1: /_content/Missing.memo.card does not exist
```

## listBoxViewFiles resolves a box's views under `src/views/`

shapeVersion 3 has one root — `boxCodePaths`' `viewsDir` is always
`<boxRoot>/src/views/`, so `bbx validate`'s view-ref check and `bbx mv`'s
ref-rewrite pass (both call `listBoxViewFiles`) find views there directly,
with no package/content split to resolve:

```ts
const viewsBox = await makeTmpBox();
await mkdir(join(viewsBox.root, "src/views"), { recursive: true });
await writeFile(join(viewsBox.root, "src/views/dashboard.tsx"), "export default function Dashboard() { return null; }");
const found = await listBoxViewFiles(viewsBox.root);
found.map((p) => p.endsWith("src/views/dashboard.tsx"))
=> [
  true
]

await writeFile(join(viewsBox.root, "_content/people/alice.person.card"), "---\ntype: person\n---\nAlice\n");
const view = join(viewsBox.root, "src/views/dashboard.tsx");
await writeFile(
  view,
  '<CardLink cardRef="/_content/people/alice.person.card" /><CardRef cardRef="/_content/people/missing.person.card" />',
);
const viewWarnings = await lintViewRefs(view, viewsBox.root);
viewWarnings.join("\n")
=> Broken reference at view:1:1: /_content/people/missing.person.card does not exist

await writeFile(view, '<CardLink cardRef="_content/people/alice.person.card" />');
const canonicalWarnings = await collectViewCanonicalWarnings([view], viewsBox.root);
canonicalWarnings.join("\n")
=> src/views/dashboard.tsx: Non-canonical ref at view:1:0: _content/people/alice.person.card → /_content/people/alice.person.card

const fixed = await canonicalizeBox(viewsBox.root, {
  ignore: await loadValidationIgnore(viewsBox.root),
});
JSON.stringify({ refs: fixed.refsRewritten, files: fixed.filesChanged, view: await readFile(view, "utf-8") })
=> {"refs":1,"files":1,"view":"<CardLink cardRef=\"/_content/people/alice.person.card\" />"}

const moved = rewriteViewRefs({
  boxRoot: viewsBox.root,
  viewAbsPath: view,
  text: '<CardLink cardRef="/_content/people/alice.person.card" /><CardRef cardRef="_content/people/alice.person.card" />',
  remap: (abs) =>
    abs === join(viewsBox.root, "_content/people/alice.person.card")
      ? join(viewsBox.root, "_content/people/alicia.person.card")
      : null,
});
JSON.stringify(moved)
=> {"text":"<CardLink cardRef=\"/_content/people/alicia.person.card\" /><CardRef cardRef=\"_content/people/alicia.person.card\" />","count":2}
```

## rewriteViewRefs rewrites a moved target, leaves others alone

`remap` maps a resolved absolute path to its new home (or null). Only the
`cardRef` whose target moved is rewritten; the count reflects real changes.

```ts
const boxRoot = "/box";
const text = '<CardLink cardRef="/_content/Foo.memo.card" /><CardRef cardRef="/_content/Stay.card" />';
const remap = (abs: string) =>
  abs === "/box/_content/Foo.memo.card" ? "/box/_bookkeeping/archive/Foo.memo.card" : null;
const result = rewriteViewRefs({ boxRoot, viewAbsPath: "/box/views/v.tsx", text, remap });
JSON.stringify({ count: result.count, text: result.text }, null, 2)
=>
{
  "count": 1,
  "text": "<CardLink cardRef=\"/_bookkeeping/archive/Foo.memo.card\" /><CardRef cardRef=\"/_content/Stay.card\" />"
}
```
