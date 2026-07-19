# `cb serve <dir>`: explicit args resolve to the directory that holds the box

`resolveServableBoxRoot` is what lets `cb serve <package-root>` do the
obvious thing for a v2 box (marker at `<dir>/content/.cb-box`): resolve to
`content/` instead of dying later with a raw ENOENT reading
`<package-root>/.cb-box` at startup. (A dir that is neither a box nor a
package root errors out with the marker path named — that path calls
`process.exit`, so it isn't exercised here; the two resolving cases are.)

```ts setup
import * as fs from "node:fs/promises";
import { resolveServableBoxRoot } from "../../../src/cli/commands/serve.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## A directory that is itself a box resolves to itself

```ts
const box = await makeTmpBox();
(await resolveServableBoxRoot(box.root)) === box.root
=> true
```

```ts cleanup
await box.cleanup();
```

## A v2 package root resolves down to its `content/` box

`makeTmpBox` writes a root marker; remove it to shape a real v2 package
root, where the only marker lives at `content/.cb-box`.

```ts
const box = await makeTmpBox();
await fs.rm(box.path(".cb-box"));
await box.write("content/.cb-box", JSON.stringify({ shapeVersion: 2 }));

(await resolveServableBoxRoot(box.root)) === box.path("content")
=> true
```

```ts cleanup
await box.cleanup();
```
