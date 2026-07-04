# `cb serve --dev` builds the same slugs as the non-dev path (found by cross-model review)

`cb serve`'s non-dev branch resolves box directories through `resolveBoxes`,
which applies `--slug` and (for a v2 box) the package-root-basename default —
a v2 box's `content/` dir basename is always the literal string "content",
so the box's *meaningful* slug lives one level up. The `--dev` branch used to
skip all of that and pass raw resolved dirs straight through to
`server-main.ts`'s argv, silently dropping `--slug` overrides and mis-slugging
every v2 box "content". `toBoxArgs` (the `<slug>=<boxRoot>` encoding
`server-main.ts` expects) now runs on the SAME `resolveBoxes` output the
non-dev branch uses, so the two branches can't drift.

```ts setup
import * as path from "node:path";
import { resolveBoxes, toBoxArgs } from "../../../src/cli/commands/serve.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## A legacy (shape 1) box: slug defaults to the box dir's own basename

```ts
const box = await makeTmpBox();
const boxes = await resolveBoxes([box.root], undefined);
toBoxArgs(boxes)[0] === `${path.basename(box.root)}=${box.root}`
=> true
```

```ts cleanup
await box.cleanup();
```

## `--slug` overrides the default, and the dev-arg encoding carries it through

```ts
const box = await makeTmpBox();
const boxes = await resolveBoxes([box.root], "my-custom-slug");
toBoxArgs(boxes)[0] === `my-custom-slug=${box.root}`
=> true
```

```ts cleanup
await box.cleanup();
```

## A v2 box: the dev-arg slug is the PACKAGE root's basename, never "content"

Passing the raw `content/` dir (the old `--dev` behavior) would have encoded
the literal slug "content" here — wrong, and colliding across every v2 box.

```ts
const box = await makeTmpBox();
await box.write("content/.cb-box", JSON.stringify({ shapeVersion: 2 }));
await box.write("package.json", JSON.stringify({ name: "my-box", dependencies: { "callback-box": "0.1.0" } }));
const contentDir = box.path("content");
const boxes = await resolveBoxes([contentDir], undefined);
const args = toBoxArgs(boxes);

args[0].includes("=content")
=> false

args[0] === `${path.basename(box.root)}=${contentDir}`
=> true
```

```ts cleanup
await box.cleanup();
```
