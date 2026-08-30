# Box-scoped temp dir: box-tmp

`boxTmpDir(boxRoot)` returns the box's swept temp dir (`<boxRoot>/tmp`) as a pure
path — it touches no disk. `ensureBoxTmpDir(boxRoot)` creates that dir and
returns its path. Box-request handlers use these instead of host `os.tmpdir()`
so per-box scratch stays inside the box it belongs to (enforced for
`src/webapp/routes|trpc` in `eslint.config.ts`).

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { boxTmpDir, ensureBoxTmpDir } from "../../src/lib/box-tmp.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## boxTmpDir is a pure `<boxRoot>/tmp` join

```ts
// Pure: returns the joined path even for a box that doesn't exist, no I/O.
boxTmpDir("/no/such/box") === path.join("/no/such/box", "tmp")
=> true
```

## ensureBoxTmpDir creates the dir and returns its path

```ts
const box = await makeTmpBox();
const dir = await ensureBoxTmpDir(box.root);
dir === boxTmpDir(box.root)
=> true
```

```ts continue
await fs.access(dir).then(() => "exists", () => "absent")
=> exists
```

```ts continue
// Idempotent — a second call on an existing dir is fine.
const again = await ensureBoxTmpDir(box.root);
again === dir
=> true
```

```ts cleanup
await box.cleanup();
```
