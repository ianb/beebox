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
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * A v2 (package-layout) box fixture: `<root>/package.json` declares a
 * `beebox` dependency (all `getBoxShape` needs here — this module
 * never imports through `node_modules`), and `<root>/content/.beebox/box.json` marks
 * the operational root, one level below the package root, where views live
 * at `src/views/` instead of `views/`.
 */
async function makeV2ViewsBox() {
  const root = await mkdtemp(join(tmpdir(), "bbx-doctest-v2-views-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "my-box", private: true, dependencies: { "beebox": "0.1.0" } }),
  );
  const boxRoot = join(root, "content");
  await mkdir(boxRoot, { recursive: true });
  await mkdir(join(boxRoot, ".beebox"), { recursive: true });
  await writeFile(join(boxRoot, ".beebox/box.json"), JSON.stringify({ shapeVersion: 2 }));
  await mkdir(join(root, "src/views"), { recursive: true });
  await writeFile(join(root, "src/views/dashboard.tsx"), "export default function Dashboard() { return null; }");
  return {
    root,
    boxRoot,
    async cleanup() {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}
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
  'import { CardLink, CardRef } from "beebox/view-widgets";',
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

## listBoxViewFiles resolves views per box shape

A v2 (package-layout) box's views live at `packageRoot/src/views/` —
`bbx validate`'s view-ref check and `bbx mv`'s ref-rewrite pass (both call
`listBoxViewFiles`) need to find them there, not at the (nonexistent)
`boxRoot/views/`:

```ts
const v2box = await makeV2ViewsBox();
const found = await listBoxViewFiles(v2box.boxRoot);
found.map((p) => p.endsWith("src/views/dashboard.tsx"))
=> [
  true
]

await mkdir(join(v2box.boxRoot, "people"), { recursive: true });
await writeFile(join(v2box.boxRoot, "people/alice.person.card"), "---\ntype: person\n---\nAlice\n");
const v2view = join(v2box.root, "src/views/dashboard.tsx");
await writeFile(
  v2view,
  '<CardLink cardRef="/people/alice.person.card" /><CardRef cardRef="/people/missing.person.card" />',
);
const v2Warnings = await lintViewRefs(v2view, v2box.boxRoot);
v2Warnings.join("\n")
=> Broken reference at view:1:1: /people/missing.person.card does not exist

await writeFile(v2view, '<CardLink cardRef="people/alice.person.card" />');
const canonicalWarnings = await collectViewCanonicalWarnings([v2view], v2box.boxRoot);
canonicalWarnings.join("\n")
=> ../src/views/dashboard.tsx: Non-canonical ref at view:1:0: people/alice.person.card → /people/alice.person.card

const fixed = await canonicalizeBox(v2box.boxRoot, {
  ignore: await loadValidationIgnore(v2box.boxRoot),
});
JSON.stringify({ refs: fixed.refsRewritten, files: fixed.filesChanged, view: await readFile(v2view, "utf-8") })
=> {"refs":1,"files":1,"view":"<CardLink cardRef=\"/people/alice.person.card\" />"}

const moved = rewriteViewRefs({
  boxRoot: v2box.boxRoot,
  viewAbsPath: v2view,
  text: '<CardLink cardRef="/people/alice.person.card" /><CardRef cardRef="people/alice.person.card" />',
  remap: (abs) =>
    abs === join(v2box.boxRoot, "people/alice.person.card")
      ? join(v2box.boxRoot, "people/alicia.person.card")
      : null,
});
JSON.stringify(moved)
=> {"text":"<CardLink cardRef=\"/people/alicia.person.card\" /><CardRef cardRef=\"people/alicia.person.card\" />","count":2}
```

```ts cleanup
await v2box.cleanup();
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
