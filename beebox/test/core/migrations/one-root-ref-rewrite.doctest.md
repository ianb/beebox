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
import { rewriteOneRootRefs } from "../../../src/core/migrations/one-root-ref-rewrite.js";
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
