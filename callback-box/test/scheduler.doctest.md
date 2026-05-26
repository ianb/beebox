# Scheduler Utilities

Tests for scheduler utility functions — path computation and box
validation.

```ts setup
import { boxLogFile, isBox } from "../src/core/scheduler.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

## boxLogFile

### Returns correct path

```
const result = boxLogFile("/home/user/boxes/test");
result.endsWith(".callback-box/scheduler.jsonl")
=> true

result.startsWith("/home/user/boxes/test/")
=> true
```

## isBox

### Directory with .cb-box marker is a box

```
const box = await makeTmpBox();
// Create the .cb-box marker that isBox() looks for
await fs.writeFile(path.join(box.root, ".cb-box"), "");
const result = await isBox(box.root);
result
=> true
```

``` cleanup
await box.cleanup();
```

### Directory without marker is not a box

```
const tmpDir = await fs.mkdtemp(path.join(await import("node:os").then(m => m.tmpdir()), "not-a-box-"));
const result = await isBox(tmpDir);
result
=> false
```

``` cleanup
await fs.rm(tmpDir, { recursive: true });
```

### Nonexistent directory is not a box

```
const result = await isBox("/tmp/nonexistent-box-test-12345");
result
=> false
```
