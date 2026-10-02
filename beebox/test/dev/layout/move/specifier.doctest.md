# `computeNewSpecifier`: recomputing an import after a move

```ts setup
import { computeNewSpecifier } from "../../../../src/dev/layout/move/specifier.js";

const noAliases = { baseDir: "", entries: [] };
const sharedAliases = {
  baseDir: "pkg",
  entries: [{ prefix: "@shared/", suffix: "", hasWildcard: true, targets: ["./src/shared/*"] }],
};
```

## Extension style is preserved: `.js` stays `.js`, extensionless stays extensionless

```ts
computeNewSpecifier({
  oldSpecifier: "./b.js",
  newImporterDir: "pkg/src/other",
  newTargetPath: "pkg/src/other/b.ts",
  aliases: noAliases,
})
=> ./b.js

computeNewSpecifier({
  oldSpecifier: "./b",
  newImporterDir: "pkg/src/other",
  newTargetPath: "pkg/src/other/b.ts",
  aliases: noAliases,
})
=> ./b
```

## An importer moving to another directory recomputes the relative path, adding `./`

```ts
computeNewSpecifier({
  oldSpecifier: "./b.js",
  newImporterDir: "pkg/src/new-home",
  newTargetPath: "pkg/src/other/b.ts",
  aliases: noAliases,
})
=> ../other/b.js
```

## A moved `.test.ts` file keeps its `.test` component, not just its real extension

```ts
computeNewSpecifier({
  oldSpecifier: "./foo.test.js",
  newImporterDir: "pkg/test",
  newTargetPath: "pkg/test/sub/foo.test.ts",
  aliases: noAliases,
})
=> ./sub/foo.test.js
```

## A moved target recomputes the specifier from the (unchanged) importer

```ts
computeNewSpecifier({
  oldSpecifier: "./old/b.js",
  newImporterDir: "pkg/src",
  newTargetPath: "pkg/src/new/b.ts",
  aliases: noAliases,
})
=> ./new/b.js
```

## An alias specifier recomputes within the alias root when the target stays under it

```ts
computeNewSpecifier({
  oldSpecifier: "@shared/ref-path",
  newImporterDir: "pkg/src/webapp",
  newTargetPath: "pkg/src/shared/paths/ref-path.ts",
  aliases: sharedAliases,
})
=> @shared/paths/ref-path
```

## An alias specifier falls back to relative when the target leaves the alias root

```ts
computeNewSpecifier({
  oldSpecifier: "@shared/ref-path",
  newImporterDir: "pkg/src/webapp",
  newTargetPath: "pkg/src/lib/ref-path.ts",
  aliases: sharedAliases,
})
=> ../lib/ref-path
```
