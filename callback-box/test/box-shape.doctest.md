# cb box shape: the bilingual legacy/package layout switch

`getBoxShape` reads a box's `.cb-box` marker and reports which physical
layout it uses. Every box created before the boxes-as-packages plan has no
`shapeVersion` field at all, and is shape 1: the box root is also the
package root. Shape 2+ nests the box root inside a package directory, and
that parent must declare a `callback-box` dependency — validated
fail-closed so box-owned code never silently resolves against the wrong
`node_modules`.

`makeTmpBox` builds a real shape-2 box (operational root at `box.root` =
`<packageRoot>/content`, with `box.packageRoot` the parent package). The v2
sections below use it directly; the v1 sections overwrite `box.root`'s
`.cb-box` marker by hand to construct the legacy case the still-bilingual
predicate must keep accepting.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxShape, boxCodePaths, BoxShapeError } from "../src/lib/box-shape.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

const tryGetBoxShape = async (boxRoot) => {
  try { await getBoxShape(boxRoot); return null; }
  catch (e) { return e; }
};

// Code paths relative to the shape's own package root, so temp dir names
// never appear in expected output and both shapes read cleanly.
const relCodePaths = (shape) => {
  const paths = boxCodePaths(shape);
  return {
    schemasDir: path.relative(shape.packageRoot, paths.schemasDir),
    viewsDir: path.relative(shape.packageRoot, paths.viewsDir),
    tricksDir: path.relative(shape.packageRoot, paths.tricksDir),
  };
};
```

## A legacy marker (no shapeVersion field) is shape 1, package root === box root

```ts
const box = await makeTmpBox();
await box.write(".cb-box", JSON.stringify({ version: "1.0.0", created: "2026-01-01T00:00:00.000Z" }));
const shape = await getBoxShape(box.root);
JSON.stringify({ shapeVersion: shape.shapeVersion, samePackageRoot: shape.packageRoot === shape.boxRoot })
=> {"shapeVersion":1,"samePackageRoot":true}
```

```ts cleanup
await box.cleanup();
```

## An empty marker is also shape 1

```ts
const box = await makeTmpBox();
await box.write(".cb-box", "");
const shape = await getBoxShape(box.root);
JSON.stringify({ shapeVersion: shape.shapeVersion, samePackageRoot: shape.packageRoot === shape.boxRoot })
=> {"shapeVersion":1,"samePackageRoot":true}
```

```ts cleanup
await box.cleanup();
```

## Shape 2 with a valid parent package.json resolves packageRoot to the parent

```ts
const box = await makeTmpBox();
const shape = await getBoxShape(box.root);
JSON.stringify({ shapeVersion: shape.shapeVersion, packageRoot: shape.packageRoot === box.packageRoot })
=> {"shapeVersion":2,"packageRoot":true}
```

```ts cleanup
await box.cleanup();
```

## Shape 2 with callback-box only in devDependencies still resolves

```ts
const box = await makeTmpBox();
await fs.writeFile(
  path.join(box.packageRoot, "package.json"),
  JSON.stringify({ name: "my-box", devDependencies: { "callback-box": "0.1.0" } })
);
const shape = await getBoxShape(box.root);
shape.packageRoot === box.packageRoot
=> true
```

```ts cleanup
await box.cleanup();
```

## Shape 2 with a missing parent package.json throws BoxShapeError

```ts
const box = await makeTmpBox();
await fs.rm(path.join(box.packageRoot, "package.json"));
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsBoxRoot: err.message.includes(box.root) })
=> {"isBoxShapeError":true,"mentionsBoxRoot":true}
```

```ts cleanup
await box.cleanup();
```

## Shape 2 with a parent package.json that doesn't declare callback-box throws BoxShapeError

```ts
const box = await makeTmpBox();
await fs.writeFile(
  path.join(box.packageRoot, "package.json"),
  JSON.stringify({ name: "my-box", dependencies: { lodash: "1.0.0" } })
);
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsCallbackBox: err.message.includes("callback-box") })
=> {"isBoxShapeError":true,"mentionsCallbackBox":true}
```

```ts cleanup
await box.cleanup();
```

## An unknown future shapeVersion is a clear error naming what's needed

```ts
const box = await makeTmpBox();
await box.write(".cb-box", JSON.stringify({ shapeVersion: 3 }));
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, needsNewer: err.message.includes("newer callback-box") })
=> {"isBoxShapeError":true,"needsNewer":true}
```

```ts cleanup
await box.cleanup();
```

## `boxCodePaths` for a legacy (shape 1) box: code lives inside the box root

```ts
const box = await makeTmpBox();
await box.write(".cb-box", JSON.stringify({ version: "1.0.0", created: "2026-01-01T00:00:00.000Z" }));
const shape = await getBoxShape(box.root);
JSON.stringify(relCodePaths(shape))
=> {"schemasDir":"config/schemas","viewsDir":"views","tricksDir":"tricks"}
```

```ts cleanup
await box.cleanup();
```

## `boxCodePaths` for a shape 2 box: code lives at the package root's `src/`

```ts
const box = await makeTmpBox();
const shape = await getBoxShape(box.root);
JSON.stringify(relCodePaths(shape))
=> {"schemasDir":"src/schemas","viewsDir":"src/views","tricksDir":"src/tricks"}
```

```ts cleanup
await box.cleanup();
```
