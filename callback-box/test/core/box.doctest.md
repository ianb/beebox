# Box Initialization

`initBox` creates the directory structure for a callback box. `isValidBox` checks if a directory is a properly initialized box. `findBoxRoot` walks up from a subdirectory to find the box root.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { initBox, isValidBox, getBoxMetadata } from "../../src/core/box.js";
import { findBoxRoot, BOX_MARKER } from "../../src/cli/lib/paths.js";

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

```ts
const tmp = await makeTmpDir();
await initBox(tmp, { skipGit: true });
await listDirs(tmp)
=>
.claude
.claude/rules
box
box/inbox
box/inbox/intake
box/inbox/staged
box/inbox/triaged
box/inbox/triaged/_unsure
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
places
store
store/archive
store/archive/done
store/archive/failed
store/archive/processed
store/calendar
store/chat
store/drive
store/recipes
store/reviews
store/reviews/retro
store/todos
store/trash
store/usage
tricks
tricks/lib
tricks/scripts
views
```

The box marker file contains version metadata:

```ts continue
const marker = JSON.parse(await fs.readFile(path.join(tmp, BOX_MARKER), "utf-8"));
marker.version
=> 1.0.0
```

A properly initialized directory is recognized as a valid box:

```ts continue
await isValidBox(tmp)
=> true
```

## Validation

An empty directory is not a valid box:

```ts
const empty = await makeTmpDir();
await isValidBox(empty)
=> false
```

## Finding the box root

`findBoxRoot` walks up from any subdirectory to find the nearest box root:

```ts
const box = await makeTmpDir();
await initBox(box, { skipGit: true });
const found = await findBoxRoot(path.join(box, "box", "inbox"));
found === box
=> true
```

## Finding a v2 box from its PACKAGE root

A v2 box's operational root moves to `<packageRoot>/content/` (marker at
`content/.cb-box`, not at the package root itself). `findBoxRoot` also
checks one level down: a directory with no `.cb-box` of its own, but a
`content/.cb-box` AND a `package.json` declaring a `callback-box`
dependency, resolves to `content/`.

```ts
const packageRoot = await makeTmpDir();
const v2Box = path.join(packageRoot, "content");
await initBox(v2Box, { skipGit: true });
await fs.writeFile(
  path.join(packageRoot, "package.json"),
  JSON.stringify({ name: "my-box", dependencies: { "callback-box": "^1.0.0" } })
);

const fromPackageRoot = await findBoxRoot(packageRoot);
fromPackageRoot === v2Box
=> true
```

Running from inside `content/` itself, or a subdirectory of it, still resolves the same way (the `.cb-box` marker there is found first, before the downward check is even considered):

```ts continue
const fromContentRoot = await findBoxRoot(v2Box);
const fromContentSubdir = await findBoxRoot(path.join(v2Box, "box", "inbox"));
fromContentRoot === v2Box && fromContentSubdir === v2Box
=> true
```

An unrelated directory — no `.cb-box` anywhere upward, and no `content/.cb-box` + qualifying `package.json` at any level — fails closed with `null`, not a guess:

```ts continue
const unrelatedDir = await makeTmpDir();
await findBoxRoot(unrelatedDir)
=> null
```

A directory with a `content/.cb-box` but NO `package.json` declaring `callback-box` (e.g. an unrelated directory that just happens to contain a `content/` folder) is never mistaken for a package root:

```ts continue
const lookalikeRoot = await makeTmpDir();
const lookalikeContent = path.join(lookalikeRoot, "content");
await initBox(lookalikeContent, { skipGit: true });
await findBoxRoot(lookalikeRoot)
=> null
```

## Metadata and idempotent initialization

`getBoxMetadata` reads the marker file. Running `initBox` again preserves the original created timestamp:

```ts
const box2 = await makeTmpDir();
await initBox(box2, { skipGit: true });
const meta1 = await getBoxMetadata(box2);
meta1.version
=> 1.0.0
```

```ts continue
await initBox(box2, { skipGit: true });
const meta2 = await getBoxMetadata(box2);
meta2.created === meta1.created
=> true

await isValidBox(box2)
=> true
```
