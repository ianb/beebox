# Box Initialization

`initBox` creates the directory structure for a callback box. `isValidBox` checks if a directory is a properly initialized box. `findBoxRoot` walks up from a subdirectory to find the box root.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { initBox, isValidBox, getBoxMetadata } from "../src/core/box.js";
import { findBoxRoot, BOX_MARKER } from "../src/cli/lib/paths.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "cb-doctest-"));
}

async function listDirs(root) {
  const result = [];
  async function walk(dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const rel = prefix ? prefix + "/" + e.name : e.name;
        result.push(rel);
        await walk(path.join(dir, e.name), rel);
      }
    }
  }
  await walk(root, "");
  result.sort();
  return result.join("\n");
}
```

## Directory structure

`initBox` creates the full directory tree:

```
const tmp = await makeTmpDir();
await initBox(tmp, { skipGit: true });
await listDirs(tmp)
=>
.claude
.claude/rules
box
box/inbox
box/inbox/unhandled
box/jobs
box/output
box/questions
box/resources
config
config/connectors
config/procedures
config/schedules
config/schemas
people
store
store/archive
store/archive/done
store/archive/failed
store/archive/processed
store/integrated
store/recipes
store/todos
store/trash
tricks
tricks/lib
tricks/scripts
```

The box marker file contains version metadata:

``` continue
const marker = JSON.parse(await fs.readFile(path.join(tmp, BOX_MARKER), "utf-8"));
marker.version
=> 1.0.0
```

A properly initialized directory is recognized as a valid box:

``` continue
await isValidBox(tmp)
=> true
```

## Validation

An empty directory is not a valid box:

```
const empty = await makeTmpDir();
await isValidBox(empty)
=> false
```

## Finding the box root

`findBoxRoot` walks up from any subdirectory to find the nearest box root:

```
const box = await makeTmpDir();
await initBox(box, { skipGit: true });
const found = await findBoxRoot(path.join(box, "box", "inbox"));
found === box
=> true
```

## Metadata and idempotent initialization

`getBoxMetadata` reads the marker file. Running `initBox` again preserves the original created timestamp:

```
const box2 = await makeTmpDir();
await initBox(box2, { skipGit: true });
const meta1 = await getBoxMetadata(box2);
meta1.version
=> 1.0.0
```

``` continue
await initBox(box2, { skipGit: true });
const meta2 = await getBoxMetadata(box2);
meta2.created === meta1.created
=> true

await isValidBox(box2)
=> true
```
