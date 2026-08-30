# bbx box shape: the v2 package-layout predicate

`getBoxShape` reads a box's `.beebox/box.json` marker and resolves where its package
root lives. Every box is shapeVersion 2 (the package layout): the box root is
a `content/` directory nested inside a package, and the package root is its
parent — which must declare a `beebox` dependency, validated
fail-closed so box-owned code never silently resolves against the wrong
`node_modules`. A marker whose `shapeVersion` is absent or `< 2` predates the
package layout and is a hard `BoxShapeError`.

`makeTmpBox` builds a real shape-2 box (operational root at `box.root` =
`<packageRoot>/content`, with `box.packageRoot` the parent package). The
sections below use it directly; the error cases overwrite `box.root`'s
`.beebox/box.json` marker by hand to construct the rejected inputs.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { getBoxShape, getBoxShapeIfPresent, resolveOperationalRoot, boxCodePaths, BoxShapeError } from "../src/lib/box-shape.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

const tryGetBoxShape = async (boxRoot) => {
  try { await getBoxShape(boxRoot); return null; }
  catch (e) { return e; }
};

// Code paths relative to the shape's own package root, so temp dir names
// never appear in expected output.
const relCodePaths = (shape) => {
  const paths = boxCodePaths(shape);
  return {
    schemasDir: path.relative(shape.packageRoot, paths.schemasDir),
    viewsDir: path.relative(shape.packageRoot, paths.viewsDir),
    tricksDir: path.relative(shape.packageRoot, paths.tricksDir),
  };
};
```

## A marker with no shapeVersion field predates v2 and is rejected

```ts
const box = await makeTmpBox();
await box.write(".beebox/box.json", JSON.stringify({ version: "1.0.0", created: "2026-01-01T00:00:00.000Z" }));
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsLayout: err.message.includes("box-layout.md") })
=> {"isBoxShapeError":true,"mentionsLayout":true}
```

```ts cleanup
await box.cleanup();
```

## An empty marker predates v2 and is rejected

```ts
const box = await makeTmpBox();
await box.write(".beebox/box.json", "");
const err = await tryGetBoxShape(box.root);
err instanceof BoxShapeError
=> true
```

```ts cleanup
await box.cleanup();
```

## A shapeVersion below 2 predates v2 and is rejected

```ts
const box = await makeTmpBox();
await box.write(".beebox/box.json", JSON.stringify({ shapeVersion: 1 }));
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsVersion: err.message.includes("shapeVersion 1") })
=> {"isBoxShapeError":true,"mentionsVersion":true}
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

## Shape 2 with beebox only in devDependencies still resolves

```ts
const box = await makeTmpBox();
await fs.writeFile(
  path.join(box.packageRoot, "package.json"),
  JSON.stringify({ name: "my-box", devDependencies: { "beebox": "0.1.0" } })
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

## Shape 2 with a parent package.json that doesn't declare beebox throws BoxShapeError

```ts
const box = await makeTmpBox();
await fs.writeFile(
  path.join(box.packageRoot, "package.json"),
  JSON.stringify({ name: "my-box", dependencies: { lodash: "1.0.0" } })
);
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsBeeBox: err.message.includes("beebox") })
=> {"isBoxShapeError":true,"mentionsBeeBox":true}
```

```ts cleanup
await box.cleanup();
```

## An unknown future shapeVersion is a clear error naming what's needed

```ts
const box = await makeTmpBox();
await box.write(".beebox/box.json", JSON.stringify({ shapeVersion: 3 }));
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, needsNewer: err.message.includes("newer beebox") })
=> {"isBoxShapeError":true,"needsNewer":true}
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

## `getBoxShapeIfPresent` tolerates a marker-less path but not a broken one

Found on a real box:

```ts
const box = await makeTmpBox();
const lookup = await getBoxShapeIfPresent(box.root);
JSON.stringify({ found: lookup.found, shapeVersion: lookup.found ? lookup.shape.shapeVersion : null })
=> {"found":true,"shapeVersion":2}
```

```ts continue
await box.cleanup();
```

A directory with no `.beebox/box.json` is "not a box" (`found: false`), never a fabricated shape:

```ts
const plain = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-nobox-"));
const lookup = await getBoxShapeIfPresent(plain);
lookup.found
=> false
```

```ts continue
await fs.rm(plain, { recursive: true, force: true });
```

A malformed marker is a real error and still throws — it is NOT mistaken for "no box":

```ts
const bad = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-badbox-"));
await fs.mkdir(path.join(bad, ".beebox"), { recursive: true });
await fs.writeFile(path.join(bad, ".beebox/box.json"), "{not json");
const outcome = await getBoxShapeIfPresent(bad).then(() => "did-not-throw", () => "threw");
outcome
=> threw
```

```ts continue
await fs.rm(bad, { recursive: true, force: true });
```

## `resolveOperationalRoot` maps a package root to its content root

Given the package root, it resolves to the operational (`content/`) root where box data lives:

```ts
const box = await makeTmpBox();
(await resolveOperationalRoot(box.packageRoot)) === box.root
=> true
```

```ts continue
// The operational root resolves to itself, and a non-box path is returned unchanged.
const self = (await resolveOperationalRoot(box.root)) === box.root;
const plain = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-plain-"));
const passthrough = (await resolveOperationalRoot(plain)) === path.resolve(plain);
JSON.stringify({ self, passthrough })
=> {"self":true,"passthrough":true}
```

```ts continue
await fs.rm(plain, { recursive: true, force: true });
await box.cleanup();
```
