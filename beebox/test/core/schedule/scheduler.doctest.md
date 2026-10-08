# Scheduler Utilities

Tests for scheduler utility functions — box validation.

```ts setup
import { isBox } from "../../../src/core/schedule/scheduler/core.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

## isBox

### Directory with .beebox/box.json marker is a box

```ts
const box = await makeTmpBox();
// Create the .beebox/box.json marker that isBox() looks for
await fs.mkdir(path.join(box.root, ".beebox"), { recursive: true });
await fs.writeFile(path.join(box.root, ".beebox/box.json"), "");
const result = await isBox(box.root);
result
=> true
```

```ts cleanup
await box.cleanup();
```

### Directory without marker is not a box

```ts
const tmpDir = await fs.mkdtemp(path.join(await import("node:os").then(m => m.tmpdir()), "not-a-box-"));
const result = await isBox(tmpDir);
result
=> false
```

```ts cleanup
await fs.rm(tmpDir, { recursive: true });
```

### Nonexistent directory is not a box

```ts
const result = await isBox("/tmp/nonexistent-box-test-12345");
result
=> false
```
