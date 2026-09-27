# `rewriteDoctestFile`: fence-matched specifier rewrites

Building the sample markdown from joined lines (rather than a literal fence)
keeps its own ` ``` ` markers from being mistaken for this file's fences.

```ts setup
import { rewriteDoctestFile } from "../../../../src/dev/layout/move/doctest-edit.js";

const fence = "`".repeat(3);
const sample = [
  "# Title",
  "",
  "Mentions ./old.js in prose, untouched.",
  "",
  `${fence}ts setup`,
  'import { a } from "./old.js";',
  fence,
  "",
  `${fence}ts`,
  "a",
  fence,
  "",
].join("\n");
const rewritten = rewriteDoctestFile({ text: sample, rewrites: new Map([["./old.js", "./new.js"]]) });
```

## The import inside a fence is rewritten

```ts
rewritten.includes('import { a } from "./new.js";')
=> true

rewritten.includes('import { a } from "./old.js";')
=> false
```

## Prose outside a fence keeps the old mention untouched

```ts
rewritten.includes("Mentions ./old.js in prose, untouched.")
=> true
```

## Nothing to rewrite returns the text unchanged

```ts
rewriteDoctestFile({ text: sample, rewrites: new Map([["./nope.js", "./new.js"]]) }) === sample
=> true
```

## A static side-effect import (`import "./old.js";`, no bindings) is rewritten

```ts
const sideEffectSample = [
  `${fence}ts setup`,
  'import "./old.js";',
  fence,
  "",
].join("\n");
rewriteDoctestFile({ text: sideEffectSample, rewrites: new Map([["./old.js", "./new.js"]]) }).includes('import "./new.js";')
=> true
```

## A fixture string that merely contains specifier-shaped text is left alone (not treated as a real import)

```ts
const fixtureSample = [
  `${fence}ts setup`,
  "const line = 'import { a } from \"./old.js\";';",
  fence,
  "",
].join("\n");
rewriteDoctestFile({ text: fixtureSample, rewrites: new Map([["./old.js", "./new.js"]]) }) === fixtureSample
=> true
```
