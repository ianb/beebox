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
import { getBoxShape, getBoxShapeIfPresent, resolveBoxRoot, requireBoxRoot, BoxShapeError } from "../../src/lib/box-shape.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

/** What `getBoxShape(root)` rejects with: "BoxShapeError mentioning [phrases]" when every phrase is in the message. */
const rejection = async (boxRoot, phrases) => {
  try { await getBoxShape(boxRoot); return "did not throw"; }
  catch (e) {
    if (!(e instanceof BoxShapeError)) return `not a BoxShapeError: ${e}`;
    const missing = phrases.filter((p) => !e.message.includes(p));
    return missing.length ? `BoxShapeError missing [${missing.join(", ")}]: ${e.message}` : `BoxShapeError mentioning [${phrases.join(", ")}]`;
  }
};

/** "threw" / "threw: <label>" / "did-not-throw" for a promise, where `label` classifies the error. */
const outcome = (promise, label) =>
  promise.then(() => "did-not-throw", (e) => (label ? `threw-${label(e)}` : "threw"));
const noConversion = (e) => (e.message.includes("conversion has been removed") ? "no-conversion" : "other");

// A v2 fixture: package root with the marker one level down at `content/`.
const makeV2PackageRoot = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-v2-fixture-"));
  await fs.mkdir(path.join(dir, "content", ".beebox"), { recursive: true });
  await fs.writeFile(path.join(dir, "content", ".beebox", "box.json"), JSON.stringify({ shapeVersion: 2 }));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies: { beebox: "^1.0.0" } }));
  return dir;
};

/** A throwaway box whose marker holds `marker`, a string written verbatim. */
const boxWithMarker = async (marker) => {
  const box = await makeTmpBox();
  await box.write(".beebox/box.json", marker);
  return box;
};
```

## Markers that predate v3 are rejected

A marker with no `shapeVersion`, an empty marker, and a `shapeVersion` below 3
are each a `BoxShapeError`; the first says conversion has been removed, the
third names the version it found.

```ts
const noVersion = await boxWithMarker(JSON.stringify({ version: "1.0.0", created: "2026-01-01T00:00:00.000Z" }));
const empty = await boxWithMarker("");
const v2 = await boxWithMarker(JSON.stringify({ shapeVersion: 2 }));
const results = {
  noShapeVersion: await rejection(noVersion.root, ["conversion has been removed"]),
  emptyMarker: await rejection(empty.root, []),
  shapeVersion2: await rejection(v2.root, ["shapeVersion 2"]),
};
await Promise.all([noVersion.cleanup(), empty.cleanup(), v2.cleanup()]);
results
=> {
  noShapeVersion: "BoxShapeError mentioning [conversion has been removed]",
  emptyMarker: "BoxShapeError mentioning []",
  shapeVersion2: "BoxShapeError mentioning [shapeVersion 2]"
}
```

A v2 package root (marker at `content/`) and a v2 `content/` root itself are
both rejected with the migration-pointing error, each naming which root it
saw.

```ts
const dir = await makeV2PackageRoot();
const results = {
  packageRoot: await rejection(dir, ["conversion has been removed", "package root"]),
  contentRoot: await rejection(path.join(dir, "content"), ["conversion has been removed", "content/ root"]),
};
await fs.rm(dir, { recursive: true, force: true });
results
=> {
  packageRoot: "BoxShapeError mentioning [conversion has been removed, package root]",
  contentRoot: "BoxShapeError mentioning [conversion has been removed, content/ root]"
}
```

An unknown future `shapeVersion` is a clear error naming what is needed:

```ts
const box = await boxWithMarker(JSON.stringify({ shapeVersion: 4 }));
const result = await rejection(box.root, ["newer beebox"]);
await box.cleanup();
result
=> BoxShapeError mentioning [newer beebox]
```

## Shape 3 is validated against the box's own package.json

`beebox` in `devDependencies` alone still resolves. A missing `package.json`
and one that does not declare `beebox` are each a `BoxShapeError`, the first
naming the box root and the second naming `beebox`.

```ts
const dev = await makeTmpBox();
await fs.writeFile(path.join(dev.root, "package.json"), JSON.stringify({ name: "my-box", devDependencies: { "beebox": "0.1.0" } }));
const resolved = (await getBoxShape(dev.root)).boxRoot === dev.root;

const missing = await makeTmpBox();
await fs.rm(path.join(missing.root, "package.json"));
const missingResult = await rejection(missing.root, [missing.root]);

const undeclared = await makeTmpBox();
await fs.writeFile(path.join(undeclared.root, "package.json"), JSON.stringify({ name: "my-box", dependencies: { lodash: "1.0.0" } }));
const undeclaredResult = await rejection(undeclared.root, ["beebox"]);

await Promise.all([dev.cleanup(), missing.cleanup(), undeclared.cleanup()]);
({ resolved, missingResult, undeclaredResult })
=> {
  resolved: true,
  missingResult: "BoxShapeError mentioning [«*»]",
  undeclaredResult: "BoxShapeError mentioning [beebox]"
}
```

## Tolerant and strict lookups

`getBoxShapeIfPresent` tolerates a marker-less path but not a broken one;
`resolveBoxRoot` is tolerant for "not a box" and strict about v2 shapes;
`requireBoxRoot` is strict everywhere `resolveBoxRoot` is tolerant. Each case
below runs all three against one input.

A real v3 box is found (`shapeVersion` 3) and both resolvers return its root:

```ts
const box = await makeTmpBox();
const lookup = await getBoxShapeIfPresent(box.root);
const results = {
  found: lookup.found,
  shapeVersion: lookup.found ? lookup.shape.shapeVersion : null,
  resolveBoxRoot: (await resolveBoxRoot(box.root)) === box.root,
  requireBoxRoot: (await requireBoxRoot(box.root)) === box.root,
};
await box.cleanup();
results
=> { found: true, shapeVersion: 3, resolveBoxRoot: true, requireBoxRoot: true }
```

A directory with no `.beebox/box.json` is "not a box" (`found: false`), never
a fabricated shape. `resolveBoxRoot` returns the path unchanged (the tolerant
contract the dev-tool callers — csp-digest.ts, csp-report.ts, audit-box.ts,
secrets/migrate.ts — rely on); `requireBoxRoot` throws, for callers (the hub,
`bbx serve`) where a configured box path resolving to "not a box" must fail
loudly:

```ts
const plain = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-nobox-"));
const results = {
  found: (await getBoxShapeIfPresent(plain)).found,
  resolveBoxRootUnchanged: (await resolveBoxRoot(plain)) === path.resolve(plain),
  requireBoxRoot: await outcome(requireBoxRoot(plain)),
};
await fs.rm(plain, { recursive: true, force: true });
results
=> { found: false, resolveBoxRootUnchanged: true, requireBoxRoot: "threw" }
```

A malformed marker is a real error and still throws — it is NOT mistaken for
"no box":

```ts
const bad = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-badbox-"));
await fs.mkdir(path.join(bad, ".beebox"), { recursive: true });
await fs.writeFile(path.join(bad, ".beebox/box.json"), "{not json");
const result = await outcome(getBoxShapeIfPresent(bad));
await fs.rm(bad, { recursive: true, force: true });
result
=> threw
```

A v2 package root is a real error too (the migration-pointing one):
`getBoxShapeIfPresent` never treats a v2 shape as "not a box", and
`resolveBoxRoot` never silently resolves it.

```ts
const v2dir = await makeV2PackageRoot();
const results = {
  getBoxShapeIfPresent: await outcome(getBoxShapeIfPresent(v2dir), noConversion),
  resolveBoxRoot: await outcome(resolveBoxRoot(v2dir), noConversion),
};
await fs.rm(v2dir, { recursive: true, force: true });
results
=> { getBoxShapeIfPresent: "threw-no-conversion", resolveBoxRoot: "threw-no-conversion" }
```
