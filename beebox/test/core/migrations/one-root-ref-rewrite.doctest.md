# one-root migration: rewriting the path-bearing fields NOT named `ref`

`rewriteOneRootRefs` (`src/core/migrations/one-root-ref-rewrite.ts`) rewrites
frontmatter `ref`/`refs` keys via `walkFrontmatter`, which only walks keys
literally named that. Finding 9 (Track E hardening review, round 3): a
landmark's `navigation.symbol.src` and a figure's `entry` are also
path-bearing but aren't named `ref`, so they went unrewritten — the
migration's own hard link gate (which runs `lint-path-fields.ts`'s checks
against exactly these two fields) then failed on an otherwise-valid box. The
fix reuses `lint-path-fields.ts`'s `PATH_FIELDS` inventory directly, so the
rewriter covers exactly what the gate checks — one list, not two.

```ts setup
import { rewriteOneRootRefs, rewriteOneRootViewDependencies } from "../../../src/core/migrations/one-root-ref-rewrite.js";
import { OneRootPreflightError } from "../../../src/core/migrations/one-root-errors.js";
```

## A landmark's `navigation.symbol.src` rewrites like any other ref

```ts
const text = [
  "---",
  "navigation:",
  "  label: Test",
  "  symbol:",
  "    src: people/icon.png",
  "---",
  "",
].join("\n");
const result = rewriteOneRootRefs({ text, oldContentRelPath: "Box.landmark.card", isCard: true });
result.text.includes("src: /_content/people/icon.png")
=> true
```

No unresolved refs — the field resolved cleanly:

```ts continue
result.unresolved.length
=> 0
```

## A figure's `entry` rewrites too

```ts
const figureText = [
  "---",
  "entry: /store/drive/sketch.js",
  "---",
  "",
].join("\n");
const figureResult = rewriteOneRootRefs({ text: figureText, oldContentRelPath: "store/recipes/Foo.figure.card", isCard: true });
figureResult.text.includes("entry: /_content/drive/sketch.js")
=> true
```

An `entry` left in its conventional `attach/…` form (relative to the card's
own attach scope) is untouched, same as any other `attach/…` ref — it
travels with the card, no rewrite needed:

```ts
const attachText = ["---", "entry: attach/sketch.js", "---", ""].join("\n");
const attachResult = rewriteOneRootRefs({ text: attachText, oldContentRelPath: "store/recipes/Foo.figure.card", isCard: true });
attachResult.text.includes("entry: attach/sketch.js")
=> true
```

## Finding 7 (round 3 hardening): CRLF and blockquote reference definitions rewrite too

`rewriteOneRootRefs`'s body rewrite shares `body-refs.ts`'s
`matchReferenceDefinitionAt` with the extractor/hard-link-gate side — fixing
it there fixes both. A CRLF body's reference definition rewrites:

```ts
const crlfText = "---\nstatus: new\n---\n[dana]: ../../people/Dana_Lee.person.card\r\n\r\nSee [Dana][dana].\r\n";
const crlfResult = rewriteOneRootRefs({ text: crlfText, oldContentRelPath: "box/inbox/Foo.memo.card", isCard: true });
crlfResult.text.includes("[dana]: /_content/people/Dana_Lee.person.card")
=> true
```

A blockquoted reference definition rewrites too:

```ts
const quotedText = "---\nstatus: new\n---\n> [dana]: ../../people/Dana_Lee.person.card\n\nSee [Dana][dana].\n";
const quotedResult = rewriteOneRootRefs({ text: quotedText, oldContentRelPath: "box/inbox/Foo.memo.card", isCard: true });
quotedResult.text.includes("> [dana]: /_content/people/Dana_Lee.person.card")
=> true
```

## A card with neither field is untouched by the path-field pass

```ts
const plain = ["---", "status: new", "---", "Body.", ""].join("\n");
const plainResult = rewriteOneRootRefs({ text: plain, oldContentRelPath: "box/inbox/Foo.memo.card", isCard: true });
JSON.stringify({ text: plainResult.text, unresolved: plainResult.unresolved })
=> {"text":"---\nstatus: new\n---\nBody.\n","unresolved":[]}
```

## Round-7 hardening finding 4: a view's `dependencies` glob migrates through the v2→v3 table

`rewriteOneRootViewRefs` only rewrites `cardRef="…"` attributes — a view's
exported `dependencies` array survived the migration verbatim before this
fix, and since the directory it named just moved, it matched nothing
post-migration. The STATIC prefix (everything before the first glob
metacharacter) is mapped through the same table every other path goes
through; the glob suffix is spliced back on unchanged:

```ts
const viewSource = 'export const dependencies = ["store/recipes/**/*.card"];\n';
const result = rewriteOneRootViewDependencies(viewSource, "src/views/Recipes.tsx");
result.text
=> export const dependencies = ["_content/recipes/**/*.card"];

result.rewritten
=> 1
```

Multiple entries in the same array all rewrite:

```ts
const multiSource = 'export const dependencies = ["store/recipes/**/*.card", "box/inbox/**/*.memo.card"];\n';
const multiResult = rewriteOneRootViewDependencies(multiSource, "src/views/Multi.tsx");
multiResult.text
=> export const dependencies = ["_content/recipes/**/*.card", "_content/inbox/**/*.memo.card"];

multiResult.rewritten
=> 2
```

A view with no `dependencies` export is left untouched:

```ts
const noDeps = 'export default function View() { return null; }\n';
const noDepsResult = rewriteOneRootViewDependencies(noDeps, "src/views/Bare.tsx");
JSON.stringify({ text: noDepsResult.text === noDeps, rewritten: noDepsResult.rewritten })
=> {"text":true,"rewritten":0}
```

## An unmappable dependency prefix aborts, naming the view file

A prefix `mapV2Path` has never heard of (here: a made-up top-level directory)
can't be migrated confidently — this fails CLOSED, naming the view file and
the offending glob, rather than leave a dependency that might match the
wrong thing (or nothing) post-migration:

```ts
const badSource = 'export const dependencies = ["nonexistent-area/**/*.card"];\n';
const err = (() => {
  try {
    rewriteOneRootViewDependencies(badSource, "src/views/Broken.tsx");
    return null;
  } catch (e) {
    return e;
  }
})();
JSON.stringify({
  isPreflightError: err instanceof OneRootPreflightError,
  mentionsFile: err.message.includes("src/views/Broken.tsx"),
  mentionsGlob: err.message.includes("nonexistent-area/**/*.card"),
})
=> {"isPreflightError":true,"mentionsFile":true,"mentionsGlob":true}
```

## Round-8 hardening finding 5: a glob character class inside the array doesn't truncate parsing

The old extractor captured the array body as "everything up to the first
`]`" — a glob CHARACTER CLASS inside a quoted entry (`[AB]`) has its own `]`,
so the old regex stopped there and silently missed the rest of the pattern
(and any later array entries). The rewriter now walks the source respecting
string-literal boundaries, so the character class's own `]` doesn't end the
array early:

```ts
const classSource = 'export const dependencies = ["store/recipes/[AB]*.recipe.card"];\n';
const classResult = rewriteOneRootViewDependencies(classSource, "src/views/Classy.tsx");
classResult.text
=> export const dependencies = ["_content/recipes/[AB]*.recipe.card"];

classResult.rewritten
=> 1
```

A `dependencies` declaration whose closing `]` this migration can't find at
all (malformed on purpose here) aborts naming the file, rather than guess at
where the array ends:

```ts continue
const unclosedSource = 'export const dependencies = ["store/recipes/*.card";\n';
const unclosedErr = (() => {
  try {
    rewriteOneRootViewDependencies(unclosedSource, "src/views/Unclosed.tsx");
    return null;
  } catch (e) {
    return e;
  }
})();
JSON.stringify({
  isPreflightError: unclosedErr instanceof OneRootPreflightError,
  mentionsFile: unclosedErr.message.includes("src/views/Unclosed.tsx"),
})
=> {"isPreflightError":true,"mentionsFile":true}
```

## Round-8 hardening finding 6: a dependency glob spanning more than one v3 area aborts, naming both

`store/**` is not one v3 destination — `mapStoreArea`'s own switch sends
`store/archive`/`trash`/`usage` into `_bookkeeping` and everything else
(`recipes`, `todos`, `drive`, …) into `_content`. Rewriting `store/**` through
just ONE of those would silently lose every match that belonged in the
other. The migration now derives the split from the mapping table itself and
aborts, naming both destination areas:

```ts continue
const spanningSource = 'export const dependencies = ["store/**/*.card"];\n';
const spanningErr = (() => {
  try {
    rewriteOneRootViewDependencies(spanningSource, "src/views/Spanning.tsx");
    return null;
  } catch (e) {
    return e;
  }
})();
JSON.stringify({
  isPreflightError: spanningErr instanceof OneRootPreflightError,
  mentionsFile: spanningErr.message.includes("src/views/Spanning.tsx"),
  mentionsContent: spanningErr.message.includes("_content"),
  mentionsBookkeeping: spanningErr.message.includes("_bookkeeping"),
})
=> {"isPreflightError":true,"mentionsFile":true,"mentionsContent":true,"mentionsBookkeeping":true}
```

A glob whose static prefix does NOT cross a split still rewrites normally —
`store/recipes` is entirely `_content`, no ambiguity:

```ts continue
const nonSpanningSource = 'export const dependencies = ["store/recipes/**/*.card"];\n';
const nonSpanningResult = rewriteOneRootViewDependencies(nonSpanningSource, "src/views/NonSpanning.tsx");
JSON.stringify({ text: nonSpanningResult.text, rewritten: nonSpanningResult.rewritten })
=> {"text":"export const dependencies = [\"_content/recipes/**/*.card\"];\n","rewritten":1}
```
