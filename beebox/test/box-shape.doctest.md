# bbx box shape: the v3 one-root predicate

`getBoxShape` reads a box's `.beebox/box.json` marker and resolves its shape.
shapeVersion 3 (the one-root layout — `docs/implemented-plans/one-root-box-layout.md`)
has ONE root: `package.json`, `src/`, and every underscore-prefixed
operational area (`_content/`, `_config/`, …) all live at the same directory
— validated fail-closed against the box's own `package.json` declaring a
`beebox` dependency. A marker whose `shapeVersion` is absent or `< 3`
predates the one-root layout and is a hard `BoxShapeError` naming
`bbx migrate`.

`makeTmpBox` builds a real shape-3 box (`box.root`). The sections below use it
directly; the error cases overwrite `box.root`'s `.beebox/box.json` marker
by hand, or fabricate a v2-shaped fixture, to construct the rejected inputs.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { getBoxShape, getBoxShapeIfPresent, resolveBoxRoot, requireBoxRoot, boxCodePaths, BoxShapeError } from "../src/lib/box-shape.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

const tryGetBoxShape = async (boxRoot) => {
  try { await getBoxShape(boxRoot); return null; }
  catch (e) { return e; }
};

// Code paths relative to the shape's own box root, so temp dir names never
// appear in expected output.
const relCodePaths = (shape) => {
  const paths = boxCodePaths(shape);
  return {
    schemasDir: path.relative(shape.boxRoot, paths.schemasDir),
    viewsDir: path.relative(shape.boxRoot, paths.viewsDir),
    tricksDir: path.relative(shape.boxRoot, paths.tricksDir),
  };
};

// A v2 fixture: package root with the marker one level down at `content/`.
const makeV2PackageRoot = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-v2-fixture-"));
  await fs.mkdir(path.join(dir, "content", ".beebox"), { recursive: true });
  await fs.writeFile(path.join(dir, "content", ".beebox", "box.json"), JSON.stringify({ shapeVersion: 2 }));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies: { beebox: "^1.0.0" } }));
  return dir;
};
```

## A marker with no shapeVersion field predates v3 and is rejected

```ts
const box = await makeTmpBox();
await box.write(".beebox/box.json", JSON.stringify({ version: "1.0.0", created: "2026-01-01T00:00:00.000Z" }));
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsMigrate: err.message.includes("bbx migrate") })
=> {"isBoxShapeError":true,"mentionsMigrate":true}
```

```ts cleanup
await box.cleanup();
```

## An empty marker predates v3 and is rejected

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

## A shapeVersion below 3 predates v3 and is rejected

```ts
const box = await makeTmpBox();
await box.write(".beebox/box.json", JSON.stringify({ shapeVersion: 2 }));
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsVersion: err.message.includes("shapeVersion 2") })
=> {"isBoxShapeError":true,"mentionsVersion":true}
```

```ts cleanup
await box.cleanup();
```

## A v2 package root (marker at `content/`) is rejected with a migration-pointing error

```ts
const dir = await makeV2PackageRoot();
const err = await tryGetBoxShape(dir);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsMigrate: err.message.includes("bbx migrate"), mentionsPackageRoot: err.message.includes("package root") })
=> {"isBoxShapeError":true,"mentionsMigrate":true,"mentionsPackageRoot":true}
```

```ts cleanup
await fs.rm(dir, { recursive: true, force: true });
```

## A v2 content/ root itself is also rejected with the migration-pointing error

```ts
const dir = await makeV2PackageRoot();
const contentRoot = path.join(dir, "content");
const err = await tryGetBoxShape(contentRoot);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsMigrate: err.message.includes("bbx migrate"), mentionsContentDir: err.message.includes("content/ root") })
=> {"isBoxShapeError":true,"mentionsMigrate":true,"mentionsContentDir":true}
```

```ts cleanup
await fs.rm(dir, { recursive: true, force: true });
```

## Shape 3 with a valid package.json resolves boxRoot

```ts
const box = await makeTmpBox();
const shape = await getBoxShape(box.root);
JSON.stringify({ shapeVersion: shape.shapeVersion, boxRoot: shape.boxRoot === box.root })
=> {"shapeVersion":3,"boxRoot":true}
```

```ts cleanup
await box.cleanup();
```

## Shape 3 with beebox only in devDependencies still resolves

```ts
const box = await makeTmpBox();
await fs.writeFile(
  path.join(box.root, "package.json"),
  JSON.stringify({ name: "my-box", devDependencies: { "beebox": "0.1.0" } })
);
const shape = await getBoxShape(box.root);
shape.boxRoot === box.root
=> true
```

```ts cleanup
await box.cleanup();
```

## Shape 3 with a missing package.json throws BoxShapeError

```ts
const box = await makeTmpBox();
await fs.rm(path.join(box.root, "package.json"));
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, mentionsBoxRoot: err.message.includes(box.root) })
=> {"isBoxShapeError":true,"mentionsBoxRoot":true}
```

```ts cleanup
await box.cleanup();
```

## Shape 3 with a package.json that doesn't declare beebox throws BoxShapeError

```ts
const box = await makeTmpBox();
await fs.writeFile(
  path.join(box.root, "package.json"),
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
await box.write(".beebox/box.json", JSON.stringify({ shapeVersion: 4 }));
const err = await tryGetBoxShape(box.root);
JSON.stringify({ isBoxShapeError: err instanceof BoxShapeError, needsNewer: err.message.includes("newer beebox") })
=> {"isBoxShapeError":true,"needsNewer":true}
```

```ts cleanup
await box.cleanup();
```

## `boxCodePaths` for a shape 3 box: code lives at the (one) root's `src/`

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
=> {"found":true,"shapeVersion":3}
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

A v2 package root is a real error too (the migration-pointing one) — `getBoxShapeIfPresent` never treats a v2 shape as "not a box":

```ts
const v2dir = await makeV2PackageRoot();
const outcome = await getBoxShapeIfPresent(v2dir).then(() => "did-not-throw", (e) => e.message.includes("bbx migrate") ? "threw-migrate" : "threw-other");
outcome
=> threw-migrate
```

```ts continue
await fs.rm(v2dir, { recursive: true, force: true });
```

## `resolveBoxRoot`: tolerant for "not a box," strict about v2 shapes

A v3 box resolves to itself:

```ts
const box = await makeTmpBox();
(await resolveBoxRoot(box.root)) === box.root
=> true
```

A non-box path is returned unchanged (the tolerant contract the dev-tool callers — csp-digest.ts, csp-report.ts, audit-box.ts, secrets/migrate.ts — rely on):

```ts continue
const plain = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-plain-"));
const passthrough = (await resolveBoxRoot(plain)) === path.resolve(plain);
passthrough
=> true
```

A v2 shape still throws the migration-pointing error — `resolveBoxRoot` never silently resolves it:

```ts continue
const v2dir = await makeV2PackageRoot();
const outcome = await resolveBoxRoot(v2dir).then(() => "did-not-throw", (e) => e.message.includes("bbx migrate") ? "threw-migrate" : "threw-other");
outcome
=> threw-migrate
```

```ts cleanup
await fs.rm(plain, { recursive: true, force: true });
await fs.rm(v2dir, { recursive: true, force: true });
await box.cleanup();
```

## `requireBoxRoot`: strict everywhere `resolveBoxRoot` is tolerant

A v3 box still resolves to itself:

```ts
const box = await makeTmpBox();
(await requireBoxRoot(box.root)) === box.root
=> true
```

A non-box path throws instead of passing through — for callers (the hub, `bbx serve`) where a configured box path resolving to "not a box" must fail loudly:

```ts continue
const plain = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-plain2-"));
const outcome = await requireBoxRoot(plain).then(() => "did-not-throw", () => "threw");
outcome
=> threw
```

```ts cleanup
await fs.rm(plain, { recursive: true, force: true });
await box.cleanup();
```
