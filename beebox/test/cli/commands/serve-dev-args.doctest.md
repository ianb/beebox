# `bbx serve --dev` builds the same slugs as the non-dev path (found by cross-model review)

`bbx serve`'s non-dev branch resolves box directories through `resolveBoxes`,
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
import {
  devServerEnvironment,
  devSurfacesEnabled,
  resolveBoxes,
  toBoxArgs,
} from "../../../src/cli/commands/serve.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
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

## Development surfaces require the exact positive opt-in

The normal serve path is safe when the variable is absent, empty, or any value
other than the validated literal. The watched `--dev` child always overwrites
an inherited value with that literal.

```ts
JSON.stringify({
  absent: devSurfacesEnabled({}),
  empty: devSurfacesEnabled({ BBX_DEV_SURFACES: "" }),
  production: devSurfacesEnabled({ BBX_DEV_SURFACES: "0" }),
  optedIn: devSurfacesEnabled({ BBX_DEV_SURFACES: "1" }),
})
=> {"absent":false,"empty":false,"production":false,"optedIn":true}

const childEnv = devServerEnvironment(
  { BBX_DEV_SURFACES: "0", UNRELATED: "kept" },
  { port: 4321, host: "127.0.0.1" },
);
JSON.stringify({
  devSurfaces: childEnv.BBX_DEV_SURFACES,
  port: childEnv.PORT,
  host: childEnv.HOST,
  unrelated: childEnv.UNRELATED,
})
=> {"devSurfaces":"1","port":"4321","host":"127.0.0.1","unrelated":"kept"}
```

## A v2 box: the dev-arg slug is the PACKAGE root's basename, never "content"

Passing the raw `content/` dir (the old `--dev` behavior) would have encoded
the literal slug "content" here — wrong, and colliding across every v2 box.

```ts
// A native v2 box: `box.root` is the operational `content/` dir; the
// meaningful slug lives one level up at the package root.
const box = await makeTmpBox();
const boxes = await resolveBoxes([box.root], undefined);
const args = toBoxArgs(boxes);

args[0].includes("=content")
=> false

args[0] === `${path.basename(box.packageRoot)}=${box.root}`
=> true
```

```ts cleanup
await box.cleanup();
```
